import PDFDocument from 'pdfkit';
import bwipjs from 'bwip-js';
import { supabase } from '../db/supabase.js';

const NOMBRES: Record<string,string> = {
  nota_credito: 'NOTA DE CRÉDITO',
  nota_debito: 'NOTA DE DÉBITO',
  liquidacion_compra: 'LIQUIDACIÓN DE COMPRA',
  guia_remision: 'GUÍA DE REMISIÓN',
  retencion: 'COMPROBANTE DE RETENCIÓN',
};

const FORMA_PAGO: Record<string,string> = {
  '01':'Efectivo','15':'Compensación de deudas','16':'Tarjeta de débito','17':'Dinero electrónico',
  '18':'Tarjeta prepago','19':'Tarjeta de crédito','20':'Otros con utilización del sistema financiero','21':'Endoso de títulos',
};

const C = {
  navy:'#123B63', blue:'#1E5A8A', blueSoft:'#EAF3FA', ink:'#1F2937', muted:'#5F6F82',
  line:'#B8C7D6', soft:'#F7FAFC', white:'#FFFFFF', amber:'#A16207', green:'#166534'
};
const PAGE = { left:38, right:38, top:28, bottom:42 };
const usable = (doc:any) => doc.page.width - PAGE.left - PAGE.right;

function money(v: unknown){ const n=Number(v ?? 0); return Number.isFinite(n) ? n.toFixed(2) : '0.00'; }
function text(v: unknown){ return v===undefined || v===null || String(v).trim()==='' ? '—' : String(v); }
function filename(v:string){ return v.replace(/[^a-zA-Z0-9._-]/g,'_'); }
function dateEC(v:unknown){ if(!v) return '—'; const d=new Date(String(v)); if(Number.isNaN(d.getTime())) return text(v); return new Intl.DateTimeFormat('es-EC',{timeZone:'America/Guayaquil',dateStyle:'short',timeStyle:'medium'}).format(d); }
function shortDate(v:unknown){ if(!v) return '—'; const d=new Date(String(v)); if(Number.isNaN(d.getTime())) return text(v); return new Intl.DateTimeFormat('es-EC',{timeZone:'America/Guayaquil',dateStyle:'short'}).format(d); }
function wrap(doc:any,value:unknown,x:number,y:number,w:number,h:number,size=7.5){ doc.font('Helvetica').fontSize(size).fillColor(C.ink).text(text(value),x,y,{width:w,height:h,ellipsis:true}); }
function labelValue(doc:any,label:string,value:unknown,x:number,y:number,w:number,h=24){ doc.font('Helvetica-Bold').fontSize(6.5).fillColor(C.muted).text(label.toUpperCase(),x,y,{width:w,height:9,ellipsis:true}); wrap(doc,value,x,y+10,w,h,7.5); }
function section(doc:any,title:string){
  const x=PAGE.left,w=usable(doc); if(doc.y+28>doc.page.height-PAGE.bottom){ doc.addPage(); doc.y=PAGE.top; }
  doc.roundedRect(x,doc.y,w,18,3).fill(C.blueSoft);
  doc.font('Helvetica-Bold').fontSize(7.6).fillColor(C.navy).text(title.toUpperCase(),x+8,doc.y+5,{width:w-16});
  doc.y+=23; doc.fillColor(C.ink);
}
function tableHeader(doc:any,cols:Array<{title:string,width:number,align?:'left'|'center'|'right'}>){
  if(doc.y+19>doc.page.height-PAGE.bottom){doc.addPage();doc.y=PAGE.top;}
  const y=doc.y,x0=PAGE.left; doc.rect(x0,y,usable(doc),19).fill(C.navy); let x=x0;
  doc.font('Helvetica-Bold').fontSize(6.8).fillColor(C.white);
  for(const c of cols){ doc.text(c.title,x+4,y+6,{width:c.width-8,align:c.align??'left'}); x+=c.width; }
  doc.y=y+19; return y+19;
}
function tableRow(doc:any,values:string[],cols:Array<{title:string,width:number,align?:'left'|'center'|'right'}>,height=20){
  if(doc.y+height>doc.page.height-PAGE.bottom){doc.addPage();doc.y=PAGE.top;tableHeader(doc,cols);}
  const y=doc.y,x0=PAGE.left; doc.rect(x0,y,usable(doc),height).fill((Math.floor((y-PAGE.top)/height)%2)===0?C.soft:C.white); let x=x0;
  doc.font('Helvetica').fontSize(7).fillColor(C.ink);
  values.forEach((v,i)=>{const c=cols[i];doc.text(v,x+4,y+5,{width:c.width-8,height:height-8,align:c.align??'left',ellipsis:true});x+=c.width;});
  doc.y=y+height; return doc.y;
}
function totalsBox(doc:any,rows:Array<[string,unknown]>,highlight=true){
  const w=205,x=doc.page.width-PAGE.right-w;
  const h=Math.max(25,rows.length*18+7);
  if(doc.y+h>doc.page.height-PAGE.bottom){doc.addPage();doc.y=PAGE.top;}
  let y=doc.y;
  doc.roundedRect(x,y,w,h,4).lineWidth(.6).strokeColor(C.line).stroke();
  rows.forEach((r,i)=>{ const last=i===rows.length-1; if(last){doc.roundedRect(x,y,w,24,4).fill(highlight?C.navy:C.blueSoft);} doc.font(last?'Helvetica-Bold':'Helvetica').fontSize(last?8.5:7.4).fillColor(last&&highlight?C.white:C.muted).text(r[0],x+8,y+(last?8:5),{width:w-85}); doc.fillColor(last&&highlight?C.white:C.ink).text(`$${money(r[1])}`,x+w-72,y+(last?8:5),{width:64,align:'right'}); y+=last?24:18; });
  doc.y=y+8;
}
async function barcode(clave:string){ return bwipjs.toBuffer({bcid:'code128',text:clave,scale:2,height:11,includetext:false,backgroundcolor:'FFFFFF'}); }

