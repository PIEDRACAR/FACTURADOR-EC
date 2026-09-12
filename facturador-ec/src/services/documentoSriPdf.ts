import PDFDocument from 'pdfkit';
import { supabase } from '../db/supabase.js';

const NOMBRES: Record<string,string> = {
  nota_credito: 'NOTA DE CRÉDITO',
  nota_debito: 'NOTA DE DÉBITO',
  liquidacion_compra: 'LIQUIDACIÓN DE COMPRA DE BIENES Y PRESTACIÓN DE SERVICIOS',
  guia_remision: 'GUÍA DE REMISIÓN',
  retencion: 'COMPROBANTE DE RETENCIÓN',
};

const C = { navy:'#102A43', navy2:'#163A5F', ink:'#1F2937', muted:'#64748B', line:'#D9E2EC', soft:'#F5F7FA', white:'#FFFFFF', amber:'#A16207', green:'#166534' };
const PAGE = { left:38, right:38, top:30, bottom:40 };

function money(v: unknown) { const n=Number(v ?? 0); return Number.isFinite(n) ? n.toFixed(2) : '0.00'; }
function text(v: unknown) { return v === undefined || v === null || String(v).trim()==='' ? '—' : String(v); }
function escFilename(v: string) { return v.replace(/[^a-zA-Z0-9._-]/g, '_'); }
function fechaEc(v: unknown) { if (!v) return '—'; const d=new Date(String(v)); if(Number.isNaN(d.getTime())) return text(v); return new Intl.DateTimeFormat('es-EC',{timeZone:'America/Guayaquil',dateStyle:'short',timeStyle:'medium'}).format(d); }
function drawLine(doc:any,y:number){ doc.moveTo(PAGE.left,y).lineTo(doc.page.width-PAGE.right,y).strokeColor(C.line).lineWidth(.7).stroke(); }
function heading(doc:any,title:string, y?:number){ if(y!==undefined) doc.y=y; const x=PAGE.left,w=doc.page.width-PAGE.left-PAGE.right; doc.roundedRect(x,doc.y,w,18,3).fill(C.soft); doc.fillColor(C.navy).font('Helvetica-Bold').fontSize(7.8).text(title.toUpperCase(),x+8,doc.y+5,{width:w-18}); doc.y+=23; doc.fillColor(C.ink); }
function labelValue(doc:any,label:string,value:unknown,x:number,y:number,w:number){ doc.font('Helvetica-Bold').fontSize(6.8).fillColor(C.muted).text(label.toUpperCase(),x,y,{width:w}); doc.font('Helvetica').fontSize(8.0).fillColor(C.ink).text(text(value),x,y+10,{width:w,height:25}); }
function footer(doc:any, esAutorizado:boolean){ const y=doc.page.height-30; doc.moveTo(PAGE.left,y-7).lineTo(doc.page.width-PAGE.right,y-7).strokeColor(C.line).stroke(); doc.font('Helvetica').fontSize(6.7).fillColor(C.muted).text(esAutorizado?'Representación impresa del comprobante electrónico. El XML firmado es el archivo electrónico autorizado por el SRI.':'BORRADOR PARA REVISIÓN — SIN VALIDEZ TRIBUTARIA. No acredita autorización del SRI.',PAGE.left,y,{width:doc.page.width-PAGE.left-PAGE.right-35}); doc.text(`Página ${doc.page.number}`,doc.page.width-PAGE.right-35,y,{width:35,align:'right'}); }
function ensureSpace(doc:any,needed:number){ if(doc.y+needed>doc.page.height-PAGE.bottom){ doc.addPage(); doc.y=PAGE.top; return true;} return false; }
function tableHeader(doc:any, y:number, cols:Array<{title:string,width:number,align?:'left'|'right'|'center'}>){ let x=PAGE.left; doc.rect(PAGE.left,y,doc.page.width-PAGE.left-PAGE.right,19).fill(C.navy); doc.font('Helvetica-Bold').fontSize(7).fillColor(C.white); for(const c of cols){ doc.text(c.title,x+5,y+6,{width:c.width-10,align:c.align??'left'}); x+=c.width; } return y+19; }
function tableRow(doc:any,y:number,values:string[],cols:Array<{title:string,width:number,align?:'left'|'right'|'center'}>,h=18){ if(y+h>doc.page.height-PAGE.bottom){doc.addPage(); y=PAGE.top; y=tableHeader(doc,y,cols);} let x=PAGE.left; doc.rect(PAGE.left,y,doc.page.width-PAGE.left-PAGE.right,h).fill(y%2?C.white:C.soft); doc.font('Helvetica').fontSize(7.0).fillColor(C.ink); values.forEach((v,i)=>{const c=cols[i];doc.text(v,x+5,y+5,{width:c.width-10,height:h-8,align:c.align??'left',ellipsis:true});x+=c.width;}); return y+h; }
function statusPill(doc:any,estado:string,x:number,y:number){ const autorizado=estado.toLowerCase()==='autorizado'; doc.roundedRect(x,y,86,20,10).fill(autorizado?'#DCFCE7':'#FEF3C7'); doc.fillColor(autorizado?C.green:C.amber).font('Helvetica-Bold').fontSize(7.5).text(autorizado?'AUTORIZADO':'BORRADOR / PENDIENTE',x+7,y+6,{width:72,align:'center'}); }

