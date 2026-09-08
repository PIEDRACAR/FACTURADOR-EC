import { FacturacionElectronicaEC } from 'facturacion-electronica-ec';
import type { FacturaData, EmissionResult } from 'facturacion-electronica-ec';
import {
  generateClaveAcceso,
  generateCodigoNumerico,
  getCodDoc,
  validateXmlAgainstXsd,
} from 'facturacion-electronica-ec';
import { supabase } from '../db/supabase.js';
import { SupabaseSequenceProvider } from '../sequence/supabaseSequenceProvider.js';
import { descifrar, descifrarTexto, pgByteaABuffer } from '../crypto/secrets.js';
import { obtenerEmisor, obtenerPuntoEmisionActivo } from '../db/consultas.js';
import { archivarComprobanteAutorizado } from './archivoComprobante.js';

/**
 * Nombre EXACTO del campo que exige la Resolución NAC-DGERCGC26-00000027
 * (art. 5) en la sección de información adicional de cada comprobante.
 * Confirmado por múltiples fuentes profesionales citando la resolución de
 * forma literal — no es una decisión de diseño nuestra, es el texto legal.
 *
 * Si el SRI publica una Ficha Técnica que use un nombre distinto, este es
 * el único lugar que hay que tocar.
 */
const NOMBRE_CAMPO_RUC_PROVEEDOR = 'RUC Proveedor';

/**
 * RUC del proveedor del sistema de facturación electrónica — en este caso,
 * el propio contribuyente que construyó y opera este sistema para sí mismo
 * (uso interno, no comercializado a terceros). Configurable por variable
 * de entorno para el día en que este sistema sí se ofrezca a otros
 * contribuyentes con un RUC de proveedor distinto al del emisor.
 */
async function obtenerRucProveedorSistema(emisorId: string): Promise<string | null> {
  // Configuración central: el proveedor del sistema se administra en Railway, no por negocio.
  const central = process.env.RUC_PROVEEDOR_FACTURACION?.trim();
  if (central) return central;
  const { data } = await supabase.from('configuracion_sistema').select('ruc_proveedor_facturacion').eq('emisor_id', emisorId).maybeSingle();
  return data?.ruc_proveedor_facturacion ? String(data.ruc_proveedor_facturacion).trim() : null;
}


/**
 * Este servicio arma una instancia de FacturacionElectronicaEC "al vuelo" por
 * cada emisor, en vez de una sola instancia global — porque el sistema es
 * multiempresa (ver sección 12 de la arquitectura): cada emisor tiene su
 * propio RUC, su propio establecimiento/punto de emisión y, sobre todo, su
 * propio certificado .p12. No se puede compartir una sola instancia entre
 * distintos negocios.
 *
 * SEGURIDAD: el .p12 y su contraseña viven CIFRADOS en las columnas
 * `certificados.p12_cifrado` y `certificados.p12_password_cifrado`
 * (ver src/crypto/secrets.ts) y se descifran únicamente aquí, en memoria,
 * en el backend — nunca se exponen al navegador ni quedan en texto plano
 * en ninguna variable de entorno por cliente. Esto reemplaza el esquema
 * anterior basado en P12_PASSWORD__<alias>/P12_BASE64__<alias>, que exigía
 * tocar Railway a mano por cada negocio nuevo registrado.
 */