export async function obtenerDocumentoSriPdf(id:string):Promise<{buffer:Buffer;filename:string;tipo:string;secuencial:string;email:string;estado:string}> {
  const {data:d,error}=await supabase.from('documentos_sri_borrador').select('id,emisor_id,tipo,estado,secuencial,clave_acceso,numero_autorizacion,fecha_autorizacion,created_at,datos,xml_firmado,emisores(razon_social,nombre_comercial,ruc,direccion_matriz,ambiente,obligado_contabilidad)').eq('id',id).single();
  if(error||!d) throw new Error('Documento electrónico no encontrado.');
  const datos=(d.datos??{}) as Record<string,any>; const emisor=d.emisores as any; const autorizado=String(d.estado).toLowerCase()==='autorizado';
  const {data:conf}=await supabase.from('configuracion_sistema').select('logo_ride_base64,logo_ride_mime,ruc_proveedor_facturacion,incluir_ruc_proveedor').eq('emisor_id',d.emisor_id).maybeSingle();
  const logoBase64=String(conf?.logo_ride_base64??'').trim(); const logoMime=String(conf?.logo_ride_mime??'').toLowerCase();
  const rucProveedor=(process.env.RUC_PROVEEDOR_FACTURACION?.trim()||String(conf?.ruc_proveedor_facturacion??'').trim());
  const tipoNombre=NOMBRES[d.tipo]??String(d.tipo).toUpperCase(); const sec=String(d.secuencial??'BORRADOR');
  const doc=new PDFDocument({size:'A4',margin:0,bufferPages:true}); const chunks:Buffer[]=[]; doc.on('data',(c:Buffer)=>chunks.push(c)); const done=new Promise<Buffer>((resolve,reject)=>{doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);});
  await renderHeader(doc,{emisor,tipoNombre,sec,autorizado,clave:d.clave_acceso,autorizacion:d.numero_autorizacion,fechaAut:d.fecha_autorizacion,fechaEmision:datos.fechaEmision??d.created_at,ambiente:datos.ambiente,logoBase64,logoMime});
  doc.y=214;
  renderReceptor(doc,datos,d.created_at,d.tipo);
  if(d.tipo==='nota_credito') renderNotaCredito(doc,datos);
  else if(d.tipo==='nota_debito') renderNotaDebito(doc,datos);
  else if(d.tipo==='liquidacion_compra') renderLiquidacion(doc,datos);
  else if(d.tipo==='guia_remision') renderGuia(doc,datos);
  else if(d.tipo==='retencion') renderRetencion(doc,datos);
  if(rucProveedor && conf?.incluir_ruc_proveedor!==false){
    section(doc,'Información adicional');
    const y=doc.y; doc.roundedRect(PAGE.left,y,usable(doc),34,3).lineWidth(.5).strokeColor(C.line).stroke();
    labelValue(doc,'RUC del proveedor del sistema de facturación',rucProveedor,PAGE.left+8,y+6,usable(doc)-16,18); doc.y=y+42;
  }
  for(let i=0;i<doc.bufferedPageRange().count;i++){doc.switchToPage(i);renderFooter(doc,autorizado);}
  doc.end(); const buffer=await done;
  return {buffer,filename:`${filename(tipoNombre)}-${filename(sec)}${autorizado?'':'-BORRADOR'}.pdf`,tipo:d.tipo,secuencial:sec,email:String(datos.correoElectronico??'').trim().toLowerCase(),estado:d.estado};
}

