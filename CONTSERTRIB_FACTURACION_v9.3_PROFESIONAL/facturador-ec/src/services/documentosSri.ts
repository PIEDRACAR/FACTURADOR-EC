import { FacturacionElectronicaEC, generateClaveAcceso, generateCodigoNumerico, getCodDoc, validateXmlAgainstXsd } from 'facturacion-electronica-ec';
import type { DocumentType, EmissionResult } from 'facturacion-electronica-ec';
import { supabase } from '../db/supabase.js';
import { SupabaseSequenceProvider } from '../sequence/supabaseSequenceProvider.js';
import { descifrar, descifrarTexto, pgByteaABuffer } from '../crypto/secrets.js';
import { obtenerEmisor, obtenerPuntoEmisionActivo } from '../db/consultas.js';
import { escapeXml } from './xml.js';

const MAP: Record<string, { sdk: DocumentType; root: string }> = {
  nota_credito: { sdk: 'NOTA_CREDITO', root: 'notaCredito' },
  nota_debito: { sdk: 'NOTA_DEBITO', root: 'notaDebito' },
  liquidacion_compra: { sdk: 'LIQUIDACION_COMPRA', root: 'liquidacionCompra' },
  guia_remision: { sdk: 'GUIA_REMISION', root: 'guiaRemision' },
  retencion: { sdk: 'COMPROBANTE_RETENCION', root: 'comprobanteRetencion' },
};

function dateDdMmYyyy(v: unknown): string {
  const s = String(v ?? '').trim();
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) { const [y,m,d] = s.slice(0,10).split('-'); return `${d}/${m}/${y}`; }
  return new Intl.DateTimeFormat('es-EC').format(new Date());
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

export async function emitirDocumentoSri(emisorId: string, tipo: string, datos: Record<string, unknown>): Promise<EmissionResult> {
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
  if (recepcion.estado === 'DEVUELTA') {
    const msg = (recepcion.mensajes ?? []).map((m:any) => `${m.identificador}: ${m.mensaje}${m.informacionAdicional ? ` — ${m.informacionAdicional}` : ''}`).join('; ');
    return { estado: 'DEVUELTA', ambiente: ambiente === '2' ? 'produccion':'pruebas', claveAcceso: clave, secuencial, xmlOriginal: xml, xmlFirmado: firmado, numeroAutorizacion: null, fechaAutorizacion: null, mensaje: msg } as any;
  }
  await new Promise(r => setTimeout(r, 1500));
  const auth = await fe.checkAuthorization(clave);
  const authAny = auth as any;
  const mensajeAutorizacion = authAny.mensaje ?? (authAny.mensajes ?? []).map((m: any) => `${m.identificador ?? ''}: ${m.mensaje ?? ''}${m.informacionAdicional ? ` — ${m.informacionAdicional}` : ''}`).join('; ');
  return { estado: auth.estado, ambiente: ambiente === '2' ? 'produccion':'pruebas', claveAcceso: clave, secuencial, xmlOriginal: xml, xmlFirmado: firmado, numeroAutorizacion: auth.numeroAutorizacion ?? null, fechaAutorizacion: auth.fechaAutorizacion ?? null, mensaje: mensajeAutorizacion } as any;
}

export function normalizarDatosDocumento(tipo: string, datos: Record<string, unknown>): Record<string, unknown> {
  const d = structuredClone(datos);
  if ('fechaEmision' in d) d.fechaEmision = dateDdMmYyyy(d.fechaEmision);
  if (tipo === 'retencion' && typeof d.periodoFiscal === 'string' && /^\d{4}-\d{2}$/.test(d.periodoFiscal)) d.periodoFiscal = `${d.periodoFiscal.slice(5)}/${d.periodoFiscal.slice(0,4)}`;
  return d;
}
