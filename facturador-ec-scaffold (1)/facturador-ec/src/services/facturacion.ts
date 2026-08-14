import { readFileSync } from 'node:fs';
import { FacturacionElectronicaEC } from 'facturacion-electronica-ec';
import type { FacturaData, EmissionResult } from 'facturacion-electronica-ec';
import { supabase } from '../db/supabase.js';
import { SupabaseSequenceProvider } from '../sequence/supabaseSequenceProvider.js';

/**
 * Este servicio arma una instancia de FacturacionElectronicaEC "al vuelo" por
 * cada emisor, en vez de una sola instancia global — porque el sistema es
 * multiempresa (ver sección 12 de la arquitectura): cada emisor tiene su
 * propio RUC, su propio establecimiento/punto de emisión y, sobre todo, su
 * propio certificado .p12. No se puede compartir una sola instancia entre
 * distintos negocios.
 *
 * SEGURIDAD: el .p12 y su contraseña se leen aquí, en el backend, y nunca
 * salen de esta función. La referencia guardada en la tabla `certificados`
 * (columna referencia_almacenamiento) apunta a dónde vive el archivo — en
 * este scaffold, una ruta de disco local; en producción real, normalmente
 * el path/clave dentro de un gestor de secretos (Supabase Vault, AWS
 * Secrets Manager, etc.), nunca el archivo mismo dentro de la tabla.
 */
async function construirFacturadorParaEmisor(emisorId: string): Promise<FacturacionElectronicaEC> {
  const { data: emisor, error: errorEmisor } = await supabase
    .from('emisores')
    .select('*')
    .eq('id', emisorId)
    .single();

  if (errorEmisor || !emisor) {
    throw new Error(`No se encontró el emisor ${emisorId}: ${errorEmisor?.message ?? 'sin datos'}`);
  }

  const { data: puntoEmision, error: errorPunto } = await supabase
    .from('puntos_emision')
    .select('*')
    .eq('emisor_id', emisorId)
    .eq('activo', true)
    .limit(1)
    .single();

  if (errorPunto || !puntoEmision) {
    throw new Error(`El emisor ${emisorId} no tiene un punto de emisión activo configurado.`);
  }

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

  // La contraseña del .p12 NUNCA se guarda en la tabla `certificados` —
  // solo la referencia de dónde vive el secreto. Aquí se resuelve leyendo
  // una variable de entorno específica del certificado, por ejemplo
  // `P12_PASSWORD__<alias>`. Ajustar según el gestor de secretos real que
  // se termine usando en producción.
  const passwordEnvVar = `P12_PASSWORD__${certificado.alias.toUpperCase()}`;
  const p12Password = process.env[passwordEnvVar];
  if (!p12Password) {
    throw new Error(
      `Falta la contraseña del certificado "${certificado.alias}" del emisor ${emisorId} ` +
        `(se esperaba en la variable de entorno ${passwordEnvVar}).`
    );
  }

  // El certificado .p12 se puede resolver de DOS formas, según dónde se
  // despliegue este backend:
  //
  // 1) Variable de entorno en base64 (P12_BASE64__<alias>) — la forma
  //    recomendada en Render, Railway o cualquier hosting con sistema de
  //    archivos EFÍMERO (se borra en cada redeploy/reinicio). El valor de
  //    `certificados.referencia_almacenamiento` en ese caso es solo el
  //    alias/etiqueta, no una ruta real.
  // 2) Ruta de archivo en disco (readFileSync) — válida solo si el backend
  //    corre en un VPS con disco persistente propio, donde tú controlas
  //    que el archivo siga ahí después de un reinicio.
  //
  // Se intenta primero la variable de entorno en base64 porque es la más
  // segura para hosting efímero (no depende de que alguien suba el archivo
  // a mano y se te olvide después de un redeploy).
  const p12Base64EnvVar = `P12_BASE64__${certificado.alias.toUpperCase()}`;
  const p12Base64 = process.env[p12Base64EnvVar];

  const p12Buffer = p12Base64
    ? Buffer.from(p12Base64, 'base64')
    : readFileSync(certificado.referencia_almacenamiento);

  if (!p12Base64) {
    console.warn(
      `[facturacion] No se encontró ${p12Base64EnvVar}; leyendo el certificado desde disco ` +
        `(${certificado.referencia_almacenamiento}). Esto SOLO es seguro si el hosting tiene ` +
        `disco persistente real — en Render/Railway con plan sin disco persistente, el archivo ` +
        `desaparecerá en el próximo redeploy o reinicio.`
    );
  }

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