export async function obtenerDocumentoSriPdf(id: string): Promise<{buffer: Buffer; filename: string; tipo: string; secuencial: string; email: string; estado: string}> {
  const { data:d,error }=await supabase.from('documentos_sri_borrador').select('id,emisor_id,tipo,estado,secuencial,clave_acceso,numero_autorizacion,fecha_autorizacion,created_at,datos,xml_firmado,emisores(razon_social,nombre_comercial,ruc,direccion_matriz)').eq('id',id).single();
  if(error||!d) throw new Error('Documento electrónico no encontrado.');
  const esAutorizado=String(d.estado).toLowerCase()==='autorizado'; const datos=(d.datos??{}) as Record<string,any>; const emisor=d.emisores as any;
  const {data:conf}=await supabase.from('configuracion_sistema').select('logo_ride_base64,logo_ride_mime').eq('emisor_id',d.emisor_id).maybeSingle();
  const logoBase64=String(conf?.logo_ride_base64??'').trim(); const logoMime=String(conf?.logo_ride_mime??'').toLowerCase(); const tipoNombre=NOMBRES[d.tipo]??d.tipo; const sec=String(d.secuencial??'BORRADOR');
  const doc=new PDFDocument({size:'A4',margin:0,bufferPages:true}); const chunks:Buffer[]=[]; doc.on('data',(c:Buffer)=>chunks.push(c)); const done=new Promise<Buffer>((resolve,reject)=>{doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);});
  renderHeader(doc,{emisor,tipoNombre,sec,estado:String(d.estado),esAutorizado,logoBase64,logoMime,clave:d.clave_acceso,autorizacion:d.numero_autorizacion,fechaAut:d.fecha_autorizacion,fechaEmision:datos.fechaEmision??d.created_at});
  doc.y=169;

  heading(doc,'Datos principales');
  const cols= [PAGE.left, PAGE.left+170, PAGE.left+340];
  labelValue(doc,'Razón social / nombres',datos.razonSocialComprador??datos.razonSocialProveedor??datos.razonSocialSujetoRetenido,cols[0],doc.y,160);
  labelValue(doc,'Identificación',datos.identificacionComprador??datos.identificacionProveedor??datos.identificacionSujetoRetenido,cols[1],doc.y,160);
  labelValue(doc,'Fecha de emisión',datos.fechaEmision??d.created_at,cols[2],doc.y,170); doc.y+=35;
  labelValue(doc,'Dirección',datos.direccionComprador??datos.direccionProveedor,cols[0],doc.y,160);
  labelValue(doc,'Correo electrónico',datos.correoElectronico,cols[1],doc.y,160);
  labelValue(doc,'Período fiscal',datos.periodoFiscal,cols[2],doc.y,170); doc.y+=33;

  if(d.tipo==='nota_credito') renderNotaCredito(doc,datos);
  else if(d.tipo==='nota_debito') renderNotaDebito(doc,datos);
  else if(d.tipo==='liquidacion_compra') renderLiquidacion(doc,datos);
  else if(d.tipo==='guia_remision') renderGuia(doc,datos);
  else if(d.tipo==='retencion') renderRetencion(doc,datos);

  if(d.clave_acceso){ ensureSpace(doc,66); heading(doc,'Clave de acceso'); doc.font('Helvetica').fontSize(8).fillColor(C.ink).text(String(d.clave_acceso),PAGE.left,doc.y,{width:doc.page.width-PAGE.left-PAGE.right,characterSpacing:.35}); doc.y+=17; }
  for(let i=0;i<doc.bufferedPageRange().count;i++){doc.switchToPage(i);footer(doc,esAutorizado);}
  doc.end(); const buffer=await done;
  return {buffer,filename:`${escFilename(tipoNombre)}-${escFilename(sec)}${esAutorizado?'':'-BORRADOR'}.pdf`,tipo:d.tipo,secuencial:sec,email:String(datos.correoElectronico??'').trim().toLowerCase(),estado:d.estado};
}

