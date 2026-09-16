import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';

const n=(v:any)=>Math.round((Number(v)||0)*100)/100;
const money=(v:any)=>`$${n(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`;

type Row={identificacion:string;nombres:string;cargo?:string|null;sueldo:number;iessBase:number;iessPersonal:number;iessPatronal:number;decimoTercero:number;decimoCuarto:number;vacaciones:number;fondoReserva:number;beneficiosAcumulados:number;netoPagar:number;costoEmpleador:number};

export async function generarExcelRoles(opts:{empresa:any;periodo:string;rows:Row[];individual?:boolean}):Promise<Buffer>{
 const wb=new ExcelJS.Workbook(); wb.creator='CONTSERTRIB FACTURACIÓN'; wb.created=new Date();
 const ws=wb.addWorksheet(opts.individual?'Rol individual':'Roles de pago');
 ws.mergeCells('A1:N1'); ws.getCell('A1').value=opts.empresa?.razon_social||opts.empresa?.nombre_comercial||'CONTSERTRIB FACTURACIÓN'; ws.getCell('A1').font={bold:true,size:16,color:{argb:'FFFFFFFF'}}; ws.getCell('A1').fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF0F2747'}}; ws.getCell('A1').alignment={horizontal:'center'};
 ws.mergeCells('A2:N2'); ws.getCell('A2').value=`RUC: ${opts.empresa?.ruc||'—'}  ·  ROL DE PAGOS ${opts.periodo}`; ws.getCell('A2').font={bold:true,size:11}; ws.getCell('A2').alignment={horizontal:'center'};
 const headers=['Identificación','Empleado','Cargo','Sueldo','Base IESS','IESS personal','IESS patronal','Décimo 13','Décimo 14','Vacaciones','Fondo reserva','Beneficios acumulados','Neto a pagar','Costo empleador'];
 const hr=ws.addRow(headers); hr.font={bold:true,color:{argb:'FFFFFFFF'}}; hr.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF1E3A8A'}}; hr.alignment={vertical:'middle',wrapText:true};
 for(const r of opts.rows){const row=ws.addRow([r.identificacion,r.nombres,r.cargo||'',r.sueldo,r.iessBase,r.iessPersonal,r.iessPatronal,r.decimoTercero,r.decimoCuarto,r.vacaciones,r.fondoReserva,r.beneficiosAcumulados,r.netoPagar,r.costoEmpleador]); for(let c=4;c<=14;c++) row.getCell(c).numFmt='$#,##0.00';}
 if(opts.rows.length){const tr=ws.addRow(['','','TOTALES',...Array.from({length:11},(_,i)=>opts.rows.reduce((s,r)=>s+Number((r as any)[['sueldo','iessBase','iessPersonal','iessPatronal','decimoTercero','decimoCuarto','vacaciones','fondoReserva','beneficiosAcumulados','netoPagar','costoEmpleador'][i]]||0),0))]); tr.font={bold:true}; tr.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFEFF6FF'}}; for(let c=4;c<=14;c++)tr.getCell(c).numFmt='$#,##0.00';}
 ws.autoFilter={from:'A3',to:`N${Math.max(3,ws.rowCount)}`}; ws.views=[{state:'frozen',ySplit:3}]; ws.pageSetup={orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0,paperSize:9,margins:{left:.3,right:.3,top:.5,bottom:.5,header:.2,footer:.2}};
 [18,30,24,14,14,14,14,14,14,14,14,18,16,18].forEach((w,i)=>ws.getColumn(i+1).width=w);
 const sig=ws.rowCount+3; ws.mergeCells(`A${sig}:D${sig}`); ws.mergeCells(`E${sig}:H${sig}`); ws.mergeCells(`I${sig}:L${sig}`); ws.mergeCells(`M${sig}:N${sig}`); ['Elaboró / Responsable','Revisó / Contador','Aprobó / Representante','Recibí / Trabajador'].forEach((t,i)=>{const cell=ws.getCell(sig, i*4+1);cell.value=`\n\n____________________________\n${t}`;cell.alignment={horizontal:'center',vertical:'bottom',wrapText:true};cell.font={size:9};});
 return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function generarPdfRol(opts:{empresa:any;periodo:string;rows:Row[];individual?:boolean}):Promise<Buffer>{
 const doc=new PDFDocument({size:'A4',margin:36,layout:opts.individual?'portrait':'landscape'}); const chunks:Buffer[]=[]; doc.on('data',c=>chunks.push(c)); const done=new Promise<Buffer>(r=>doc.on('end',()=>r(Buffer.concat(chunks))));
 const W=doc.page.width-72;
 const empresa=opts.empresa?.razon_social||opts.empresa?.nombre_comercial||'CONTSERTRIB FACTURACIÓN';
 const header=()=>{doc.rect(36,28,W,52).fill('#0f2747');doc.fillColor('#fff').font('Helvetica-Bold').fontSize(13).text(empresa,46,38,{width:300});doc.font('Helvetica').fontSize(8).text(`RUC: ${opts.empresa?.ruc||'—'}`,46,57);doc.font('Helvetica-Bold').fontSize(13).text(opts.individual?'ROL INDIVIDUAL':'ROL GENERAL DE PAGOS',W-80,39,{width:100,align:'right'});doc.fillColor('black');doc.fontSize(9).text(`Período: ${opts.periodo}`,36,89);};
 header();
 if(opts.individual){const r=opts.rows[0]; if(!r){doc.fontSize(10).text('No existe información para el empleado seleccionado.');doc.end();return done;} let y=112; const box=(title:string,vals:[string,string][])=>{doc.font('Helvetica-Bold').fontSize(9).text(title,36,y);y+=15;for(const [a,b] of vals){doc.font('Helvetica').fontSize(8).text(a,42,y,{width:280});doc.font('Helvetica-Bold').text(b,330,y,{width:130,align:'right'});y+=16;}y+=6;};
  box('DATOS DEL TRABAJADOR',[['Identificación',r.identificacion],['Empleado',r.nombres],['Cargo',r.cargo||'—']]);
  box('INGRESOS',[['Sueldo',money(r.sueldo)],['Décimo tercero mensual',money(r.decimoTercero)],['Décimo cuarto mensual',money(r.decimoCuarto)],['Vacaciones',money(r.vacaciones)],['Fondo de reserva',money(r.fondoReserva)],['Beneficios acumulados',money(r.beneficiosAcumulados)]]);
  box('DESCUENTOS Y APORTES',[['Base IESS',money(r.iessBase)],['IESS personal',money(r.iessPersonal)]]);
  doc.roundedRect(36,y,W,38,5).fill('#eff6ff');doc.fillColor('#1e3a8a').font('Helvetica-Bold').fontSize(11).text('NETO A PAGAR',48,y+8);doc.text(money(r.netoPagar),W-20,y+8,{width:65,align:'right'});doc.fillColor('black');y+=58;
  box('COSTO DEL EMPLEADOR',[['IESS patronal',money(r.iessPatronal)],['Costo total empleador',money(r.costoEmpleador)]]);
  const sy=Math.max(y+20,doc.page.height-125); const labels=['Elaboró / Responsable','Revisó / Contador','Aprobó / Representante','Recibí / Trabajador']; for(let i=0;i<4;i++){const x=36+i*(W/4);doc.moveTo(x+8,sy).lineTo(x+W/4-12,sy).stroke();doc.fontSize(7.5).text(labels[i],x,sy+6,{width:W/4-4,align:'center'});}
 } else {
  const cols=[{t:'Identificación',w:72,k:'identificacion'},{t:'Empleado',w:105,k:'nombres'},{t:'Sueldo',w:58,k:'sueldo'},{t:'IESS',w:52,k:'iessPersonal'},{t:'13ro',w:52,k:'decimoTercero'},{t:'14to',w:52,k:'decimoCuarto'},{t:'Reserva',w:52,k:'fondoReserva'},{t:'Neto',w:62,k:'netoPagar'},{t:'Costo',w:62,k:'costoEmpleador'}]; let y=112; const drawHead=()=>{doc.rect(36,y,W,20).fill('#1e3a8a');doc.fillColor('#fff').font('Helvetica-Bold').fontSize(7);let x=38;for(const c of cols){doc.text(c.t,x,y+6,{width:c.w-3,align:['sueldo','iessPersonal','decimoTercero','decimoCuarto','fondoReserva','netoPagar','costoEmpleador'].includes(c.k)?'right':'left'});x+=c.w;}doc.fillColor('black');y+=20;};drawHead();doc.font('Helvetica').fontSize(6.8);for(const r of opts.rows){if(y>doc.page.height-75){doc.addPage({size:'A4',margin:36,layout:'landscape'});header();y=112;drawHead();}let x=38;for(const c of cols){const v=(r as any)[c.k];const text=['sueldo','iessPersonal','decimoTercero','decimoCuarto','fondoReserva','netoPagar','costoEmpleador'].includes(c.k)?money(v):String(v??'');doc.text(text,x,y+5,{width:c.w-3,align:['sueldo','iessPersonal','decimoTercero','decimoCuarto','fondoReserva','netoPagar','costoEmpleador'].includes(c.k)?'right':'left'});x+=c.w;}y+=16;doc.moveTo(36,y).lineTo(36+W,y).strokeColor('#e2e8f0').stroke().strokeColor('black');}
  const total=(k:keyof Row)=>opts.rows.reduce((s,r)=>s+Number((r as any)[k]||0),0);doc.font('Helvetica-Bold').fontSize(8);doc.text('TOTALES',38,y+5);let tx=38+72+105;for(const k of ['sueldo','iessPersonal','decimoTercero','decimoCuarto','fondoReserva','netoPagar','costoEmpleador'] as (keyof Row)[]){const w= k==='sueldo'?58:(['iessPersonal','decimoTercero','decimoCuarto','fondoReserva'] as string[]).includes(String(k))?52:62;doc.text(money(total(k)),tx,y+5,{width:w-3,align:'right'});tx+=w;}y+=34;
  const sy=Math.min(y,doc.page.height-72);const labels=['Elaboró / Responsable','Revisó / Contador','Aprobó / Representante','Recibí / Trabajadores'];for(let i=0;i<4;i++){const x=36+i*(W/4);doc.moveTo(x+8,sy).lineTo(x+W/4-12,sy).stroke();doc.fontSize(7.5).text(labels[i],x,sy+6,{width:W/4-4,align:'center'});}
 }
 doc.fillColor('#64748b').font('Helvetica').fontSize(7).text('CONTSERTRIB FACTURACIÓN · Rol generado para control administrativo y contable',36,doc.page.height-25,{width:W,align:'center'});doc.end();return done;
}
