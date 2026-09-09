import { FacturacionElectronicaEC, generateClaveAcceso, generateCodigoNumerico, getCodDoc, validateXmlAgainstXsd } from 'facturacion-electronica-ec';
import type { DocumentType } from 'facturacion-electronica-ec';
import { supabase } from '../db/supabase.js';
import { SupabaseSequenceProvider } from '../sequence/supabaseSequenceProvider.js';
import { descifrar, descifrarTexto, pgByteaABuffer } from '../crypto/secrets.js';
import { obtenerEmisor, obtenerPuntoEmisionActivo } from '../db/consultas.js';
import { escapeXml } from './xml.js';

import { normalizarFechaEmisionEcuador } from '../utils/fechaEcuador.js';
type MensajeSriDocumento = {
  identificador?: string;
  mensaje?: string;
  informacionAdicional?: string;
  tipo?: string;
};

type ResultadoDocumentoSri = {
  estado: string;
  ambiente: 'pruebas' | 'produccion';
  claveAcceso: string;
  secuencial: string;
  xmlOriginal: string;
  xmlFirmado: string;
  numeroAutorizacion: string | null;
  fechaAutorizacion: Date | null;
  mensaje?: string;
  mensajes?: MensajeSriDocumento[];
};

type RespuestaSriDocumento = {
  estado?: unknown;
  mensaje?: unknown;
  mensajes?: unknown;
  comprobantes?: unknown;
  numeroAutorizacion?: unknown;
  fechaAutorizacion?: unknown;
};

function normalizarEstadoSriDocumento(estado: unknown): string {
  const v = String(estado ?? '').trim().toUpperCase();
  return v === 'DEVUELTO' ? 'DEVUELTA' : v;
}

function extraerMensajesDocumento(respuesta: unknown): MensajeSriDocumento[] {
  const r = (respuesta ?? {}) as RespuestaSriDocumento;
  const directos = Array.isArray(r.mensajes) ? r.mensajes : [];
  const root = r.comprobantes as { comprobante?: unknown } | null | undefined;
  const raw = root?.comprobante;
  const comprobantes = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const anidados = comprobantes.flatMap((c) => {
    const m = (c as { mensajes?: unknown } | null | undefined)?.mensajes;
    return Array.isArray(m) ? m : [];
  });
  return [...directos, ...anidados]
    .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
    .map((m) => ({
      identificador: m.identificador != null ? String(m.identificador) : undefined,
      mensaje: m.mensaje != null ? String(m.mensaje) : undefined,
      informacionAdicional: m.informacionAdicional != null ? String(m.informacionAdicional) : undefined,
      tipo: m.tipo != null ? String(m.tipo) : undefined,
    }));
}

function formatearMensajesDocumento(respuesta: unknown): string {
  return extraerMensajesDocumento(respuesta).map((m) => {
    const codigo = m.identificador ? `${m.identificador}: ` : '';
    const detalle = m.informacionAdicional ? ` — ${m.informacionAdicional}` : '';
    return `${codigo}${m.mensaje ?? ''}${detalle}`.trim();
  }).filter(Boolean).join('; ');
}

const MAP: Record<string, { sdk: DocumentType; root: string }> = {
  nota_credito: { sdk: 'NOTA_CREDITO', root: 'notaCredito' },
  nota_debito: { sdk: 'NOTA_DEBITO', root: 'notaDebito' },
  liquidacion_compra: { sdk: 'LIQUIDACION_COMPRA', root: 'liquidacionCompra' },
  guia_remision: { sdk: 'GUIA_REMISION', root: 'guiaRemision' },
  retencion: { sdk: 'COMPROBANTE_RETENCION', root: 'comprobanteRetencion' },
};

function dateDdMmYyyy(v: unknown): string {
  return normalizarFechaEmisionEcuador(v);
}