function renderHeader(doc:any,o:any){
  const w=doc.page.width-PAGE.left-PAGE.right; doc.rect(0,0,doc.page.width,13).fill(C.navy);
  const hasLogo=o.logoBase64&&['image/png','image/jpeg'].includes(o.logoMime); if(hasLogo){try{doc.image(Buffer.from(o.logoBase64,'base64'),PAGE.left,27,{fit:[72,50],valign:'center'});}catch{}}
  const x=hasLogo?122:PAGE.left; doc.font('Helvetica-Bold').fontSize(15).fillColor(C.navy).text(o.emisor?.nombre_comercial||o.emisor?.razon_social||'CONTSERTRIB FACTURACIÓN',x,28,{width:235});
  doc.font('Helvetica').fontSize(7.7).fillColor(C.muted).text(`RUC ${text(o.emisor?.ruc)} · ${text(o.emisor?.direccion_matriz)}`,x,49,{width:235});
  const bx=330,bw=doc.page.width-PAGE.right-bx; doc.roundedRect(bx,25,bw,118,6).lineWidth(1).strokeColor(C.navy2).stroke(); doc.fillColor(C.navy).font('Helvetica-Bold').fontSize(8).text(o.tipoNombre,bx+11,37,{width:bw-22}); doc.font('Helvetica-Bold').fontSize(12).text(`No. ${o.sec}`,bx+11,55,{width:bw-22}); statusPill(doc,o.estado,bx+11,78); labelValue(doc,'Autorización',o.esAutorizado?o.autorizacion:'Pendiente de autorización',bx+105,77,bw-116); labelValue(doc,'Emisión',o.fechaEmision,bx+11,108,bw-22); if(!o.esAutorizado){doc.fillColor(C.amber).font('Helvetica-Bold').fontSize(7).text('BORRADOR · SIN VALIDEZ TRIBUTARIA',PAGE.left,86,{width:270});}
  doc.moveTo(PAGE.left,156).lineTo(doc.page.width-PAGE.right,156).strokeColor(C.line).stroke();
}