async function renderHeader(doc:any,o:any){
  const left=PAGE.left,right=doc.page.width-PAGE.right; const leftW=270,boxX=318,boxW=right-boxX;
  doc.rect(0,0,doc.page.width,9).fill(C.navy);
  // Zona fija de logo para todos los comprobantes. Nunca se repite el logo ni invade la caja SRI.
  doc.roundedRect(left+10,22,250,58,4).fill(C.blueSoft).strokeColor(C.line).stroke();
  const hasLogo=!!(o.logoBase64&&['image/png','image/jpeg'].includes(o.logoMime));
  if(hasLogo){try{doc.image(Buffer.from(o.logoBase64,'base64'),left+18,28,{fit:[234,46],align:'center',valign:'center'});}catch{}}
  else{doc.font('Helvetica-Bold').fontSize(11).fillColor(C.blue).text('CONTSERTRIB',left+20,43,{width:230,align:'center'});doc.font('Helvetica').fontSize(7).fillColor(C.muted).text('FACTURACIÓN ELECTRÓNICA',left+20,59,{width:230,align:'center'});}
  doc.roundedRect(left,86,leftW,116,4).lineWidth(.8).strokeColor(C.line).stroke();
  doc.font('Helvetica-Bold').fontSize(10).fillColor(C.navy).text(text(o.emisor?.razon_social||o.emisor?.nombre_comercial||'CONTRIBUYENTE'),left+10,96,{width:leftW-20,height:22,ellipsis:true});
  if(o.emisor?.nombre_comercial) doc.font('Helvetica').fontSize(7.2).fillColor(C.ink).text(o.emisor.nombre_comercial,left+10,116,{width:leftW-20,height:13,ellipsis:true});
  doc.font('Helvetica-Bold').fontSize(7.1).fillColor(C.ink).text(`R.U.C.: ${text(o.emisor?.ruc)}`,left+10,132,{width:leftW-20});
  doc.font('Helvetica').fontSize(6.8).fillColor(C.muted).text(text(o.emisor?.direccion_matriz),left+10,146,{width:leftW-20,height:24,ellipsis:true});
  doc.font('Helvetica-Bold').fontSize(6.5).fillColor(C.navy).text(o.autorizado?'DOCUMENTO ELECTRÓNICO':'BORRADOR PARA REVISIÓN',left+10,184,{width:leftW-20,align:'center'});

  doc.roundedRect(boxX,22,boxW,174,5).lineWidth(1).strokeColor(C.blue).stroke();
  doc.font('Helvetica-Bold').fontSize(9.2).fillColor(C.navy).text(o.tipoNombre,boxX+10,32,{width:boxW-20,align:'center'});
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(C.ink).text(`No. ${text(o.sec)}`,boxX+10,51,{width:boxW-20,align:'center'});
  doc.font('Helvetica-Bold').fontSize(6.4).fillColor(C.muted).text('NÚMERO DE AUTORIZACIÓN',boxX+10,70,{width:boxW-20,align:'center'});
  const auth=o.autorizado?text(o.autorizacion||o.clave):'PENDIENTE DE AUTORIZACIÓN'; const a=String(auth); const a1=a.length>28?a.slice(0,28):a,a2=a.length>28?a.slice(28,56):'';
  doc.font('Helvetica').fontSize(6.0).fillColor(C.ink).text(a1,boxX+10,81,{width:boxW-20,align:'center',lineBreak:false}); if(a2)doc.text(a2,boxX+10,90,{width:boxW-20,align:'center',lineBreak:false});
  const fy=a2?104:96; doc.font('Helvetica-Bold').fontSize(6.2).fillColor(C.muted).text('FECHA Y HORA DE AUTORIZACIÓN',boxX+10,fy,{width:boxW-20,align:'center'}); doc.font('Helvetica').fontSize(6.4).fillColor(C.ink).text(o.autorizado?dateEC(o.fechaAut):'—',boxX+10,fy+10,{width:boxW-20,align:'center'});
  doc.font('Helvetica-Bold').fontSize(6.3).fillColor(C.muted).text(`AMBIENTE: ${String(o.ambiente||'PRUEBAS').toUpperCase()}   ·   EMISIÓN: NORMAL`,boxX+8,fy+28,{width:boxW-16,align:'center'});
  if(o.clave){try{const b=await barcode(String(o.clave));doc.image(b,boxX+14,fy+40,{width:boxW-28,height:24});}catch{}}
  doc.font('Helvetica-Bold').fontSize(6).fillColor(C.muted).text('CLAVE DE ACCESO',boxX+10,fy+67,{width:boxW-20,align:'center'}); doc.font('Helvetica').fontSize(5.3).fillColor(C.ink).text(text(o.clave),boxX+8,fy+77,{width:boxW-16,height:9,align:'center',characterSpacing:.06,ellipsis:true});
  if(!o.autorizado){doc.roundedRect(left+8,188,leftW-16,10,2).fill('#FEF3C7');doc.fillColor(C.amber).font('Helvetica-Bold').fontSize(6.1).text('BORRADOR · SIN VALIDEZ TRIBUTARIA',left+10,190,{width:leftW-20,align:'center'});}
  doc.moveTo(left,207).lineTo(right,207).strokeColor(C.line).lineWidth(.8).stroke();
}

