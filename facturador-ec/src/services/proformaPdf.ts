import PDFDocument from 'pdfkit';
import { supabase } from '../db/supabase.js';
import { fechaIsoEcuador } from '../utils/fechaEcuador.js';

const C={navy:'#102A43',blue:'#163A5F',ink:'#1F2937',muted:'#64748B',line:'#D9E2EC',soft:'#F5F7FA',white:'#FFFFFF'};
const money=(n:number)=>'$'+Number(n||0).toFixed(2);
const txt=(v:unknown)=>String(v??'').trim() || '—';
const page={l:36,r:36,t:28,b:38};

function footer(doc:any){const y=doc.page.height-page.b+8;doc.moveTo(page.l,y-5).lineTo(doc.page.width-page.r,y-5).strokeColor(C.line).lineWidth(.6).stroke();doc.fillColor(C.muted).font('Helvetica').fontSize(6.5).text('CONTSERTRIB FACTURACIÓN · PROFORMA / COTIZACIÓN · Sin efecto tributario',page.l,y,{width:doc.page.width-page.l-page.r-45});doc.text(`Pág. ${doc.page.number}`,doc.page.width-page.r-45,y,{width:45,align:'right'});}
function header(doc:any,e:any,p:any){const w=doc.page.width-page.l-page.r;doc.rect(0,0,doc.page.width,8).fill(C.navy);doc.roundedRect(page.l,18,w,67,5).fill(C.navy);doc.fillColor(C.white).font('Helvetica-Bold').fontSize(13).text(txt(e.razon_social)||txt(e.nombre_comercial),page.l+12,29,{width:300});doc.font('Helvetica').fontSize(7.4).text(`RUC ${txt(e.ruc)} · ${txt(e.direccion_matriz||e.direccion)}`,page.l+12,47,{width:300});if(txt(e.nombre_comercial)!==txt(e.razon_social))doc.text(txt(e.nombre_comercial),page.l+12,60,{width:300});doc.font('Helvetica-Bold').fontSize(17).text('PROFORMA',390,28,{width:145,align:'right'});doc.font('Helvetica').fontSize(8).text(`N.° ${txt(p.numero_proforma)}`,390,51,{width:145,align:'right'});doc.text(`Emisión ${txt(p.fecha_emision||fechaIsoEcuador())} · Válida hasta ${txt(p.fecha_validez)}`,390,64,{width:145,align:'right'});}
function section(doc:any,title:string,y:number){const w=doc.page.width-page.l-page.r;doc.roundedRect(page.l,y,w,19,3).fill(C.soft);doc.fillColor(C.navy).font('Helvetica-Bold').fontSize(7.5).text(title.toUpperCase(),page.l+8,y+6,{width:w-16});return y+25;}
function check(doc:any,need:number,y:number,drawHeader?:()=>void){if(y+need>doc.page.height-page.b-10){footer(doc);doc.addPage();drawHeader?.();return 106;}return y;}