function renderNotaCredito(doc:any,d:any){
  heading(doc,'Documento que se modifica'); const y=doc.y; labelValue(doc,'No. documento sustento',d.numDocModificado,PAGE.left,y,160); labelValue(doc,'Fecha documento sustento',d.fechaEmisionDocSustento,PAGE.left+170,y,160); labelValue(doc,'Motivo',d.motivo,PAGE.left+340,y,170); doc.y=y+43;
  const det=Array.isArray(d.detalles)?d.detalles:[]; heading(doc,'Detalle de la modificación'); const cols=[{title:'Descripción',width:250},{title:'Cant.',width:55,align:'right' as const},{title:'P. unit.',width:75,align:'right' as const},{title:'Descuento',width:70,align:'right' as const},{title:'Base',width:60,align:'right' as const}]; let y2=tableHeader(doc,doc.y,cols); for(const x of det){const h=Math.max(24,Math.ceil(String(x.descripcion??'').length/48)*11+13);y2=tableRow(doc,y2,[text(x.descripcion),money(x.cantidad),`$${money(x.precioUnitario)}`,`$${money(x.descuento)}`,`$${money(x.precioTotalSinImpuesto)}`],cols,h);} doc.y=y2+7; renderTotals(doc,[['Total sin impuestos',d.totalSinImpuestos],['Valor de modificación',d.valorModificacion]]);
}
function renderNotaDebito(doc:any,d:any){ heading(doc,'Motivos y valores'); const cols=[{title:'Motivo / razón',width:365},{title:'Valor',width:145,align:'right' as const}]; let y=tableHeader(doc,doc.y,cols); for(const x of (Array.isArray(d.motivos)?d.motivos:[])) y=tableRow(doc,y,[text(x.razon),`$${money(x.valor)}`],cols,30); doc.y=y+12; renderTotals(doc,[['Total sin impuestos',d.totalSinImpuestos],['Valor total',d.valorTotal]]); }
function renderLiquidacion(doc:any,d:any){
  heading(doc,'Proveedor de la liquidación'); const y=doc.y; labelValue(doc,'Tipo identificación',d.tipoIdentificacionProveedor??'05',PAGE.left,y,100); labelValue(doc,'Identificación',d.identificacionProveedor,PAGE.left+110,y,140); labelValue(doc,'Razón social / nombres',d.razonSocialProveedor,PAGE.left+260,y,160); labelValue(doc,'Dirección',d.direccionProveedor,PAGE.left+0,y+42,470); doc.y=y+82;
  heading(doc,'Detalle de bienes o servicios'); const cols=[{title:'Código',width:60},{title:'Descripción',width:205},{title:'Cant.',width:48,align:'right' as const},{title:'P. unit.',width:62,align:'right' as const},{title:'Desc.',width:57,align:'right' as const},{title:'Subtotal',width:75,align:'right' as const}]; let y2=tableHeader(doc,doc.y,cols); const det=Array.isArray(d.detalles)?d.detalles:[]; for(const x of det){const h=Math.max(25,Math.ceil(String(x.descripcion??'').length/42)*11+14); y2=tableRow(doc,y2,[text(x.codigoPrincipal??x.codigo),text(x.descripcion),money(x.cantidad),`$${money(x.precioUnitario)}`,`$${money(x.descuento)}`,`$${money(x.precioTotalSinImpuesto)}`],cols,h);} doc.y=y2+7;
  heading(doc,'Impuestos'); const imps=Array.isArray(d.totalConImpuestos)?d.totalConImpuestos:[]; const colsI=[{title:'Código / tarifa',width:150},{title:'Base imponible',width:150,align:'right' as const},{title:'Valor impuesto',width:150,align:'right' as const}]; let yi=tableHeader(doc,doc.y,colsI); for(const imp of imps){const code=text(imp.codigoPorcentaje??'0');const tarifa=imp.tarifa!==undefined?`${money(imp.tarifa)}%`:code==='4'?'15%':code==='8'?'8%':code==='5'?'5%':'0%'; yi=tableRow(doc,yi,[`IVA · ${tarifa}`,`$${money(imp.baseImponible)}`,`$${money(imp.valor)}`],colsI,25);} doc.y=yi+7; renderTotals(doc,[['Total sin impuestos',d.totalSinImpuestos],['Descuento total',d.totalDescuento],['Importe total',d.importeTotal]],true); heading(doc,'Formas de pago'); const pagos=Array.isArray(d.pagos)?d.pagos:[]; const colsP=[{title:'Forma de pago',width:360},{title:'Valor',width:145,align:'right' as const}]; let yp=tableHeader(doc,doc.y,colsP); for(const p of pagos) yp=tableRow(doc,yp,[text(p.formaPago),`$${money(p.total)}`],colsP,25); if(!pagos.length) yp=tableRow(doc,yp,['No registrada','—'],colsP,25); doc.y=yp+2;
}
function renderGuia(doc:any,d:any){
  heading(doc,'Información del traslado');
  let y=doc.y;
  labelValue(doc,'Fecha inicio traslado',d.fechaIniTransporte,PAGE.left,y,118);
  labelValue(doc,'Hora de salida',d.horaSalida||'No registrada',PAGE.left+128,y,105);
  labelValue(doc,'Fecha fin traslado',d.fechaFinTransporte,PAGE.left+243,y,118);
  labelValue(doc,'Hora de llegada',d.horaLlegada||'No registrada',PAGE.left+371,y,115);
  y+=31;
  labelValue(doc,'Punto de partida',d.dirPartida,PAGE.left,y,260);
  labelValue(doc,'Punto de llegada / destino',d.dirLlegada,PAGE.left+270,y,216);
  y+=31;
  labelValue(doc,'Ruta / recorrido',d.ruta,PAGE.left,y,260);
  labelValue(doc,'Número declaración aduanera',d.numeroDeclaracionAduanera,PAGE.left+270,y,216);
  y+=31;
  labelValue(doc,'Remitente',d.identificacionRemitente,PAGE.left,y,260);
  labelValue(doc,'Transportista',`${text(d.razonSocialTransportista)} · ${text(d.rucTransportista)}`,PAGE.left+270,y,216);
  y+=31;
  labelValue(doc,'Placa del vehículo',d.placa,PAGE.left,y,120);
  labelValue(doc,'Tipo identificación transportista',d.tipoIdentificacionTransportista,PAGE.left+130,y,170);
  doc.y=y+35;

  heading(doc,'Destinatarios, documentos de sustento y bienes transportados');
  const dest=Array.isArray(d.destinatarios)?d.destinatarios:[];
  for(const x of dest){
    ensureSpace(doc,105);
    const boxY=doc.y;
    doc.roundedRect(PAGE.left,boxY,doc.page.width-PAGE.left-PAGE.right,48,4).fill(C.soft);
    labelValue(doc,'Destinatario',`${text(x.razonSocialDestinatario)} · ${text(x.identificacionDestinatario)}`,PAGE.left+8,boxY+7,250);
    labelValue(doc,'Dirección destino',x.dirDestinatario,PAGE.left+268,boxY+7,210);
    labelValue(doc,'Motivo del traslado',x.motivoTraslado,PAGE.left+8,boxY+33,250);
    labelValue(doc,'Ruta específica',x.ruta,PAGE.left+268,boxY+33,210);
    doc.y=boxY+55;
    if(x.codDocSustento||x.numDocSustento||x.numAutDocSustento||x.fechaEmisionDocSustento){
      heading(doc,'Documento de sustento',doc.y);
      const sy=doc.y;
      labelValue(doc,'Código',x.codDocSustento,PAGE.left,sy,80);
      labelValue(doc,'No. comprobante',x.numDocSustento,PAGE.left+90,sy,150);
      labelValue(doc,'No. autorización / clave',x.numAutDocSustento,PAGE.left+250,sy,225);
      doc.y=sy+35;
      labelValue(doc,'Fecha del sustento',x.fechaEmisionDocSustento,PAGE.left,doc.y,180);
      doc.y+=35;
    }
    heading(doc,'Bienes transportados');
    const cols=[{title:'Código',width:82},{title:'Descripción',width:310},{title:'Cantidad',width:93,align:'right' as const}];
    let yy=tableHeader(doc,doc.y,cols);
    for(const z of (Array.isArray(x.detalles)?x.detalles:[])) yy=tableRow(doc,yy,[text(z.codigo??z.codigoInterno),text(z.descripcion),money(z.cantidad)],cols,18);
    if(!Array.isArray(x.detalles)||!x.detalles.length) yy=tableRow(doc,yy,['—','Sin bienes registrados','—'],cols,18);
    doc.y=yy+7;
  }
}

