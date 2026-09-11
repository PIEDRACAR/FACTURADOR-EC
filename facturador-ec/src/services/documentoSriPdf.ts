import PDFDocument from 'pdfkit';
import { supabase } from '../db/supabase.js';

const NOMBRES: Record<string,string> = {
  nota_credito: 'NOTA DE CRÉDITO',
  nota_debito: 'NOTA DE DÉBITO',
  liquidacion_compra: 'LIQUIDACIÓN DE COMPRA DE BIENES Y PRESTACIÓN DE SERVICIOS',
  guia_remision: 'GUÍA DE REMISIÓN',
  retencion: 'COMPROBANTE DE RETENCIÓN',
};

function money(v: unknown) { return Number(v ?? 0).toFixed(2); }
function text(v: unknown) { return String(v ?? '—'); }
function escFilename(v: string) { return v.replace(/[^a-zA-Z0-9._-]/g, '_'); }
function fechaEc(v: unknown) {
  if (!v) return '—';
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return text(v);
  return new Intl.DateTimeFormat('es-EC',{timeZone:'America/Guayaquil',dateStyle:'short',timeStyle:'medium'}).format(d);
}
function line(doc: any, y: number) { doc.moveTo(42,y).lineTo(553,y).strokeColor('#d1d5db').stroke(); }
function section(doc: any, title: string) {
  doc.moveDown(0.6); doc.fontSize(10).fillColor('#0f2747').font('Helvetica-Bold').text(title); doc.moveDown(0.2); doc.font('Helvetica').fillColor('#111827');
}
function row(doc: any, label: string, value: unknown) {
  doc.fontSize(8.5).font('Helvetica-Bold').text(`${label}: `,{continued:true});
  doc.font('Helvetica').text(text(value));
}
function listObject(doc: any, title: string, obj: Record<string, unknown>) {
  section(doc,title);
  for (const [k,v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === '') continue;
    if (typeof v !== 'object') row(doc,k,v);
  }
}