async function construirFacturadorParaEmisor(
  emisorId: string
): Promise<{ fe: FacturacionElectronicaEC; ruc: string; ambienteClave: '1' | '2'; establecimiento: string; puntoEmision: string; sequenceProvider: SupabaseSequenceProvider }> {
  const emisor = await obtenerEmisor(emisorId);
  const puntoEmision = await obtenerPuntoEmisionActivo(emisorId);

  const { data: certificado, error: errorCert } = await supabase
    .from('certificados')
    .select('*')
    .eq('emisor_id', emisorId)
    .eq('activo', true)
    .limit(1)
    .single();

  if (errorCert || !certificado) {
    throw new Error(`El emisor ${emisorId} no tiene un certificado activo configurado.`);
  }

  if (new Date(certificado.fecha_expiracion) < new Date()) {
    throw new Error(
      `El certificado activo del emisor ${emisorId} está vencido ` +
        `(venció el ${certificado.fecha_expiracion}). No se puede firmar.`
    );
  }

  if (!certificado.p12_cifrado || !certificado.p12_password_cifrado) {
    throw new Error(
      `El certificado "${certificado.alias}" del emisor ${emisorId} no tiene el archivo .p12 ` +
        `o la contraseña guardados (columnas p12_cifrado / p12_password_cifrado vacías). ` +
        `Vuelve a registrarlo desde /registro.`
    );
  }

  // Descifrado con la llave maestra del sistema (SECRETS_ENCRYPTION_KEY) —
  // ver src/crypto/secrets.ts. Nada de esto sale de esta función.
  const p12Buffer = descifrar(pgByteaABuffer(certificado.p12_cifrado));
  const p12Password = descifrarTexto(pgByteaABuffer(certificado.p12_password_cifrado));

  const sequenceProvider = new SupabaseSequenceProvider(emisorId);

  return {
    fe: new FacturacionElectronicaEC({
      emisor: {
        ruc: emisor.ruc,
        razonSocial: emisor.razon_social,
        nombreComercial: emisor.nombre_comercial ?? undefined,
        dirMatriz: emisor.direccion_matriz,
        establecimiento: puntoEmision.establecimiento,
        puntoEmision: puntoEmision.punto_emision,
        direccionEstablecimiento: puntoEmision.direccion,
        contribuyenteEspecial: emisor.contribuyente_especial ?? undefined,
        obligadoContabilidad: emisor.obligado_contabilidad,
        ambiente: emisor.ambiente === 'produccion' ? '2' : '1',
        agenteRetencion: emisor.agente_retencion ? 'SI' : undefined,
      },
      p12: p12Buffer,
      p12Password,
      sequenceProvider,
      validateXsd: true, // capa extra local, no sustituye la validación del SRI
    }),
    ruc: emisor.ruc,
    ambienteClave: emisor.ambiente === 'produccion' ? '2' : '1',
    establecimiento: puntoEmision.establecimiento,
    puntoEmision: puntoEmision.punto_emision,
    sequenceProvider,
  };
}

/**
 * Inserta el campo de información adicional que exige la Resolución
 * NAC-DGERCGC26-00000027 en el XML SIN FIRMAR, justo antes del cierre de
 * `</factura>` — es la única posición válida según el XSD oficial
 * (`infoAdicional` es el último elemento de la secuencia, inmediatamente
 * antes de donde se agrega la firma XAdES-BES). Se hace ANTES de firmar
 * porque cualquier cambio al XML después de firmado invalida la firma.
 */
function insertarInfoAdicionalRucProveedor(xmlSinFirmar: string, rucProveedor: string): string {
  const marcaCierre = '</factura>';
  const posicion = xmlSinFirmar.lastIndexOf(marcaCierre);
  if (posicion === -1) {
    throw new Error('No se encontró la etiqueta de cierre </factura> en el XML generado — no se puede insertar infoAdicional.');
  }

  const bloque =
    `<infoAdicional><campoAdicional nombre="${NOMBRE_CAMPO_RUC_PROVEEDOR}">` +
    `${escapeXmlBasico(rucProveedor)}</campoAdicional></infoAdicional>`;

  return xmlSinFirmar.slice(0, posicion) + bloque + xmlSinFirmar.slice(posicion);
}

/** Escapado XML mínimo — el RUC es solo dígitos, pero se aplica igual por buena práctica. */
function escapeXmlBasico(texto: string): string {
  return texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}


export interface EmitirFacturaInput {
  emisorId: string;
  comprobanteId: string; // fila ya creada en `comprobantes` con estado 'generado'
  facturaData: FacturaData;
}

/**
 * Emite una factura de punta a punta y sincroniza el resultado con la fila
 * correspondiente en `comprobantes`.
 *
 * IMPORTANTE — por qué esto NO llama a `fe.emitirFactura()` directamente:
 * la Resolución NAC-DGERCGC26-00000027 (art. 5) exige incluir el RUC del
 * proveedor del sistema de facturación en la información adicional de
 * cada comprobante, y la librería `facturacion-electronica-ec` (v1.0.1)
 * no tiene forma de agregar ese campo a través de su método de alto nivel
 * — su único "gancho" (`onXmlBuilt`) es solo un observador, no permite
 * modificar el XML antes de firmarlo.
 *
 * Por eso aquí se reconstruye el mismo pipeline, paso por paso, usando los
 * métodos públicos de bajo nivel que la propia librería expone
 * (`buildXml`, `signXml`, `sendToSri`, `checkAuthorization`), insertando
 * el campo justo antes de firmar (después de firmado, cualquier cambio
 * invalida la firma XAdES-BES). El comportamiento de reintento ante
 * código 70 ("clave de acceso ya recibida" — el SRI pide reintentar con
 * un secuencial nuevo) replica fielmente el que trae la librería
 * internamente, revisado directamente en su código fuente.
 *
 * Cada XML se valida contra el XSD oficial (offline, sin tocar el SRI)
 * antes de firmarlo — si la inserción del campo rompiera la estructura,
 * se detecta aquí, no como un rechazo real del SRI.
 */
