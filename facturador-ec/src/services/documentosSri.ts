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

export async function consultarAutorizacionDocumentoSri(emisorId: string, claveAcceso: string): Promise<{estado:string;numeroAutorizacion:string|null;fechaAutorizacion:Date|null;mensaje?:string;mensajes?:MensajeSriDocumento[]}> {
  if (!/^\d{49}$/.test(String(claveAcceso ?? '').trim())) throw new Error('La clave de acceso del comprobante no es válida.');
  const { fe } = await construir(emisorId);
  let auth: unknown = null;
  let ultimoError: unknown = null;
  for (let intento = 0; intento < 6; intento++) {
    try {
      auth = await fe.checkAuthorization(String(claveAcceso).trim());
      ultimoError = null;
      const estado = normalizarEstadoSriDocumento((auth as RespuestaSriDocumento).estado);
      if (['AUTORIZADO', 'NO AUTORIZADO', 'RECHAZADA', 'DEVUELTA'].includes(estado)) break;
    } catch (e) {
      ultimoError = e;
    }
    if (intento < 5) await new Promise(r => setTimeout(r, 2000));
  }
  const r = (auth ?? {}) as RespuestaSriDocumento;
  const estado = normalizarEstadoSriDocumento(r.estado) || 'EN PROCESAMIENTO';
  const mensaje = String(r.mensaje ?? '').trim() || formatearMensajesDocumento(r) ||
    (ultimoError instanceof Error ? ultimoError.message : undefined);
  const fecha = r.fechaAutorizacion ? new Date(String(r.fechaAutorizacion)) : null;
  return {
    estado,
    numeroAutorizacion: r.numeroAutorizacion ? String(r.numeroAutorizacion) : null,
    fechaAutorizacion: fecha && !Number.isNaN(fecha.getTime()) ? fecha : null,
    mensaje,
    mensajes: extraerMensajesDocumento(r),
  };
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
  const casiIgual = (a: number, b: number) => Math.abs(a - b) <= 0.02;
  exigir(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(d.correoElectronico ?? '').trim()), 'correoElectronico válido y obligatorio');
  const montoNoNegativo = (v: unknown) => Number.isFinite(Number(v)) && Number(v) >= 0;
  exigir(/^\d{2}\/\d{2}\/\d{4}$/.test(String(d.fechaEmision ?? '')), 'fechaEmision (dd/mm/yyyy)');

  if (tipo === 'nota_credito') {
    exigir(!!texto(d,'tipoIdentificacionComprador'), 'tipoIdentificacionComprador');
    exigir(!!texto(d,'razonSocialComprador'), 'razonSocialComprador');
    exigir(!!texto(d,'identificacionComprador'), 'identificacionComprador');
    exigir(texto(d,'codDocModificado') === '01', 'codDocModificado=01 (factura)');
    exigir(/^\d{3}-\d{3}-\d{9}$/.test(texto(d,'numDocModificado')), 'numDocModificado');
    exigir(/^\d{2}\/\d{2}\/\d{4}$/.test(texto(d,'fechaEmisionDocSustento')), 'fechaEmisionDocSustento');
    exigir(montoNoNegativo(d.totalSinImpuestos), 'totalSinImpuestos');
    exigir(Number(d.valorModificacion) > 0, 'valorModificacion mayor a 0');
    exigir(!!texto(d,'motivo'), 'motivo');
    exigir(Array.isArray(d.detalles) && d.detalles.length > 0, 'detalles');
    exigir(Array.isArray(d.totalConImpuestos) && d.totalConImpuestos.length > 0, 'totalConImpuestos');
    if (Array.isArray(d.detalles)) {
      const base = d.detalles.reduce((s:any,x:any)=>s+Number(x?.precioTotalSinImpuesto||0),0);
      const iva = d.detalles.reduce((s:any,x:any)=>s+(Array.isArray(x?.impuestos)?x.impuestos.reduce((a:any,t:any)=>a+Number(t?.valor||0),0):0),0);
      exigir(casiIgual(base, Number(d.totalSinImpuestos||0)), 'detalle vs totalSinImpuestos');
      exigir(casiIgual(base+iva, Number(d.valorModificacion||0)), 'detalle+IVA vs valorModificacion');
    }
  } else if (tipo === 'nota_debito') {
    exigir(!!texto(d,'tipoIdentificacionComprador'), 'tipoIdentificacionComprador');
    exigir(!!texto(d,'razonSocialComprador'), 'razonSocialComprador');
    exigir(!!texto(d,'identificacionComprador'), 'identificacionComprador');
    exigir(texto(d,'codDocModificado') === '01', 'codDocModificado=01 (factura)');
    exigir(/^\d{3}-\d{3}-\d{9}$/.test(texto(d,'numDocModificado')), 'numDocModificado');
    exigir(/^\d{2}\/\d{2}\/\d{4}$/.test(texto(d,'fechaEmisionDocSustento')), 'fechaEmisionDocSustento');
    exigir(Number(d.totalSinImpuestos) > 0, 'totalSinImpuestos mayor a 0');
    exigir(Number(d.valorTotal) > 0, 'valorTotal mayor a 0');
    exigir(Array.isArray(d.motivos) && d.motivos.length > 0, 'motivos');
    exigir(Array.isArray(d.impuestos) && d.impuestos.length > 0, 'impuestos');
    if (Array.isArray(d.motivos)) exigir(casiIgual(d.motivos.reduce((s:any,x:any)=>s+Number(x?.valor||0),0), Number(d.totalSinImpuestos||0)), 'suma de motivos vs totalSinImpuestos');
    if (Array.isArray(d.impuestos)) exigir(casiIgual(d.impuestos.reduce((s:any,x:any)=>s+Number(x?.valor||0),0)+Number(d.totalSinImpuestos||0), Number(d.valorTotal||0)), 'impuestos vs valorTotal');
  } else if (tipo === 'liquidacion_compra') {
    exigir(!!texto(d,'tipoIdentificacionProveedor'), 'tipoIdentificacionProveedor');
    exigir(!!texto(d,'razonSocialProveedor'), 'razonSocialProveedor');
    exigir(!!texto(d,'identificacionProveedor'), 'identificacionProveedor');
    exigir(Number(d.totalSinImpuestos) > 0, 'totalSinImpuestos mayor a 0');
    exigir(Number(d.importeTotal) > 0, 'importeTotal mayor a 0');
    exigir(montoNoNegativo(d.totalDescuento), 'totalDescuento');
    exigir(Array.isArray(d.pagos) && d.pagos.length > 0, 'pagos');
    exigir(Array.isArray(d.detalles) && d.detalles.length > 0, 'detalles');
    if (Array.isArray(d.detalles)) exigir(casiIgual(d.detalles.reduce((s:any,x:any)=>s+Number(x?.precioTotalSinImpuesto||0),0), Number(d.totalSinImpuestos||0)), 'detalle vs totalSinImpuestos');
    if (Array.isArray(d.pagos)) exigir(casiIgual(d.pagos.reduce((s:any,x:any)=>s+Number(x?.total||0),0), Number(d.importeTotal||0)), 'pagos vs importeTotal');
  } else if (tipo === 'guia_remision') {
    exigir(!!texto(d,'dirPartida'), 'dirPartida');
    exigir(!!texto(d,'razonSocialTransportista'), 'razonSocialTransportista');
    exigir(!!texto(d,'tipoIdentificacionTransportista'), 'tipoIdentificacionTransportista');
    exigir(!!texto(d,'rucTransportista'), 'rucTransportista');
    exigir(/^\d{2}\/\d{2}\/\d{4}$/.test(texto(d,'fechaIniTransporte')), 'fechaIniTransporte');
    exigir(/^\d{2}\/\d{2}\/\d{4}$/.test(texto(d,'fechaFinTransporte')), 'fechaFinTransporte');
    exigir(!!texto(d,'placa'), 'placa');
    exigir(Array.isArray(d.destinatarios) && d.destinatarios.length > 0, 'destinatarios');
    if (Array.isArray(d.destinatarios)) d.destinatarios.forEach((x:any,i:number)=>{ exigir(!!texto(x,'identificacionDestinatario'), `destinatarios[${i}].identificacionDestinatario`); exigir(!!texto(x,'razonSocialDestinatario'), `destinatarios[${i}].razonSocialDestinatario`); exigir(!!texto(x,'dirDestinatario'), `destinatarios[${i}].dirDestinatario`); exigir(!!texto(x,'motivoTraslado'), `destinatarios[${i}].motivoTraslado`); exigir(Array.isArray(x.detalles)&&x.detalles.length>0, `destinatarios[${i}].detalles`); });
  } else if (tipo === 'retencion') {
    exigir(!!texto(d,'tipoIdentificacionSujetoRetenido'), 'tipoIdentificacionSujetoRetenido');
    exigir(!!texto(d,'razonSocialSujetoRetenido'), 'razonSocialSujetoRetenido');
    exigir(!!texto(d,'identificacionSujetoRetenido'), 'identificacionSujetoRetenido');
    exigir(/^\d{2}\/\d{4}$/.test(texto(d,'periodoFiscal')), 'periodoFiscal (mm/yyyy)');
    exigir(Array.isArray(d.docsSustento) && d.docsSustento.length > 0, 'docsSustento');
    if (Array.isArray(d.docsSustento)) d.docsSustento.forEach((x:any,i:number)=>{ exigir(!!texto(x,'codSustento'), `docsSustento[${i}].codSustento`); exigir(!!texto(x,'codDocSustento'), `docsSustento[${i}].codDocSustento`); exigir(!!texto(x,'numDocSustento'), `docsSustento[${i}].numDocSustento`); exigir(/^\d{2}\/\d{2}\/\d{4}$/.test(texto(x,'fechaEmisionDocSustento')), `docsSustento[${i}].fechaEmisionDocSustento`); exigir(/^\d{49}$/.test(texto(x,'numAutDocSustento')), `docsSustento[${i}].numAutDocSustento (49 dígitos)`); exigir(Array.isArray(x.retenciones)&&x.retenciones.length>0, `docsSustento[${i}].retenciones`); if(Array.isArray(x.retenciones)) x.retenciones.forEach((r:any,j:number)=>{ exigir(!!texto(r,'codigo'), `retenciones[${i}][${j}].codigo`); exigir(!!texto(r,'codigoRetencion'), `retenciones[${i}][${j}].codigoRetencion`); exigir(Number(r.valorRetenido)>0, `retenciones[${i}][${j}].valorRetenido`); }); });
  }
  if (faltan.length) throw new Error(`Datos incompletos o inconsistentes para ${tipo}: ${faltan.join(', ')}.`);
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
  if (tipo === 'nota_credito') {
    // SDK 1.0.1 espera TotalTax plano: codigo, codigoPorcentaje, baseImponible y valor.
    // Versiones anteriores de CONTSERTRIB guardaron accidentalmente la forma anidada
    // { codigo, impuestos:[...] }, que terminaba provocando errores toFixed(undefined).
    if (Array.isArray(d.totalConImpuestos)) {
      d.totalConImpuestos = d.totalConImpuestos.flatMap((t:any) => {
        if (Array.isArray(t?.impuestos)) return t.impuestos.map((x:any) => ({
          codigo: String(x?.codigo ?? t?.codigo ?? '2'),
          codigoPorcentaje: String(x?.codigoPorcentaje ?? '0'),
          baseImponible: Number(x?.baseImponible ?? 0),
          valor: Number(x?.valor ?? 0),
        }));
        return [{
          codigo: String(t?.codigo ?? '2'),
          codigoPorcentaje: String(t?.codigoPorcentaje ?? '0'),
          baseImponible: Number(t?.baseImponible ?? 0),
          valor: Number(t?.valor ?? 0),
        }];
      });
    }
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
  if (tipo === 'guia_remision' && Array.isArray(d.destinatarios)) {
    d.destinatarios = d.destinatarios.map((x: any) => ({ ...x, fechaEmisionDocSustento: x?.fechaEmisionDocSustento ? dateDdMmYyyy(x.fechaEmisionDocSustento) : x?.fechaEmisionDocSustento }));
  }
  if (tipo === 'retencion' && Array.isArray(d.docsSustento)) {
    d.docsSustento = d.docsSustento.map((x: any) => ({ ...x, fechaEmisionDocSustento: dateDdMmYyyy(x.fechaEmisionDocSustento), fechaRegistroContable: x?.fechaRegistroContable ? dateDdMmYyyy(x.fechaRegistroContable) : x?.fechaRegistroContable }));
  }
  return d;
}
