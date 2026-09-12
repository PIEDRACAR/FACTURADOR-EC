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
  const esAutorizado = d.estado === 'autorizado';
  const datos = (d.datos ?? {}) as Record<string, any>;
  const emisor = d.emisores as any;
  const { data: conf } = await supabase.from('configuracion_sistema').select('logo_ride_base64,logo_ride_mime').eq('emisor_id', d.emisor_id).maybeSingle();
  const logoBase64 = String(conf?.logo_ride_base64 ?? '').trim();
  const logoMime = String(conf?.logo_ride_mime ?? '').toLowerCase();
  const tipoNombre = NOMBRES[d.tipo] ?? d.tipo;
  const sec = String(d.secuencial ?? 'BORRADOR');
  const doc = new PDFDocument({ size:'A4', margin:42, bufferPages:true });
  const chunks: Buffer[] = [];
  doc.on('data',(c: Buffer)=>chunks.push(c));
  const done = new Promise<Buffer>((resolve,reject)=>{ doc.on('end',()=>resolve(Buffer.concat(chunks))); doc.on('error',reject); });

  const headerX = logoBase64 && ['image/png','image/jpeg'].includes(logoMime) ? 150 : 42;
  if (headerX !== 42) { try { doc.image(Buffer.from(logoBase64, 'base64'), 42, 42, { fit: [92, 58], valign: 'center' }); } catch { /* se conserva encabezado estándar */ } }
  doc.fontSize(16).font('Helvetica-Bold').fillColor('#0f2747').text(emisor?.nombre_comercial || emisor?.razon_social || 'CONTSERTRIB FACTURACIÓN', headerX, 42, { width: 385 });
  doc.fontSize(8.5).font('Helvetica').fillColor('#374151').text(`RUC: ${text(emisor?.ruc)}  |  ${text(emisor?.direccion_matriz)}`, headerX, doc.y + 2, { width: 385 });
  doc.moveDown(0.5); line(doc,doc.y); doc.moveDown(0.6);
  doc.fontSize(13).font('Helvetica-Bold').fillColor('#111827').text(tipoNombre);
  doc.fontSize(9).font('Helvetica').text(`No. ${sec}`);
  if (!esAutorizado) {
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#b45309').text('BORRADOR — SIN VALIDEZ TRIBUTARIA');
    doc.fontSize(8).font('Helvetica').fillColor('#4b5563').text('Documento generado para revisión e impresión previa. No constituye comprobante electrónico autorizado por el SRI.');
  }
  row(doc,'Estado SRI',String(d.estado).toUpperCase());
  row(doc,'Número de autorización',esAutorizado ? (d.numero_autorizacion || '—') : 'Pendiente de autorización');
  row(doc,'Fecha de emisión',datos.fechaEmision || d.created_at);
  row(doc,'Fecha de autorización',esAutorizado ? fechaEc(d.fecha_autorizacion) : 'Pendiente');
  row(doc,'Clave de acceso',d.clave_acceso || 'Pendiente de emisión');

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
    // Liquidación de compra: representación estructurada para revisión/RIDE.
    // Se evita el formato de lista corrida porque el comprobante necesita distinguir
    // proveedor, detalle, impuestos, totales y formas de pago.
    section(doc,'INFORMACIÓN DEL PROVEEDOR');
    row(doc,'Tipo de identificación', datos.tipoIdentificacionProveedor || '05');
    row(doc,'Identificación', datos.identificacionProveedor);
    row(doc,'Razón social / nombres', datos.razonSocialProveedor);
    row(doc,'Dirección', datos.direccionProveedor);

    section(doc,'DETALLE DE BIENES O SERVICIOS');
    const detallesLC = Array.isArray(datos.detalles) ? datos.detalles : [];
    const tableX = 42;
    const widths = [58, 190, 48, 62, 62, 69];
    const headers = ['Código','Descripción','Cant.','P. Unit.','Desc.','Subtotal'];
    const drawHeader = (y:number) => {
      doc.save();
      doc.rect(tableX,y,489,22).fill('#e5e7eb');
      doc.fillColor('#111827').font('Helvetica-Bold').fontSize(7.5);
      let x=tableX;
      headers.forEach((h,i)=>{ doc.text(h,x+4,y+7,{width:widths[i]-8,align:i>=2?'right':'left'}); x+=widths[i]; });
      doc.restore();
    };
    let y=doc.y+4;
    drawHeader(y); y+=22;
    doc.font('Helvetica').fontSize(7.5).fillColor('#111827');
    if (!detallesLC.length) {
      doc.text('Sin detalles registrados.',tableX+4,y+7); y+=22;
    } else {
      for (const x of detallesLC) {
        const desc=text(x.descripcion);
        const rowH=Math.max(22, doc.heightOfString(desc,{width:widths[1]-8})+10);
        if (y+rowH>735) { doc.addPage(); y=42; drawHeader(y); y+=22; doc.font('Helvetica').fontSize(7.5).fillColor('#111827'); }
        let xx=tableX;
        const vals=[text(x.codigoPrincipal||x.codigo||'—'),desc,money(x.cantidad),money(x.precioUnitario),money(x.descuento),money(x.precioTotalSinImpuesto)];
        vals.forEach((v,i)=>{ doc.text(v,xx+4,y+7,{width:widths[i]-8,align:i>=2?'right':'left',height:rowH-8}); xx+=widths[i]; });
        doc.moveTo(tableX,y+rowH).lineTo(tableX+489,y+rowH).strokeColor('#d1d5db').stroke();
        y+=rowH;
      }
    }
    doc.y=y+4;

    section(doc,'IMPUESTOS Y TOTALES');
    const impuestosLC = Array.isArray(datos.totalConImpuestos) ? datos.totalConImpuestos : [];
    if (impuestosLC.length) {
      for (const imp of impuestosLC) {
        const codigoPct = text(imp.codigoPorcentaje ?? '0');
        const tarifa = imp.tarifa !== undefined ? `${money(imp.tarifa)}%` : (codigoPct==='4'?'15%':codigoPct==='8'?'8%':codigoPct==='5'?'5%':'0%');
        row(doc,`IVA / código ${codigoPct}`,`Base $${money(imp.baseImponible)} — Tarifa ${tarifa} — IVA $${money(imp.valor)}`);
      }
    }
    row(doc,'Total sin impuestos',`$${money(datos.totalSinImpuestos)}`);
    row(doc,'Descuento total',`$${money(datos.totalDescuento)}`);
    doc.font('Helvetica-Bold').fontSize(10).text(`IMPORTE TOTAL: $${money(datos.importeTotal)}`);
    doc.font('Helvetica').fontSize(8.5);

    section(doc,'FORMAS DE PAGO');
    const pagosLC = Array.isArray(datos.pagos) ? datos.pagos : [];
    if (pagosLC.length) for (const x of pagosLC) row(doc,'Forma de pago',`${text(x.formaPago)} — $${money(x.total)}`);
    else row(doc,'Forma de pago','No registrada');
  } else if (d.tipo === 'guia_remision') {
    section(doc,'TRANSPORTE'); row(doc,'Fecha inicio',datos.fechaIniTransporte); row(doc,'Fecha fin',datos.fechaFinTransporte); row(doc,'Dirección partida',datos.dirPartida); row(doc,'Placa',datos.placa);
    section(doc,'DESTINATARIOS'); for (const x of (Array.isArray(datos.destinatarios)?datos.destinatarios:[])) { row(doc,'Destinatario',`${text(x.razonSocialDestinatario)} — ${text(x.identificacionDestinatario)}`); row(doc,'Dirección',x.dirDestinatario); row(doc,'Motivo traslado',x.motivoTraslado); for (const z of (Array.isArray(x.detalles)?x.detalles:[])) row(doc,'  Producto',`${text(z.descripcion)} — Cant. ${money(z.cantidad)}`); }
  } else if (d.tipo === 'retencion') {
    section(doc,'DOCUMENTOS SUSTENTO'); for (const x of (Array.isArray(datos.docsSustento)?datos.docsSustento:[])) { row(doc,'Documento',x.numDocSustento); row(doc,'Fecha',x.fechaEmisionDocSustento); row(doc,'Autorización',x.numAutDocSustento); for (const r of (Array.isArray(x.retenciones)?x.retenciones:[])) row(doc,'Retención',`${text(r.codigoRetencion)} — Base $${money(r.baseImponible)} — Retenido $${money(r.valorRetenido)}`); }
  }

  doc.moveDown(.8); line(doc,doc.y); doc.moveDown(.4); doc.fontSize(7.5).fillColor('#4b5563').text(esAutorizado ? 'Representación impresa del comprobante electrónico. El XML firmado constituye el archivo electrónico autorizado por el SRI. Conserve ambos archivos conforme a las obligaciones tributarias aplicables.' : 'BORRADOR PARA REVISIÓN E IMPRESIÓN PREVIA — SIN VALIDEZ TRIBUTARIA. Este documento no acredita autorización del SRI ni sustituye al comprobante electrónico autorizado.');
  doc.end();
  const buffer = await done;
  return { buffer, filename:`${escFilename(tipoNombre)}-${escFilename(sec)}${esAutorizado ? '' : '-BORRADOR'}.pdf`, tipo:d.tipo, secuencial:sec, email:String(datos.correoElectronico ?? '').trim().toLowerCase(), estado:d.estado };
}