export async function obtenerDocumentoSriPdf(id: string): Promise<{buffer: Buffer; filename: string; tipo: string; secuencial: string; email: string; estado: string}> {
  const { data: d, error } = await supabase.from('documentos_sri_borrador').select('id,emisor_id,tipo,estado,secuencial,clave_acceso,numero_autorizacion,fecha_autorizacion,created_at,datos,xml_firmado,emisores(razon_social,nombre_comercial,ruc,direccion_matriz)').eq('id',id).single();
  if (error || !d) throw new Error('Documento electrónico no encontrado.');
  if (d.estado !== 'autorizado') throw new Error('El PDF oficial solo está disponible para comprobantes autorizados por el SRI.');
  const datos = (d.datos ?? {}) as Record<string, any>;
  const emisor = d.emisores as any;
  const tipoNombre = NOMBRES[d.tipo] ?? d.tipo;
  const sec = String(d.secuencial ?? 'sin-secuencial');
  const doc = new PDFDocument({ size:'A4', margin:42, bufferPages:true });
  const chunks: Buffer[] = [];
  doc.on('data',(c: Buffer)=>chunks.push(c));
  const done = new Promise<Buffer>((resolve,reject)=>{ doc.on('end',()=>resolve(Buffer.concat(chunks))); doc.on('error',reject); });

  doc.fontSize(16).font('Helvetica-Bold').fillColor('#0f2747').text(emisor?.nombre_comercial || emisor?.razon_social || 'CONTSERTRIB FACTURACIÓN');
  doc.fontSize(8.5).font('Helvetica').fillColor('#374151').text(`RUC: ${text(emisor?.ruc)}  |  ${text(emisor?.direccion_matriz)}`);
  doc.moveDown(0.5); line(doc,doc.y); doc.moveDown(0.6);
  doc.fontSize(13).font('Helvetica-Bold').fillColor('#111827').text(tipoNombre);
  doc.fontSize(9).font('Helvetica').text(`No. ${sec}`);
  row(doc,'Estado SRI',String(d.estado).toUpperCase());
  row(doc,'Número de autorización',d.numero_autorizacion || d.clave_acceso);
  row(doc,'Fecha de emisión',datos.fechaEmision || d.created_at);
  row(doc,'Fecha de autorización',fechaEc(d.fecha_autorizacion));
  row(doc,'Clave de acceso',d.clave_acceso);

  const datosGenerales: Record<string,unknown> = {};
  const campos = ['razonSocialComprador','identificacionComprador','direccionComprador','correoElectronico','razonSocialProveedor','identificacionProveedor','direccionProveedor','razonSocialSujetoRetenido','identificacionSujetoRetenido','periodoFiscal','dirPartida','razonSocialTransportista','rucTransportista','placa','dirLlegada'];
  for (const k of campos) if (datos[k] !== undefined) datosGenerales[k] = datos[k];
  if (Object.keys(datosGenerales).length) listObject(doc,'DATOS DEL COMPROBANTE',datosGenerales);

  if (d.tipo === 'nota_credito') {
    section(doc,'DETALLE DE LA MODIFICACIÓN'); row(doc,'Documento modificado',datos.numDocModificado); row(doc,'Fecha documento sustento',datos.fechaEmisionDocSustento); row(doc,'Motivo',datos.motivo);
    const detalles = Array.isArray(datos.detalles) ? datos.detalles : [];
    if (detalles.length) { doc.moveDown(.4); doc.fontSize(8).font('Helvetica-Bold').text('Descripción                 Cant.     P.Unit.       Descuento       Base'); for (const x of detalles) doc.font('Helvetica').text(`${text(x.descripcion).slice(0,34)}  ${money(x.cantidad)}   $${money(x.precioUnitario)}   $${money(x.descuento)}   $${money(x.precioTotalSinImpuesto)}`); }
    section(doc,'TOTALES'); row(doc,'Total sin impuestos',money(datos.totalSinImpuestos)); row(doc,'Valor de modificación',money(datos.valorModificacion));
  } else if (d.tipo === 'nota_debito') {
    section(doc,'MOTIVOS'); for (const x of (Array.isArray(datos.motivos)?datos.motivos:[])) row(doc,'Motivo',`${text(x.razon)} — $${money(x.valor)}`);
    section(doc,'TOTALES'); row(doc,'Total sin impuestos',money(datos.totalSinImpuestos)); row(doc,'Valor total',money(datos.valorTotal));
  } else if (d.tipo === 'liquidacion_compra') {
    section(doc,'DETALLE'); for (const x of (Array.isArray(datos.detalles)?datos.detalles:[])) row(doc,text(x.descripcion),`Cant. ${money(x.cantidad)} × $${money(x.precioUnitario)} = $${money(x.precioTotalSinImpuesto)}`);
    section(doc,'TOTALES'); row(doc,'Total sin impuestos',money(datos.totalSinImpuestos)); row(doc,'Descuento',money(datos.totalDescuento)); row(doc,'Importe total',money(datos.importeTotal));
    section(doc,'FORMAS DE PAGO'); for (const x of (Array.isArray(datos.pagos)?datos.pagos:[])) row(doc,text(x.formaPago),`$${money(x.total)}`);
  } else if (d.tipo === 'guia_remision') {
    section(doc,'TRANSPORTE'); row(doc,'Fecha inicio',datos.fechaIniTransporte); row(doc,'Fecha fin',datos.fechaFinTransporte); row(doc,'Dirección partida',datos.dirPartida); row(doc,'Placa',datos.placa);
    section(doc,'DESTINATARIOS'); for (const x of (Array.isArray(datos.destinatarios)?datos.destinatarios:[])) { row(doc,'Destinatario',`${text(x.razonSocialDestinatario)} — ${text(x.identificacionDestinatario)}`); row(doc,'Dirección',x.dirDestinatario); row(doc,'Motivo traslado',x.motivoTraslado); for (const z of (Array.isArray(x.detalles)?x.detalles:[])) row(doc,'  Producto',`${text(z.descripcion)} — Cant. ${money(z.cantidad)}`); }
  } else if (d.tipo === 'retencion') {
    section(doc,'DOCUMENTOS SUSTENTO'); for (const x of (Array.isArray(datos.docsSustento)?datos.docsSustento:[])) { row(doc,'Documento',x.numDocSustento); row(doc,'Fecha',x.fechaEmisionDocSustento); row(doc,'Autorización',x.numAutDocSustento); for (const r of (Array.isArray(x.retenciones)?x.retenciones:[])) row(doc,'Retención',`${text(r.codigoRetencion)} — Base $${money(r.baseImponible)} — Retenido $${money(r.valorRetenido)}`); }
  }

  doc.moveDown(.8); line(doc,doc.y); doc.moveDown(.4); doc.fontSize(7.5).fillColor('#4b5563').text('Representación impresa del comprobante electrónico. El XML firmado constituye el archivo electrónico autorizado por el SRI. Conserve ambos archivos conforme a las obligaciones tributarias aplicables.');
  doc.end();
  const buffer = await done;
  return { buffer, filename:`${escFilename(tipoNombre)}-${escFilename(sec)}.pdf`, tipo:d.tipo, secuencial:sec, email:String(datos.correoElectronico ?? '').trim().toLowerCase(), estado:d.estado };
}