function renderRetencion(doc:any,d:any){ heading(doc,'Sujeto retenido / documentos sustento'); const sust=Array.isArray(d.docsSustento)?d.docsSustento:[]; for(const x of sust){ensureSpace(doc,95); const y=doc.y; labelValue(doc,'Documento sustento',x.numDocSustento,PAGE.left,y,150); labelValue(doc,'Fecha emisión',x.fechaEmisionDocSustento,PAGE.left+160,y,120); labelValue(doc,'Autorización',x.numAutDocSustento,PAGE.left+290,y,185); doc.y=y+35; const cols=[{title:'Código retención',width:145},{title:'Base imponible',width:145,align:'right' as const},{title:'Valor retenido',width:145,align:'right' as const}]; let yy=tableHeader(doc,doc.y,cols); for(const r of (Array.isArray(x.retenciones)?x.retenciones:[])) yy=tableRow(doc,yy,[text(r.codigoRetencion),`$${money(r.baseImponible)}`,`$${money(r.valorRetenido)}`],cols,25); doc.y=yy+12; } }
function renderTotals(doc:any,rows:Array<[string,unknown]>,highlight=false){ ensureSpace(doc,rows.length*22+15); const x=350,w=196; let y=doc.y; for(const [l,v] of rows.slice(0,-1)){doc.font('Helvetica').fontSize(8).fillColor(C.muted).text(l,x,y,{width:95});doc.font('Helvetica').fillColor(C.ink).text(`$${money(v)}`,x+100,y,{width:w-100,align:'right'});y+=20;} const last=rows[rows.length-1]; doc.roundedRect(x,y,w,27,4).fill(highlight?C.navy:C.soft); doc.fillColor(highlight?C.white:C.navy).font('Helvetica-Bold').fontSize(9).text(last[0],x+9,y+8,{width:95}); doc.text(`$${money(last[1])}`,x+104,y+8,{width:w-113,align:'right'}); doc.y=y+39; }