export async function generarProformaPdf(id:string):Promise<Buffer>{
 const {data:p,error}=await supabase.from('proformas').select('*,clientes(*)').eq('id',id).single(); if(error||!p)throw new Error(error?.message||'Proforma no encontrada.');
 const {data:e,error:ee}=await supabase.from('emisores').select('*').eq('id',p.emisor_id).single(); if(ee||!e)throw new Error(ee?.message||'No se encontró el emisor.');
 const {data:items,error:ie}=await supabase.from('proforma_items').select('*').eq('proforma_id',id); if(ie)throw new Error(ie.message);
 const doc=new PDFDocument({size:'A4',margin:0,bufferPages:true});const chunks:Buffer[]=[];doc.on('data',(c:Buffer)=>chunks.push(c));const done=new Promise<Buffer>((resolve,reject)=>{doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject)});const w=doc.page.width-page.l-page.r,c:any=p.clientes||{};
 const drawTop=()=>{header(doc,e,p);}; drawTop(); let y=99;
 y=section(doc,'Datos del cliente',y);doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(8.2).text(txt(c.razon_social)||'Sin cliente',page.l,y,{width:265});doc.font('Helvetica').text(`${txt(c.tipo_identificacion)} ${txt(c.identificacion)}`,page.l+275,y,{width:115});doc.text(txt(c.direccion),page.l,y+12,{width:360});doc.text(txt(c.email),page.l+370,y+12,{width:158});y+=31;
 y=section(doc,'Detalle de productos / servicios',y);
 const cols=[{x:page.l,w:262,t:'DESCRIPCIÓN',a:'left'},{x:298,w:42,t:'CANT.',a:'right'},{x:346,w:63,t:'P. UNIT.',a:'right'},{x:415,w:60,t:'DESC.',a:'right'},{x:481,w:79,t:'TOTAL',a:'right'}];
 const tableHead=()=>{doc.roundedRect(page.l,y,w,18,3).fill(C.navy);doc.fillColor(C.white).font('Helvetica-Bold').fontSize(7);for(const c0 of cols)doc.text(c0.t,c0.x+4,y+6,{width:c0.w-8,align:c0.a as any});y+=18;};
 tableHead();doc.font('Helvetica').fontSize(7.6).fillColor(C.ink);
 for(const it of items||[]){const desc=txt(it.descripcion),qty=Number(it.cantidad||0),pu=Number(it.precio_unitario||0),d=Number(it.descuento||0),tot=qty*pu-d;const lines=Math.max(1,Math.ceil(desc.length/54)),h=Math.max(14,lines*9+5);if(y+h>doc.page.height-page.b-28){footer(doc);doc.addPage();drawTop();y=99;y=section(doc,'Detalle de productos / servicios',y);tableHead();}doc.text(desc,cols[0].x+4,y+4,{width:cols[0].w-8,height:h-3});doc.text(qty.toFixed(2),cols[1].x,y+4,{width:cols[1].w-4,align:'right'});doc.text(money(pu),cols[2].x,y+4,{width:cols[2].w-4,align:'right'});doc.text(money(d),cols[3].x,y+4,{width:cols[3].w-4,align:'right'});doc.text(money(tot),cols[4].x,y+4,{width:cols[4].w-4,align:'right'});y+=h;doc.moveTo(page.l,y).lineTo(page.l+w,y).strokeColor(C.line).lineWidth(.45).stroke();}
 if(!(items||[]).length){doc.fillColor(C.muted).text('No existen ítems registrados.',page.l+5,y+5);y+=18;}
 y+=7;const subtotal=Number(p.subtotal||0),total=Number(p.total||0),iva=Math.max(0,total-subtotal);y=check(doc,92,y,drawTop);
 // Bloque inferior compacto: condiciones a la izquierda, totales a la derecha.
 const boxX=page.l,boxW=330;doc.roundedRect(boxX,y,boxW,68,4).strokeColor(C.line).lineWidth(.6).stroke();doc.fillColor(C.navy).font('Helvetica-Bold').fontSize(7.5).text('CONDICIONES COMERCIALES',boxX+9,y+8);doc.fillColor(C.muted).font('Helvetica').fontSize(7).text('Precios en USD. Esta proforma es una cotización y no constituye comprobante electrónico autorizado por el SRI.',boxX+9,y+22,{width:boxW-18,height:38});
 const tx=380,tw=185;doc.fillColor(C.muted).font('Helvetica').fontSize(7.5).text('Subtotal',tx,y+5,{width:90});doc.fillColor(C.ink).text(money(subtotal),tx+95,y+5,{width:90,align:'right'});doc.fillColor(C.muted).text('IVA',tx,y+20,{width:90});doc.fillColor(C.ink).text(money(iva),tx+95,y+20,{width:90,align:'right'});doc.roundedRect(tx,y+37,tw,29,4).fill(C.navy);doc.fillColor(C.white).font('Helvetica-Bold').fontSize(10).text('TOTAL',tx+8,y+47,{width:65});doc.text(money(total),tx+78,y+47,{width:98,align:'right'});
 for(let i=0;i<doc.bufferedPageRange().count;i++){doc.switchToPage(i);footer(doc);}doc.end();return done;
}