interface ParametrosCampoAdicional {
  fe: FacturacionElectronicaEC;
  facturaData: FacturaData;
  ruc: string;
  ambienteClave: '1' | '2';
  establecimiento: string;
  puntoEmision: string;
  sequenceProvider: SupabaseSequenceProvider;
  rucProveedor: string;
}

const CODIGO_DOC_FACTURA = getCodDoc('FACTURA');
const AUTHORIZATION_DELAY_MS = 1500; // igual al valor por defecto interno de la librería
const MAX_ERROR_70_RETRIES = 3;
const MAX_SEND_RETRIES = 2;
const SEND_RETRY_DELAY_MS = 2000;
const MAX_AUTHORIZATION_POLLS = 10;
const AUTHORIZATION_POLL_DELAY_MS = 2000;

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Reimplementación fiel del pipeline interno de `fe.emitirFactura()`
 * (build → validar XSD offline → firmar → enviar con reintentos → esperar
 * → verificar autorización, con reintento de secuencial nuevo ante código
 * 70), con un único paso agregado: insertar `<infoAdicional>` con el RUC
 * del proveedor antes de firmar.
 */
async function emitirFacturaConCampoAdicional({
  fe,
  facturaData,
  ruc,
  ambienteClave,
  establecimiento,
  puntoEmision,
  sequenceProvider,
  rucProveedor,
}: ParametrosCampoAdicional): Promise<EmissionResult> {
  let ultimoError: string | undefined;

  for (let intento = 0; intento <= MAX_ERROR_70_RETRIES; intento++) {
    const secuencial = await sequenceProvider.next(establecimiento, puntoEmision, 'FACTURA');
    const claveAcceso = generateClaveAcceso({
      fechaEmision: facturaData.fechaEmision,
      tipoComprobante: CODIGO_DOC_FACTURA,
      ruc,
      ambiente: ambienteClave,
      establecimiento,
      puntoEmision,
      secuencial,
      codigoNumerico: generateCodigoNumerico(),
      tipoEmision: '1',
    });

    const xmlSinFirmar = fe.buildXml('FACTURA', facturaData, { secuencial, claveAcceso });
    const xmlConCampo = insertarInfoAdicionalRucProveedor(xmlSinFirmar, rucProveedor);

    // Validación offline contra el XSD oficial — si la inserción del campo
    // rompiera la estructura, se detecta aquí, antes de firmar o tocar al SRI.
    const validacion = await validateXmlAgainstXsd('FACTURA', xmlConCampo);
    if (!validacion.valid) {
      throw new Error(
        `El XML con el campo de información adicional no pasó la validación XSD local: ${validacion.errors.join('; ')}`
      );
    }

    const xmlFirmado = await fe.signXml(xmlConCampo, 'FACTURA');

    let recepcion;
    let errorEnvio: unknown;
    for (let intentoEnvio = 0; intentoEnvio <= MAX_SEND_RETRIES; intentoEnvio++) {
      try {
        recepcion = await fe.sendToSri(xmlFirmado);
        errorEnvio = undefined;
        break;
      } catch (err) {
        errorEnvio = err;
        if (intentoEnvio < MAX_SEND_RETRIES) await esperar(SEND_RETRY_DELAY_MS);
      }
    }
    if (!recepcion) {
      throw errorEnvio instanceof Error ? errorEnvio : new Error(String(errorEnvio));
    }

    const tieneCodigo70 = recepcion.estado === 'DEVUELTA' && recepcion.mensajes?.some((m) => m.identificador === '70');

    if (recepcion.estado === 'DEVUELTA' && !tieneCodigo70) {
      // Rechazo real de forma — reintentar con un secuencial nuevo no cambia nada.
      const detalle = (recepcion.mensajes ?? []).map((m) => `${m.identificador}: ${m.mensaje}${m.informacionAdicional ? ' — ' + m.informacionAdicional : ''}`).join('; ');
      return {
        estado: 'DEVUELTA',
        ambiente: ambienteClave === '2' ? 'produccion' : 'pruebas',
        claveAcceso,
        secuencial,
        xmlOriginal: xmlConCampo,
        xmlFirmado,
        numeroAutorizacion: null,
        fechaAutorizacion: null,
        mensaje: detalle || 'Comprobante devuelto por el SRI.',
      } as unknown as EmissionResult;
    }

    if (tieneCodigo70) {
      // El SRI ya tiene esa clave de acceso en cola — esperar un poco y
      // verificar si de todas formas se autorizó, antes de reintentar con
      // secuencial nuevo (mismo comportamiento que la librería original).
      await esperar(SEND_RETRY_DELAY_MS);
      const autorizacionTrasCodigo70 = await fe.checkAuthorization(claveAcceso);
      if (autorizacionTrasCodigo70.estado === 'AUTORIZADO') {
        return construirResultadoDesdeAutorizacion(autorizacionTrasCodigo70, claveAcceso, secuencial, xmlConCampo, xmlFirmado, ambienteClave);
      }
      ultimoError = 'Código 70 del SRI (clave de acceso ya recibida) — reintentando con secuencial nuevo.';
      continue;
    }

    // RECIBIDA — el SRI puede tardar más de 1.5 s en resolver la autorización.
    // No debemos mostrar falsamente 'no autorizado' mientras siga procesando.
    await esperar(AUTHORIZATION_DELAY_MS);
    let autorizacion: any = null;
    let ultimoErrorAutorizacion: unknown = null;
    for (let consulta = 0; consulta < MAX_AUTHORIZATION_POLLS; consulta++) {
      try {
        autorizacion = await fe.checkAuthorization(claveAcceso);
        ultimoErrorAutorizacion = null;
        const estado = String(autorizacion?.estado ?? '').toUpperCase();
        if (estado === 'AUTORIZADO' || estado === 'NO AUTORIZADO' || estado === 'RECHAZADA' || estado === 'DEVUELTA') break;
      } catch (e) {
        ultimoErrorAutorizacion = e;
      }
      if (consulta < MAX_AUTHORIZATION_POLLS - 1) await esperar(AUTHORIZATION_POLL_DELAY_MS);
    }
    if (!autorizacion) {
      return { estado: 'EN PROCESAMIENTO', ambiente: ambienteClave === '2' ? 'produccion' : 'pruebas', claveAcceso, secuencial, xmlOriginal: xmlConCampo, xmlFirmado, numeroAutorizacion: null, fechaAutorizacion: null, mensaje: ultimoErrorAutorizacion instanceof Error ? ultimoErrorAutorizacion.message : 'El SRI recibió el comprobante, pero todavía no devuelve la autorización.' } as unknown as EmissionResult;
    }
    return construirResultadoDesdeAutorizacion(autorizacion, claveAcceso, secuencial, xmlConCampo, xmlFirmado, ambienteClave);
  }

  throw new Error(ultimoError ?? 'No se pudo emitir el comprobante tras varios intentos (código 70 persistente).');
}