function renderReceptor(doc:any,d:any,created:any,tipo:string){
  section(doc,tipo==='retencion'?'Sujeto retenido / receptor':tipo==='guia_remision'?'Destinatario / información del traslado':'Datos del receptor');
  const y=doc.y,w=usable(doc); doc.roundedRect(PAGE.left,y,w,58,3).lineWidth(.6).strokeColor(C.line).stroke();
  const ident=d.identificacionComprador??d.identificacionProveedor??d.identificacionSujetoRetenido; const nombre=d.razonSocialComprador??d.razonSocialProveedor??d.razonSocialSujetoRetenido;
  labelValue(doc,'Razón social / nombres',nombre,PAGE.left+8,y+6,168); labelValue(doc,'Identificación',ident,PAGE.left+185,y+6,168); labelValue(doc,'Fecha de emisión',d.fechaEmision??created,PAGE.left+362,y+6,w-370);
  labelValue(doc,'Dirección / domicilio',d.direccionComprador??d.direccionProveedor??d.direccionSujetoRetenido,PAGE.left+8,y+31,345); labelValue(doc,'Correo electrónico',d.correoElectronico,PAGE.left+362,y+31,w-370); doc.y=y+65;
}

function renderNotaCredito(doc:any,d:any){
  section(doc,'Documento que se modifica'); const y=doc.y; labelValue(doc,'No. documento sustento',d.numDocModificado,PAGE.left+8,y,155); labelValue(doc,'Fecha documento sustento',d.fechaEmisionDocSustento,PAGE.left+170,y,155); labelValue(doc,'Motivo / razón',d.motivo,PAGE.left+332,y,200); doc.y=y+38;
  section(doc,'Detalle de la modificación'); const cols=[{title:'Código',width:52},{title:'Descripción',width:210},{title:'Cant.',width:48,align:'right' as const},{title:'P. UNIT.',width:65,align:'right' as const},{title:'DESCUENTO',width:65,align:'right' as const},{title:'TOTAL',width:79,align:'right' as const}]; tableHeader(doc,cols); const det=Array.isArray(d.detalles)?d.detalles:[]; for(const x of det){const h=Math.max(20,Math.min(34,Math.ceil(String(x.descripcion??'').length/42)*10+12));tableRow(doc,[text(x.codigoPrincipal??x.codigo),text(x.descripcion),money(x.cantidad),`$${money(x.precioUnitario)}`,`$${money(x.descuento)}`,`$${money(x.precioTotalSinImpuesto)}`],cols,h);} if(!det.length)tableRow(doc,['—','Sin detalle registrado','—','—','—','—'],cols,20); doc.y+=7;
  totalsBox(doc,[['SUBTOTAL SIN IMPUESTOS',d.totalSinImpuestos],['VALOR DE MODIFICACIÓN',d.valorModificacion??d.importeTotal]],true);
}
function renderNotaDebito(doc:any,d:any){
  section(doc,'Motivos y valores'); const cols=[{title:'Motivo / razón',width:385},{title:'VALOR',width:134,align:'right' as const}]; tableHeader(doc,cols); const motivos=Array.isArray(d.motivos)?d.motivos:[]; for(const x of motivos)tableRow(doc,[text(x.razon),`$${money(x.valor)}`],cols,24); if(!motivos.length)tableRow(doc,['Sin motivos registrados','—'],cols,24); doc.y+=7;
  totalsBox(doc,[['SUBTOTAL SIN IMPUESTOS',d.totalSinImpuestos],['VALOR TOTAL',d.valorTotal??d.importeTotal]],true);
}
function renderLiquidacion(doc:any,d:any){
  section(doc,'Proveedor de la liquidación'); const y=doc.y; labelValue(doc,'Tipo identificación',d.tipoIdentificacionProveedor,PAGE.left+8,y,105); labelValue(doc,'Identificación',d.identificacionProveedor,PAGE.left+120,y,145); labelValue(doc,'Razón social / nombres',d.razonSocialProveedor,PAGE.left+275,y,285); labelValue(doc,'Dirección',d.direccionProveedor,PAGE.left+8,y+29,552); doc.y=y+59;
  section(doc,'Detalle de bienes o servicios'); const cols=[{title:'CÓDIGO',width:55},{title:'DESCRIPCIÓN',width:200},{title:'CANT.',width:48,align:'right' as const},{title:'P. UNIT.',width:62,align:'right' as const},{title:'DESC.',width:60,align:'right' as const},{title:'SUBTOTAL',width:94,align:'right' as const}]; tableHeader(doc,cols); const det=Array.isArray(d.detalles)?d.detalles:[]; for(const x of det)tableRow(doc,[text(x.codigoPrincipal??x.codigo),text(x.descripcion),money(x.cantidad),`$${money(x.precioUnitario)}`,`$${money(x.descuento)}`,`$${money(x.precioTotalSinImpuesto)}`],cols,22); if(!det.length)tableRow(doc,['—','Sin detalle registrado','—','—','—','—'],cols,22); doc.y+=7;
  section(doc,'Impuestos'); const imps=Array.isArray(d.totalConImpuestos)?d.totalConImpuestos:[]; const ci=[{title:'IMPUESTO / TARIFA',width:240},{title:'BASE IMPONIBLE',width:140,align:'right' as const},{title:'VALOR',width:139,align:'right' as const}]; tableHeader(doc,ci); for(const imp of imps){const code=String(imp.codigoPorcentaje??'0');const tarifa=imp.tarifa!==undefined?`${money(imp.tarifa)}%`:code==='4'?'15%':code==='8'?'8%':code==='5'?'5%':code==='7'?'EXENTO':code==='6'?'NO OBJETO':'0%';tableRow(doc,[`IVA · ${tarifa}`,`$${money(imp.baseImponible)}`,`$${money(imp.valor)}`],ci,22);} if(!imps.length)tableRow(doc,['Sin impuestos registrados','—','—'],ci,22); doc.y+=7;
  totalsBox(doc,[['SUBTOTAL SIN IMPUESTOS',d.totalSinImpuestos],['DESCUENTO TOTAL',d.totalDescuento],['IMPORTE TOTAL',d.importeTotal]],true);
  section(doc,'Forma de pago'); const pagos=Array.isArray(d.pagos)?d.pagos:[]; const cp=[{title:'FORMA DE PAGO',width:380},{title:'VALOR',width:139,align:'right' as const}]; tableHeader(doc,cp); for(const p of pagos)tableRow(doc,[text(p.formaPago),`$${money(p.total)}`],cp,21); if(!pagos.length)tableRow(doc,['No registrada','—'],cp,21);
}
function renderGuia(doc:any,d:any){
  section(doc,'Información del traslado'); let y=doc.y; labelValue(doc,'Fecha inicio traslado',d.fechaIniTransporte,PAGE.left+8,y,125); labelValue(doc,'Hora salida',d.horaSalida,PAGE.left+140,y,95); labelValue(doc,'Fecha fin traslado',d.fechaFinTransporte,PAGE.left+242,y,125); labelValue(doc,'Hora llegada',d.horaLlegada,PAGE.left+374,y,108); y+=29; labelValue(doc,'Punto de partida',d.dirPartida,PAGE.left+8,y,270); labelValue(doc,'Punto de llegada / destino',d.dirLlegada,PAGE.left+288,y,194); y+=29; labelValue(doc,'Ruta / recorrido',d.ruta,PAGE.left+8,y,270); labelValue(doc,'Declaración aduanera',d.numeroDeclaracionAduanera,PAGE.left+288,y,194); y+=29; labelValue(doc,'Remitente',d.identificacionRemitente,PAGE.left+8,y,270); labelValue(doc,'Transportista',`${text(d.razonSocialTransportista)} · ${text(d.rucTransportista)}`,PAGE.left+288,y,194); y+=29; labelValue(doc,'Placa',d.placa,PAGE.left+8,y,125); labelValue(doc,'Identificación transportista',d.identificacionTransportista??d.tipoIdentificacionTransportista,PAGE.left+140,y,180); doc.y=y+34;
  section(doc,'Destinatarios y bienes transportados'); const dest=Array.isArray(d.destinatarios)?d.destinatarios:[]; if(!dest.length){tableRow(doc,['—','Sin destinatarios registrados','—'],[{title:'DESTINATARIO',width:190},{title:'DIRECCIÓN',width:230},{title:'BIENES',width:99}],22);return;}
  for(const x of dest){ if(doc.y+55>doc.page.height-PAGE.bottom){doc.addPage();doc.y=PAGE.top;section(doc,'Destinatario');} const by=doc.y; doc.roundedRect(PAGE.left,by,usable(doc),50,3).fill(C.soft).strokeColor(C.line).stroke(); labelValue(doc,'Destinatario',`${text(x.razonSocialDestinatario)} · ${text(x.identificacionDestinatario)}`,PAGE.left+8,by+6,270); labelValue(doc,'Dirección destino',x.dirDestinatario,PAGE.left+288,by+6,194); labelValue(doc,'Motivo',x.motivoTraslado,PAGE.left+8,by+30,270); labelValue(doc,'Ruta específica',x.ruta,PAGE.left+288,by+30,194); doc.y=by+58;
    if(x.codDocSustento||x.numDocSustento||x.numAutDocSustento||x.fechaEmisionDocSustento){section(doc,'Documento de sustento'); const sy=doc.y; labelValue(doc,'Código',x.codDocSustento,PAGE.left+8,sy,70); labelValue(doc,'No. comprobante',x.numDocSustento,PAGE.left+88,sy,150); labelValue(doc,'No. autorización / clave',x.numAutDocSustento,PAGE.left+248,sy,234); doc.y=sy+30; labelValue(doc,'Fecha de sustento',x.fechaEmisionDocSustento,PAGE.left+8,doc.y,180); doc.y+=30;}
    section(doc,'Bienes transportados'); const cb=[{title:'CÓDIGO',width:80},{title:'DESCRIPCIÓN',width:340},{title:'CANTIDAD',width:99,align:'right' as const}]; tableHeader(doc,cb); const items=Array.isArray(x.detalles)?x.detalles:[]; for(const z of items)tableRow(doc,[text(z.codigo??z.codigoInterno),text(z.descripcion),money(z.cantidad)],cb,20); if(!items.length)tableRow(doc,['—','Sin bienes registrados','—'],cb,20); doc.y+=6;
  }
}
function renderRetencion(doc:any,d:any){
  section(doc,'Sujeto retenido y documentos de sustento'); const sust=Array.isArray(d.docsSustento)?d.docsSustento:[]; if(!sust.length){tableRow(doc,['—','Sin documentos de sustento registrados','—'],[{title:'DOCUMENTO',width:190},{title:'FECHA / AUTORIZACIÓN',width:280},{title:'RETENCIONES',width:90}],22);return;}
  for(const x of sust){ if(doc.y+75>doc.page.height-PAGE.bottom){doc.addPage();doc.y=PAGE.top;} const y=doc.y; doc.roundedRect(PAGE.left,y,usable(doc),45,3).fill(C.soft).strokeColor(C.line).stroke(); labelValue(doc,'Documento sustento',x.numDocSustento,PAGE.left+8,y+6,160); labelValue(doc,'Fecha emisión',x.fechaEmisionDocSustento,PAGE.left+178,y+6,120); labelValue(doc,'Autorización',x.numAutDocSustento,PAGE.left+308,y+6,174); doc.y=y+52;
    section(doc,'Detalle de retenciones'); const cols=[{title:'CÓDIGO RETENCIÓN',width:160},{title:'BASE IMPONIBLE',width:180,align:'right' as const},{title:'VALOR RETENIDO',width:179,align:'right' as const}]; tableHeader(doc,cols); const rs=Array.isArray(x.retenciones)?x.retenciones:[]; for(const r of rs)tableRow(doc,[text(r.codigoRetencion),`$${money(r.baseImponible)}`,`$${money(r.valorRetenido)}`],cols,22); if(!rs.length)tableRow(doc,['—','—','—'],cols,22); doc.y+=7;
  }
  if(d.totalRetenido!==undefined || d.importeTotal!==undefined) totalsBox(doc,[['TOTAL RETENIDO',d.totalRetenido??d.importeTotal]],true);
}
function renderFooter(doc:any,autorizado:boolean){ const y=doc.page.height-28; doc.moveTo(PAGE.left,y-7).lineTo(doc.page.width-PAGE.right,y-7).lineWidth(.6).strokeColor(C.line).stroke(); doc.font('Helvetica').fontSize(6.4).fillColor(C.muted).text(autorizado?'REPRESENTACIÓN IMPRESA DEL COMPROBANTE ELECTRÓNICO · El XML firmado y autorizado por el SRI es el documento electrónico.':'BORRADOR PARA REVISIÓN — SIN VALIDEZ TRIBUTARIA.',PAGE.left,y,{width:usable(doc)-52}); doc.text(`Página ${doc.page.number}`,doc.page.width-PAGE.right-45,y,{width:45,align:'right'}); }