function addProviderRuc(xml: string, root: string, ruc: string): string {
  const field = `<campoAdicional nombre="RUC Proveedor">${escapeXml(ruc)}</campoAdicional>`;
  const info = `<infoAdicional>${field}</infoAdicional>`;
  const re = new RegExp(`<infoAdicional>([\\s\\S]*?)<\\/infoAdicional>`, 'i');
  if (re.test(xml)) {
    return xml.replace(re, (whole) => /nombre=["']RUC Proveedor["']/i.test(whole)
      ? whole.replace(/(<campoAdicional\s+[^>]*nombre=["']RUC Proveedor["'][^>]*>)[\s\S]*?(<\/campoAdicional>)/i, `$1${escapeXml(ruc)}$2`)
      : whole.replace('</infoAdicional>', `${field}</infoAdicional>`));
  }
  const close = `</${root}>`;
  const p = xml.lastIndexOf(close);
  if (p < 0) throw new Error(`No se encontró ${close} para insertar el RUC del proveedor.`);
  return xml.slice(0,p) + info + xml.slice(p);
}

async function construir(emisorId: string) {
  const emisor = await obtenerEmisor(emisorId);
  const punto = await obtenerPuntoEmisionActivo(emisorId);
  const { data: cert, error } = await supabase.from('certificados').select('*').eq('emisor_id', emisorId).eq('activo', true).limit(1).single();
  if (error || !cert) throw new Error('El emisor no tiene certificado electrónico activo.');
  if (new Date(cert.fecha_expiracion) < new Date()) throw new Error(`El certificado está vencido (${cert.fecha_expiracion}).`);
  const p12 = descifrar(pgByteaABuffer(cert.p12_cifrado));
  const pass = descifrarTexto(pgByteaABuffer(cert.p12_password_cifrado));
  const seq = new SupabaseSequenceProvider(emisorId);
  const ambiente = emisor.ambiente === 'produccion' ? '2' : '1';
  const fe = new FacturacionElectronicaEC({
    emisor: { ruc: emisor.ruc, razonSocial: emisor.razon_social, nombreComercial: emisor.nombre_comercial ?? undefined,
      dirMatriz: emisor.direccion_matriz, establecimiento: punto.establecimiento, puntoEmision: punto.punto_emision,
      direccionEstablecimiento: punto.direccion, contribuyenteEspecial: emisor.contribuyente_especial ?? undefined,
      obligadoContabilidad: emisor.obligado_contabilidad, ambiente, agenteRetencion: emisor.agente_retencion ? 'SI' : undefined },
    p12, p12Password: pass, sequenceProvider: seq, validateXsd: true,
    maxError70Retries: 3, maxSendRetries: 2, sendRetryDelayMs: 2000, authorizationDelayMs: 1500,
  });
  return { fe, seq, ambiente: ambiente as '1'|'2', ruc: emisor.ruc, establecimiento: punto.establecimiento, puntoEmision: punto.punto_emision };
}

export async function emitirDocumentoSri(emisorId: string, tipo: string, datos: Record<string, unknown>): Promise<ResultadoDocumentoSri> {
  const cfg = MAP[tipo];
  if (!cfg) throw new Error('Tipo de documento SRI no soportado.');
  const centralProveedor = process.env.RUC_PROVEEDOR_FACTURACION?.trim();
  const { data: conf } = await supabase.from('configuracion_sistema').select('ruc_proveedor_facturacion').eq('emisor_id', emisorId).maybeSingle();
  const rucProveedor = centralProveedor || (conf?.ruc_proveedor_facturacion ? String(conf.ruc_proveedor_facturacion).trim() : '');
  if (!/^\d{13}$/.test(rucProveedor)) throw new Error('Debe existir un RUC de proveedor de facturación válido de 13 dígitos.');

  const { fe, seq, ambiente, ruc, establecimiento, puntoEmision } = await construir(emisorId);
  const fecha = dateDdMmYyyy(datos.fechaEmision);
  const secuencial = await seq.next(establecimiento, puntoEmision, cfg.sdk);
  const clave = generateClaveAcceso({ fechaEmision: fecha, tipoComprobante: getCodDoc(cfg.sdk), ruc, ambiente, establecimiento, puntoEmision, secuencial, codigoNumerico: generateCodigoNumerico(), tipoEmision: '1' });
  const xmlBase = fe.buildXml(cfg.sdk, datos as never, { secuencial, claveAcceso: clave });
  const xml = addProviderRuc(xmlBase, cfg.root, rucProveedor);
  const xsd = await validateXmlAgainstXsd(cfg.sdk, xml);
  if (!xsd.valid) throw new Error(`XML rechazado por validación XSD local: ${xsd.errors.join('; ')}`);
  const firmado = await fe.signXml(xml, cfg.sdk);
  const recepcion = await fe.sendToSri(firmado);
  const recepcionAny = recepcion as unknown as RespuestaSriDocumento;
  const estadoRecepcion = normalizarEstadoSriDocumento(recepcionAny.estado);
  if (estadoRecepcion === 'DEVUELTA') {
    const msg = formatearMensajesDocumento(recepcionAny);
    return {
      estado: 'DEVUELTA',
      ambiente: ambiente === '2' ? 'produccion' : 'pruebas',
      claveAcceso: clave,
      secuencial,
      xmlOriginal: xml,
      xmlFirmado: firmado,
      numeroAutorizacion: null,
      fechaAutorizacion: null,
      mensaje: msg || String(recepcionAny.mensaje ?? 'Comprobante devuelto por el SRI.'),
      mensajes: extraerMensajesDocumento(recepcionAny),
    };
  }

  await new Promise(r => setTimeout(r, 1500));
  let auth: unknown = null;
  let ultimoError: unknown = null;
  for (let intento = 0; intento < 10; intento++) {
    try {
      auth = await fe.checkAuthorization(clave);
      ultimoError = null;
      const estado = normalizarEstadoSriDocumento((auth as RespuestaSriDocumento).estado);
      if (['AUTORIZADO', 'NO AUTORIZADO', 'RECHAZADA', 'DEVUELTA'].includes(estado)) break;
    } catch (e) {
      ultimoError = e;
    }
    if (intento < 9) await new Promise(r => setTimeout(r, 2000));
  }

  const authAny = (auth ?? {}) as RespuestaSriDocumento;
  const estadoAuth = normalizarEstadoSriDocumento(authAny.estado);
  const mensajeAutorizacion = String(authAny.mensaje ?? '').trim() || formatearMensajesDocumento(authAny) ||
    (ultimoError instanceof Error ? ultimoError.message : (estadoAuth ? `El SRI devolvió el estado ${estadoAuth}.` : 'El SRI recibió el comprobante, pero todavía no devuelve la autorización.'));
  const fechaAuth = authAny.fechaAutorizacion ? new Date(String(authAny.fechaAutorizacion)) : null;

  return {
    estado: estadoAuth || 'EN PROCESAMIENTO',
    ambiente: ambiente === '2' ? 'produccion' : 'pruebas',
    claveAcceso: clave,
    secuencial,
    xmlOriginal: xml,
    xmlFirmado: firmado,
    numeroAutorizacion: authAny.numeroAutorizacion ? String(authAny.numeroAutorizacion) : null,
    fechaAutorizacion: fechaAuth && !Number.isNaN(fechaAuth.getTime()) ? fechaAuth : null,
    mensaje: mensajeAutorizacion,
    mensajes: extraerMensajesDocumento(authAny),
  };
}

function texto(d: Record<string, unknown>, ...claves: string[]): string {
  for (const clave of claves) {
    const v = d[clave];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

function numero(d: Record<string, unknown>, clave: string): number {
  const n = Number(d[clave]);
  return Number.isFinite(n) ? n : NaN;
}

export function validarDatosDocumento(tipo: string, d: Record<string, unknown>): void {
  const faltan: string[] = [];
  const exigir = (ok: boolean, campo: string) => { if (!ok) faltan.push(campo); };
  exigir(/^\d{2}\/\d{2}\/\d{4}$/.test(String(d.fechaEmision ?? '')), 'fechaEmision (dd/mm/yyyy)');

  if (tipo === 'nota_credito') {
    exigir(!!texto(d,'tipoIdentificacionComprador'), 'tipoIdentificacionComprador');
    exigir(!!texto(d,'razonSocialComprador'), 'razonSocialComprador');
    exigir(!!texto(d,'identificacionComprador'), 'identificacionComprador');
    exigir(texto(d,'codDocModificado') === '01', 'codDocModificado=01 (factura)');
    exigir(/^\d{3}-\d{3}-\d{9}$/.test(texto(d,'numDocModificado')), 'numDocModificado');
    exigir(/^\d{2}\/\d{2}\/\d{4}$/.test(texto(d,'fechaEmisionDocSustento')), 'fechaEmisionDocSustento');
    exigir(Number.isFinite(numero(d,'totalSinImpuestos')), 'totalSinImpuestos');
    exigir(Number.isFinite(numero(d,'valorModificacion')), 'valorModificacion');
    exigir(!!texto(d,'motivo'), 'motivo');
    exigir(Array.isArray(d.detalles) && d.detalles.length > 0, 'detalles');
    exigir(Array.isArray(d.totalConImpuestos) && d.totalConImpuestos.length > 0, 'totalConImpuestos');
  } else if (tipo === 'nota_debito') {
    exigir(!!texto(d,'tipoIdentificacionComprador'), 'tipoIdentificacionComprador');
    exigir(!!texto(d,'razonSocialComprador'), 'razonSocialComprador');
    exigir(!!texto(d,'identificacionComprador'), 'identificacionComprador');
    exigir(texto(d,'codDocModificado') === '01', 'codDocModificado=01 (factura)');
    exigir(/^\d{3}-\d{3}-\d{9}$/.test(texto(d,'numDocModificado')), 'numDocModificado');
    exigir(/^\d{2}\/\d{2}\/\d{4}$/.test(texto(d,'fechaEmisionDocSustento')), 'fechaEmisionDocSustento');
    exigir(Number.isFinite(numero(d,'totalSinImpuestos')), 'totalSinImpuestos');
    exigir(Number.isFinite(numero(d,'valorTotal')), 'valorTotal');
    exigir(Array.isArray(d.motivos) && d.motivos.length > 0, 'motivos');
    exigir(Array.isArray(d.impuestos) && d.impuestos.length > 0, 'impuestos');
  } else if (tipo === 'liquidacion_compra') {
    exigir(!!texto(d,'tipoIdentificacionProveedor'), 'tipoIdentificacionProveedor');
    exigir(!!texto(d,'razonSocialProveedor'), 'razonSocialProveedor');
    exigir(!!texto(d,'identificacionProveedor'), 'identificacionProveedor');
    exigir(Number.isFinite(numero(d,'totalSinImpuestos')), 'totalSinImpuestos');
    exigir(Number.isFinite(numero(d,'importeTotal')), 'importeTotal');
    exigir(Array.isArray(d.pagos) && d.pagos.length > 0, 'pagos');
    exigir(Array.isArray(d.detalles) && d.detalles.length > 0, 'detalles');
  } else if (tipo === 'guia_remision') {
    exigir(!!texto(d,'dirPartida'), 'dirPartida');
    exigir(!!texto(d,'razonSocialTransportista'), 'razonSocialTransportista');
    exigir(!!texto(d,'tipoIdentificacionTransportista'), 'tipoIdentificacionTransportista');
    exigir(!!texto(d,'rucTransportista'), 'rucTransportista');
    exigir(/^\d{2}\/\d{2}\/\d{4}$/.test(texto(d,'fechaIniTransporte')), 'fechaIniTransporte');
    exigir(/^\d{2}\/\d{2}\/\d{4}$/.test(texto(d,'fechaFinTransporte')), 'fechaFinTransporte');
    exigir(!!texto(d,'placa'), 'placa');
    exigir(Array.isArray(d.destinatarios) && d.destinatarios.length > 0, 'destinatarios');
  } else if (tipo === 'retencion') {
    exigir(!!texto(d,'tipoIdentificacionSujetoRetenido'), 'tipoIdentificacionSujetoRetenido');
    exigir(!!texto(d,'razonSocialSujetoRetenido'), 'razonSocialSujetoRetenido');
    exigir(!!texto(d,'identificacionSujetoRetenido'), 'identificacionSujetoRetenido');
    exigir(/^\d{2}\/\d{4}$/.test(texto(d,'periodoFiscal')), 'periodoFiscal (mm/yyyy)');
    exigir(Array.isArray(d.docsSustento) && d.docsSustento.length > 0, 'docsSustento');
  }
  if (faltan.length) throw new Error(`Datos incompletos para ${tipo}: ${faltan.join(', ')}.`);
}

export function normalizarDatosDocumento(tipo: string, datos: Record<string, unknown>): Record<string, unknown> {
  const d = structuredClone(datos);
  // Compatibilidad con el formulario anterior: nunca dejamos nombres genéricos
  // como "sustento" o "motivo" sin convertirlos al campo SRI real.
  if (tipo === 'nota_credito' || tipo === 'nota_debito') {
    if (!d.numDocModificado && d.sustento) d.numDocModificado = d.sustento;
    if (!d.motivo && d.detalle) d.motivo = d.detalle;
    if (!d.razonSocialComprador && d.razonSocial) d.razonSocialComprador = d.razonSocial;
    if (!d.identificacionComprador && d.identificacion) d.identificacionComprador = d.identificacion;
    if (!d.tipoIdentificacionComprador) d.tipoIdentificacionComprador = /^\d{13}$/.test(String(d.identificacionComprador ?? '')) ? '04' : '05';
  }
  if (tipo === 'liquidacion_compra') {
    if (!d.razonSocialProveedor && d.razonSocial) d.razonSocialProveedor = d.razonSocial;
    if (!d.identificacionProveedor && d.identificacion) d.identificacionProveedor = d.identificacion;
  }
  if (tipo === 'retencion') {
    if (!d.razonSocialSujetoRetenido && d.razonSocial) d.razonSocialSujetoRetenido = d.razonSocial;
    if (!d.identificacionSujetoRetenido && d.identificacion) d.identificacionSujetoRetenido = d.identificacion;
    if (!d.tipoIdentificacionSujetoRetenido) d.tipoIdentificacionSujetoRetenido = /^\d{13}$/.test(String(d.identificacionSujetoRetenido ?? '')) ? '04' : '05';
  }
  if ('fechaEmision' in d) d.fechaEmision = dateDdMmYyyy(d.fechaEmision);
  for (const k of ['fechaEmisionDocSustento','fechaIniTransporte','fechaFinTransporte']) {
    if (k in d && d[k]) d[k] = dateDdMmYyyy(d[k]);
  }
  if (tipo === 'retencion' && typeof d.periodoFiscal === 'string' && /^\d{4}-\d{2}$/.test(d.periodoFiscal)) d.periodoFiscal = `${d.periodoFiscal.slice(5)}/${d.periodoFiscal.slice(0,4)}`;
  return d;
}