function construirResultadoDesdeAutorizacion(
  autorizacion: {
    estado: string;
    numeroAutorizacion: string | null;
    fechaAutorizacion: string | null;
    mensaje?: string;
    mensajes?: Array<{ identificador?: string; mensaje?: string; informacionAdicional?: string }>;
    comprobantes?: { comprobante?: { mensajes?: Array<{ identificador?: string; mensaje?: string; informacionAdicional?: string }> } } | null;
  },
  claveAcceso: string,
  secuencial: string,
  xmlOriginal: string,
  xmlFirmado: string,
  ambienteClave: '1' | '2'
): EmissionResult {
  const mensajes = [
    ...(autorizacion.mensajes ?? []),
    ...(autorizacion.comprobantes?.comprobante?.mensajes ?? []),
  ];
  const detalle = mensajes
    .map((m) => {
      const codigo = m.identificador ? `${m.identificador}: ` : '';
      const texto = m.mensaje ?? '';
      const adicional = m.informacionAdicional ? ` — ${m.informacionAdicional}` : '';
      return `${codigo}${texto}${adicional}`.trim();
    })
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i)
    .join('; ');
  const mensaje = autorizacion.mensaje?.trim() || detalle || `El SRI devolvió el estado ${autorizacion.estado}.`;
  return {
    estado: autorizacion.estado,
    ambiente: ambienteClave === '2' ? 'produccion' : 'pruebas',
    claveAcceso,
    secuencial,
    xmlOriginal,
    xmlFirmado,
    numeroAutorizacion: autorizacion.numeroAutorizacion,
    fechaAutorizacion: autorizacion.fechaAutorizacion,
    mensaje,
  } as unknown as EmissionResult;
}

