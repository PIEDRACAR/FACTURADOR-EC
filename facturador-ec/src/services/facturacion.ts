import { FacturacionElectronicaEC } from 'facturacion-electronica-ec';
import type { FacturaData, EmissionResult } from 'facturacion-electronica-ec';
import { supabase } from '../db/supabase.js';
import { SupabaseSequenceProvider } from '../sequence/supabaseSequenceProvider.js';
import { descifrar, descifrarTexto, pgByteaABuffer } from '../crypto/secrets.js';
import { obtenerEmisor, obtenerPuntoEmisionActivo } from '../db/consultas.js';

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
async function construirFacturadorParaEmisor(emisorId: string): Promise<FacturacionElectronicaEC> {
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

  return new FacturacionElectronicaEC({
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
    sequenceProvider: new SupabaseSequenceProvider(emisorId),
    validateXsd: true, // capa extra local, no sustituye la validación del SRI
  });
}

export interface EmitirFacturaInput {
  emisorId: string;
  comprobanteId: string; // fila ya creada en `comprobantes` con estado 'generado'
  facturaData: FacturaData;
}

/**
 * Emite una factura de punta a punta (build → firma → envío → autorización)
 * y sincroniza el resultado con la fila correspondiente en `comprobantes`.
 *
 * El comprobante debe existir de antemano en la tabla (creado por el flujo
 * del POS al confirmar la venta, con estado 'generado'), para no perder
 * trazabilidad si algo falla a mitad de camino.
 */
export async function emitirFactura({
  emisorId,
  comprobanteId,
  facturaData,
}: EmitirFacturaInput): Promise<EmissionResult> {
  const fe = await construirFacturadorParaEmisor(emisorId);

  let resultado: EmissionResult;
  try {
    resultado = await fe.emitirFactura(facturaData);
  } catch (err) {
    await supabase
      .from('comprobantes')
      .update({
        estado: 'rechazado',
        motivo_error: err instanceof Error ? err.message : String(err),
      })
      .eq('id', comprobanteId);

    await supabase.from('log_firmas').insert({
      comprobante_id: comprobanteId,
      resultado: 'error',
      mensaje: err instanceof Error ? err.message : String(err),
    });

    throw err;
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
      motivo_error: resultado.estado !== 'AUTORIZADO' ? JSON.stringify(resultado) : null,
    })
    .eq('id', comprobanteId);

  await supabase.from('log_firmas').insert({
    comprobante_id: comprobanteId,
    resultado: resultado.estado === 'AUTORIZADO' ? 'ok' : 'error',
    mensaje: `Estado SRI: ${resultado.estado}`,
  });

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