export async function emitirFactura({
  emisorId,
  comprobanteId,
  facturaData,
}: EmitirFacturaInput): Promise<EmissionResult> {
  const { fe, ruc, ambienteClave, establecimiento, puntoEmision, sequenceProvider } =
    await construirFacturadorParaEmisor(emisorId);

  const rucProveedor = await obtenerRucProveedorSistema(emisorId);
  if (!rucProveedor) {
    throw new Error('No está configurado el RUC del proveedor del sistema de facturación. El RUC del proveedor es administrado de forma central por CONTSERTRIB y debe estar configurado en Railway (RUC_PROVEEDOR_FACTURACION).');
  }

  let resultado: EmissionResult;
  try {
    resultado = rucProveedor
      ? await emitirFacturaConCampoAdicional({
          fe,
          facturaData,
          ruc,
          ambienteClave,
          establecimiento,
          puntoEmision,
          sequenceProvider,
          rucProveedor,
        })
      : await fe.emitirFactura(facturaData);
  } catch (err) {
    let mensaje = err instanceof Error ? err.message : String(err);
    // Bug conocido de la librería: cuando la validación XSD encuentra
    // varios errores de forma, arma el mensaje con `array.join()` sobre
    // objetos (no strings), y el resultado queda como "[object Object]"
    // repetido — se pierde el detalle real. No hay forma de recuperar el
    // detalle exacto desde aquí, pero al menos se da una pista útil en vez
    // de un mensaje ilegible: los casos más comunes son campos que exceden
    // el largo máximo que exige el SRI (p. ej. codigoPrincipal ≤ 25
    // caracteres) o un tipo de dato con formato inválido.
    if (mensaje.includes('[object Object]')) {
      mensaje +=
        ' — Es un error de formato del XML (la librería no da más detalle). Causas típicas: algún código de producto ' +
        'supera los 25 caracteres, o un campo numérico/fecha no tiene el formato que exige el SRI.';
    }

    await supabase
      .from('comprobantes')
      .update({
        estado: 'rechazado',
        motivo_error: mensaje,
      })
      .eq('id', comprobanteId);

    await supabase.from('log_firmas').insert({
      comprobante_id: comprobanteId,
      resultado: 'error',
      mensaje,
    });

    throw err instanceof Error && mensaje !== err.message ? new Error(mensaje, { cause: err }) : err;
  }

  const estadoDb = mapearEstado(resultado.estado);

  await supabase
    .from('comprobantes')
    .update({
      estado: estadoDb,
      secuencial: resultado.secuencial,
      clave_acceso: resultado.claveAcceso,
      xml_firmado: resultado.xmlFirmado,
      numero_autorizacion: resultado.numeroAutorizacion ?? null,
      fecha_autorizacion: resultado.estado === 'AUTORIZADO' ? new Date().toISOString() : null,
      // Guardamos el mensaje real del SRI en texto para que el centro de
      // notificaciones y el POS puedan mostrar exactamente la causa del rechazo.
      motivo_error: resultado.estado !== 'AUTORIZADO' ? (resultado.mensaje ?? `Estado SRI: ${resultado.estado}`) : null,
    })
    .eq('id', comprobanteId);

  await supabase.from('log_firmas').insert({
    comprobante_id: comprobanteId,
    resultado: resultado.estado === 'AUTORIZADO' ? 'ok' : 'error',
    mensaje: `Estado SRI: ${resultado.estado}`,
  });

  // Archivo documental permanente: para cada factura autorizada guardamos
  // el XML firmado y el RIDE PDF en un bucket PRIVADO de Supabase Storage.
  // Si Storage falla, la factura no se vuelve a rechazar: la autorización
  // del SRI ya ocurrió y el incidente queda registrado para poder reintentar.
  if (resultado.estado === 'AUTORIZADO' && resultado.xmlFirmado && resultado.claveAcceso) {
    try {
      await archivarComprobanteAutorizado({
        comprobanteId,
        emisorId,
        claveAcceso: resultado.claveAcceso,
        xmlFirmado: resultado.xmlFirmado,
        secuencial: resultado.secuencial,
      });
    } catch (archiveError) {
      const detalleArchivo = archiveError instanceof Error ? archiveError.message : String(archiveError);
      await supabase.from('log_firmas').insert({
        comprobante_id: comprobanteId,
        resultado: 'error',
        mensaje: `Factura autorizada, pero falló el archivo permanente XML/RIDE: ${detalleArchivo}`,
      });
    }
  }

  return resultado;
}

/** Traduce el estado que devuelve la librería al enum usado en la columna `comprobantes.estado`. */
function mapearEstado(estadoSri: string): string {
  switch (estadoSri) {
    case 'AUTORIZADO':
      return 'autorizado';
    case 'NO AUTORIZADO':
    case 'RECHAZADA':
      return 'rechazado';
    case 'DEVUELTA':
      return 'devuelto';
    default:
      return 'enviado';
  }
}
