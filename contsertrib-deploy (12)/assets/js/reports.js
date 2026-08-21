/* CONTSERTRIB · Exportación Excel y PDF con formato profesional */
'use strict';

function getExportDataset(pane){
  const val=id=>{const e=document.getElementById(id);return e?e.value:'';};
  switch(pane){
    case 'transacciones': return {title:'Compras y Gastos',
      headers:['Fecha','RUC Emisor','Proveedor','N° Comprobante','Resumen','Categoría','Cuenta Contable','Base Neta','IVA','Total'],
      rows:txFiltered.map(d=>[fmtDate(d['FECHA EMISION']),d['RUC EMISOR'],d['RAZON SOCIAL EMISOR'],d['NO COMPROBANTE'],d.RESUMEN,d.CUENTA,`${d._ctaCod} - ${d._ctaNom}`,+d.BASENETA||0,+d.IVA||0,+d.TOTAL||0]),
      excludeTotalCols:['RUC Emisor']};
    case 'ventas': return {title:'Ventas e Ingresos',
      headers:['Fecha','Cliente','RUC Cliente','N° Documento','Base Neta','IVA','Total'],
      rows:vtFiltered.map(v=>[fmtDate(v['FECHA EMISION']),v['RAZON SOCIAL RECEPTOR'],v['RUC RECEPTOR'],v['NO DOCUMENTO'],+v.BASENETA||0,+v.IVA||0,+v.TOTAL||0]),
      excludeTotalCols:['RUC Cliente']};
    case 'retenciones': return {title:'Retenciones Recibidas',
      headers:['Fecha','Agente de Retención','RUC Agente','Doc. Sustento','Ret. Renta','Ret. IVA','Total Retenido'],
      rows:retFiltered.map(r=>[fmtDate(r['FECHA EMISION']),r['AGENTE RETENCION'],r['RUC AGENTE'],r['DOCUMENTO SUSTENTO'],+r['VALOR RET RENTA']||0,+r['VALOR RET IVA']||0,round2((+r['VALOR RET RENTA']||0)+(+r['VALOR RET IVA']||0))]),
      excludeTotalCols:['RUC Agente']};
    case 'plancuentas': return {title:'Plan de Cuentas',
      headers:['Código','Cuenta','Nivel'],
      rows:PLAN_CUENTAS.map(c=>[c.cod,c.nom,c.niv]),noTotals:true};
    case 'proveedores': return {title:'Clasificación por Proveedor',
      headers:['RUC','Proveedor','N° Facturas','Total Acumulado','Cuenta Asignada'],
      rows:getProveedoresResumen().map(p=>[p.ruc,p.nombre,p.count,p.total,PROVEEDOR_RULES[p.ruc]?`${PROVEEDOR_RULES[p.ruc].cod} - ${PROVEEDOR_RULES[p.ruc].nom}`:'(categoría SRI)'])};
    case 'clientes': return {title:'Clasificación por Cliente',
      headers:['RUC','Cliente','N° Facturas','Total Acumulado','Cuenta de Ingreso'],
      rows:getClientesResumen().map(c=>[c.ruc,c.nombre,c.count,c.total,CLIENTE_RULES[c.ruc]?`${CLIENTE_RULES[c.ruc].cod} - ${CLIENTE_RULES[c.ruc].nom}`:'(cuenta por defecto)'])};
    case 'libro': {
      const rows=[];
      (diarFiltered||[]).forEach(e=>e.lines.forEach(l=>rows.push([fmtDate(e.fecha),e.id,e.concepto,e.glosa||'',e.ref,l.cta,l.nom,+l.debe||0,+l.haber||0])));
      return {title:'Libro Diario',headers:['Fecha','Asiento','Concepto','Glosa','Referencia','Código','Cuenta','Debe','Haber'],rows};
    }
    case 'manual': {
      const rows=[];
      manualEntries().forEach(e=>e.lines.forEach(l=>rows.push([fmtDate(e.fecha),e.id,e.concepto,e.ref,l.cta,l.nom,+l.debe||0,+l.haber||0])));
      return {title:'Asientos Manuales',headers:['Fecha','Asiento','Concepto','Referencia','Código','Cuenta','Debe','Haber'],rows};
    }
    case 'descuadrados': {
      const rows=[];
      allEntries().forEach(e=>{const t=entryTotals(e); if(Math.abs(t.diff)>=0.01) e.lines.forEach(l=>rows.push([fmtDate(e.fecha),e.id,e.concepto,l.cta,l.nom,+l.debe||0,+l.haber||0,t.diff]));});
      return {title:'Asientos Descuadrados',headers:['Fecha','Asiento','Concepto','Código','Cuenta','Debe','Haber','Diferencia'],rows,excludeTotalCols:['Diferencia']};
    }
    case 'mayores': {
      const q=(val('may-search')||'').toLowerCase(), ctaSel=val('may-cuenta'), per=val('may-periodo');
      let cuentas=buildLedger('',per);
      if(ctaSel) cuentas=cuentas.filter(c=>c.nom===ctaSel);
      if(q) cuentas=cuentas.filter(c=>`${c.cod} ${c.nom}`.toLowerCase().includes(q));
      const rows=[];
      cuentas.forEach(c=>{let s=0;
        c.movs.slice().sort((a,b)=>String(a.fecha).localeCompare(String(b.fecha))).forEach(m=>{
          s=round2(s+(+m.debe||0)-(+m.haber||0));
          rows.push([c.cod,c.nom,fmtDate(m.fecha),m.asiento,m.concepto,+m.debe||0,+m.haber||0,s]);});});
      return {title:'Mayores por Cuenta',headers:['Código','Cuenta','Fecha','Asiento','Concepto','Debe','Haber','Saldo'],rows,excludeTotalCols:['Saldo']};
    }
    case 'diario': {
      const rows=[];
      buildLedger('',val('bal-periodo')).forEach(c=>{
        const d=round2(c.movs.reduce((a,m)=>a+(+m.debe||0),0)), h=round2(c.movs.reduce((a,m)=>a+(+m.haber||0),0));
        rows.push([c.cod,c.nom,d,h,d>h?round2(d-h):0,h>d?round2(h-d):0]);});
      return {title:'Balance de Comprobación',headers:['Código','Cuenta','Debe','Haber','Saldo Deudor','Saldo Acreedor'],rows};
    }
    case 'bgeneral': {
      const bg=computeBalanceGeneral(val('bg-periodo')), rows=[];
      rows.push(['ACTIVO','','','']);
      bg.activo.forEach(r=>rows.push(['',r.cod,r.nom,r.saldo]));
      rows.push(['','','TOTAL ACTIVO',bg.totalActivo],['PASIVO','','','']);
      bg.pasivo.forEach(r=>rows.push(['',r.cod,r.nom,r.saldo]));
      rows.push(['','','TOTAL PASIVO',bg.totalPasivo],['PATRIMONIO','','','']);
      bg.patrimonio.forEach(r=>rows.push(['',r.cod,r.nom,r.saldo]));
      rows.push(['','','Resultado del Ejercicio',bg.resultado],['','','TOTAL PATRIMONIO',bg.totalPatrimonio],
        ['','','TOTAL PASIVO + PATRIMONIO',round2(bg.totalPasivo+bg.totalPatrimonio)],['','','Diferencia de control',bg.diferencia]);
      return {title:'Balance General',headers:['Sección','Código','Cuenta','Monto'],rows,noTotals:true};
    }
    case 'eresultados': {
      const er=computeEstadoResultados(val('er-periodo')), rows=[];
      rows.push(['INGRESOS','','','']);
      er.ingresosArr.forEach(g=>rows.push(['',g.cod,g.nom,g.total]));
      rows.push(['','','TOTAL INGRESOS',er.totalIngresos],['COSTO DE VENTAS','','','']);
      er.costos.forEach(g=>rows.push(['',g.cod,g.nom,-g.total]));
      rows.push(['','','TOTAL COSTO DE VENTAS',-er.totalCostos],['','','UTILIDAD BRUTA',er.utilidadBruta],['GASTOS OPERACIONALES','','','']);
      er.gastosOp.forEach(g=>rows.push(['',g.cod,g.nom,-g.total]));
      rows.push(['','','TOTAL GASTOS OPERACIONALES',-er.totalGastosOp],['','','UTILIDAD OPERACIONAL',er.utilidadOperacional],['GASTOS NO OPERACIONALES','','','']);
      er.gastosNoOp.forEach(g=>rows.push(['',g.cod,g.nom,-g.total]));
      rows.push(['','','TOTAL GASTOS NO OPERACIONALES',-er.totalGastosNoOp],
        ['','','UTILIDAD ANTES DE PARTICIPACIÓN E IMPUESTOS',er.utilidadAntes],
        ['','',''+Math.round(PCT_PART_TRAB*100)+'% Participación Trabajadores',-er.partTrab],
        ['','','Impuesto a la Renta estimado ('+Math.round(PCT_IR_SOC*100)+'%)',-er.irEstimado],
        ['','','RESULTADO NETO ESTIMADO',round2(er.utilidadAntes-er.partTrab-er.irEstimado)],
        ['','','IVA Crédito Tributario (informativo)',er.totalIVA]);
      return {title:'Estado de Resultados',headers:['Sección','Código','Cuenta','Monto'],rows,noTotals:true};
    }
    case 'nomina': {
      if(typeof nomCalc==='undefined'||!nomCalc||!nomCalc.detalle||!nomCalc.detalle.length) return null;
      const {periodo,detalle,tot}=nomCalc;
      const rows=detalle.map(r=>[r.nombre||r.nombre1||'',r.cargo||'',+r.sueldo||0,+r.personal||0,+r.fr||0,+r.quiro||0,+r.prestamo||0,+r.ext||0,+r.anticipo||0,+r.neto||0,+r.patronal||0,+r.d13||0,+r.d14||0,+r.vac||0]);
      return {title:'Rol de Pagos - '+periodLabel(periodo),
        headers:['Empleado','Cargo','Sueldo','Aporte Pers.','F. Reserva','Quirografario','Préstamo','Ext. Cónyuge','Anticipo','Líquido','Aporte Pat.','13°','14°','Vacaciones'],rows};
    }
    case 'conciliacion': {
      if(typeof CONC_CURRENT==='undefined'||!CONC_CURRENT) return null;
      const c=CONC_CURRENT, rows=[];
      rows.push(['SALDO SEGÚN LIBRO','',+c.saldoLibro||0]);
      rows.push(['(+) Débitos no registrados en libro','',c.unmatchedBanco?c.unmatchedBanco.filter(u=>u.debe>0).reduce((a,u)=>a+(+u.debe||0),0):0]);
      rows.push(['(-) Créditos no registrados en libro','',c.unmatchedBanco?c.unmatchedBanco.filter(u=>u.haber>0).reduce((a,u)=>a+(+u.haber||0),0):0]);
      rows.push(['SALDO SEGÚN BANCO','',+c.saldoBanco||0]);
      rows.push(['(-) Débitos no registrados en banco','',c.unmatchedLibro?c.unmatchedLibro.filter(u=>u.debe>0).reduce((a,u)=>a+(+u.debe||0),0):0]);
      rows.push(['(+) Créditos no registrados en banco','',c.unmatchedLibro?c.unmatchedLibro.filter(u=>u.haber>0).reduce((a,u)=>a+(+u.haber||0),0):0]);
      rows.push(['DIFERENCIA','',round2((+c.saldoLibro||0)-(+c.saldoBanco||0))]);
      const detailRows=[];
      if(c.unmatchedLibro&&c.unmatchedLibro.length) c.unmatchedLibro.forEach(u=>detailRows.push(['Libro',fmtConcDate?fmtConcDate(u.fecha):u.fecha,u.concepto||'',+u.debe||0,+u.haber||0]));
      if(c.unmatchedBanco&&c.unmatchedBanco.length) c.unmatchedBanco.forEach(u=>detailRows.push(['Banco',fmtConcDate?fmtConcDate(u.fecha):u.fecha,u.concepto||'',+u.debe||0,+u.haber||0]));
      return {title:'Conciliación Bancaria - '+periodLabel(c.periodo||''),
        headers:['Concepto','','Monto'],rows,noTotals:true,
        extraRows:[[],['PARTIDAS NO CONCILIADAS'],['Origen','Fecha','Concepto','Debe','Haber'],...detailRows]};
    }
    case 'activos': {
      if(typeof ACTIVOS_FIJOS==='undefined'||!ACTIVOS_FIJOS.length) return null;
      const rows=ACTIVOS_FIJOS.map(a=>{
        const dep=(typeof calcularDepreciacion==='function')?calcularDepreciacion(a):{depAcumulada:0,valorNeto:+a.costo||0};
        const grp=(typeof getGrupo==='function')?getGrupo(a.grupo):{nom:'Sin grupo',pctAnual:0};
        return [a.codigo||a.id,a.nombre||'',grp.nom||a.grupo,+a.costo||0,+a.valorResidual||0,dep.depAcumulada,dep.valorNeto,a.estado||'activo',a.fechaAdq||''];
      });
      return {title:'Registro de Activos Fijos',
        headers:['Código','Nombre','Grupo','Costo','Valor Residual','Dep. Acumulada','Valor Neto','Estado','Fecha Adquisición'],rows,noTotals:true};
    }
    case 'dashboard': {
      const rows=[];
      if(typeof EMPRESA!=='undefined'&&EMPRESA.nombre) rows.push(['Empresa',EMPRESA.nombre,'RUC',EMPRESA.ruc||'-']);
      if(typeof txFiltered!=='undefined') rows.push(['Compras registradas',(txFiltered||[]).length,'Total compras','$'+((txFiltered||[]).reduce((a,d)=>a+(+d.TOTAL||0),0)).toFixed(2)]);
      if(typeof vtFiltered!=='undefined') rows.push(['Ventas registradas',(vtFiltered||[]).length,'Total ventas','$'+((vtFiltered||[]).reduce((a,v)=>a+(+v.TOTAL||0),0)).toFixed(2)]);
      if(typeof NOMINA_EMPLEADOS!=='undefined') rows.push(['Empleados activos',(NOMINA_EMPLEADOS||[]).filter(e=>e.activo).length,'Nóminas procesadas',Object.keys(NOMINA_RUNS||{}).length]);
      if(typeof ACTIVOS_FIJOS!=='undefined') rows.push(['Activos fijos',(ACTIVOS_FIJOS||[]).length,'Activos vigentes',(ACTIVOS_FIJOS||[]).filter(a=>a.estado==='activo').length]);
      rows.push(['Fecha de generación',new Date().toLocaleString('es-EC')]);
      return {title:'Resumen General del Sistema',headers:['Indicador','Valor','Detalle','Dato'],rows,noTotals:true};
    }
    default: return null;
  }
}

function computeTotalsRow(ds){
  if(!ds||!ds.rows.length||ds.noTotals) return null;
  const ex=(ds.excludeTotalCols||[]).map(h=>h.toLowerCase());
  const idx=[]; ds.headers.forEach((h,i)=>{ if(ex.includes(String(h).toLowerCase())) return;
    if(ds.rows.every(r=>typeof r[i]==='number')) idx.push(i); });
  if(!idx.length) return null;
  const sums={}; idx.forEach(i=>sums[i]=round2(ds.rows.reduce((a,r)=>a+(+r[i]||0),0)));
  const row=ds.headers.map((h,i)=>idx.includes(i)?sums[i]:(i===0?'TOTALES':''));
  const di=ds.headers.findIndex(h=>h.toLowerCase()==='debe'), hi=ds.headers.findIndex(h=>h.toLowerCase()==='haber');
  return {row,sums,totDebe:di>=0?sums[di]:null,totHaber:hi>=0?sums[hi]:null};
}

function exportPaneExcel(pane){
  const ds=getExportDataset(pane);
  if(!ds||!ds.rows.length) return showToast('No hay datos para exportar','err');
  if(typeof XLSX==='undefined') return showToast('No se pudo cargar el generador de Excel','err');
  const tot=computeTotalsRow(ds);
  const aoa=[[EMPRESA.nombre||'Empresa sin configurar'],
    ['RUC: '+(EMPRESA.ruc||'-')+(EMPRESA.ciudad?' · '+EMPRESA.ciudad:'')],
    [ds.title+' · '+periodLabel(document.getElementById(pane==='eresultados'?'er-periodo':pane==='balancegeneral'?'bg-periodo':'')?.value||'')],
    ['Generado: '+new Date().toLocaleString('es-EC')],[],ds.headers,...ds.rows,...(tot?[[],tot.row]:[]),...(ds.extraRows&&ds.extraRows.length?[[],...ds.extraRows]:[])];
  const ws=XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols']=ds.headers.map((h,i)=>({wch:i<2?26:18}));
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,ds.title.slice(0,31));
  XLSX.writeFile(wb,`${slug(EMPRESA.nombre)}_${slug(ds.title)}_${hoyISO()}.xlsx`);
  showToast('Excel generado');
}

function drawPdfHeader(doc,title,sub){
  const W=doc.internal.pageSize.getWidth();
  doc.setFillColor(15,61,51); doc.rect(0,0,W,58,'F');
  doc.setTextColor(255); doc.setFont('helvetica','bold'); doc.setFontSize(15);
  doc.text(EMPRESA.nombre||'Empresa sin configurar',40,26);
  doc.setFont('helvetica','normal'); doc.setFontSize(9);
  doc.text('RUC: '+(EMPRESA.ruc||'-')+(EMPRESA.ciudad?' · '+EMPRESA.ciudad:''),40,42);
  doc.setFontSize(8);
  doc.text('Generado: '+new Date().toLocaleString('es-EC',{dateStyle:'medium',timeStyle:'short'}),W-40,26,{align:'right'});
  doc.text('Documento contable',W-40,42,{align:'right'});
  doc.setTextColor(20); doc.setFont('helvetica','bold'); doc.setFontSize(13);
  doc.text(title||'Reporte',40,78);
  let y=88;
  if(sub){ doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(100); doc.text(sub,40,92); y=100; }
  doc.setDrawColor(216,224,234); doc.line(40,y,W-40,y);
  return y+12;
}

function buildPdfColumnStyles(hs){
  const keys=['debe','haber','base','iva','total','monto','saldo','sueldo','neto','aporte','prov.','préstamo','anticipo','ret.','ap. ','f. reserva','ext.'];
  const st={}; hs.forEach((h,i)=>{ if(keys.some(k=>String(h).toLowerCase().includes(k))) st[i]={halign:'right'}; });
  return st;
}

function drawPdfSignatures(doc,startY){
  const W=doc.internal.pageSize.getWidth(),H=doc.internal.pageSize.getHeight();
  let y=startY+30; if(y+95>H-30){ doc.addPage(); y=50; }
  const usable=W-80,gap=24,cw=(usable-gap*2)/3,ly=y+42;
  const labels=['ELABORADO POR','REVISADO POR','APROBADO POR'];
  const nombres=[EMPRESA.contador||'',EMPRESA.contador||'',EMPRESA.representante||''];
  doc.setDrawColor(140,150,165);
  labels.forEach((lb,i)=>{
    const x=40+i*(cw+gap);
    doc.line(x,ly,x+cw,ly);
    doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor(70,80,95);
    doc.text(lb,x+cw/2,ly+11,{align:'center'});
    doc.setFont('helvetica','normal'); doc.setFontSize(7.5); doc.setTextColor(120,128,140);
    doc.text('Nombre: '+(nombres[i]||'______________________'),x,ly+25);
    doc.text('C.I. / Cargo: __________________',x,ly+36);
  });
  return ly+36;
}

function addPdfPageNumbers(doc){
  const n=doc.internal.getNumberOfPages(),W=doc.internal.pageSize.getWidth(),H=doc.internal.pageSize.getHeight();
  for(let i=1;i<=n;i++){ doc.setPage(i); doc.setFont('helvetica','normal'); doc.setFontSize(7.5); doc.setTextColor(140);
    doc.text(EMPRESA.nombre||'-',40,H-20); doc.text(`Página ${i} de ${n}`,W-40,H-20,{align:'right'}); }
}

function exportPanePDF(pane){
  const ds=getExportDataset(pane);
  if(!ds||!ds.rows.length) return showToast('No hay datos para exportar','err');
  if(typeof window.jspdf==='undefined') return showToast('No se pudo cargar el generador de PDF','err');
  const {jsPDF}=window.jspdf;
  const doc=new jsPDF({orientation:ds.headers.length>6?'landscape':'portrait',unit:'pt'});
  const cell=v=>typeof v==='number'?'$'+v.toFixed(2):(v==null?'':String(v));
  const y=drawPdfHeader(doc,ds.title,'Fecha de generación: '+new Date().toLocaleDateString('es-EC'));
  const tot=computeTotalsRow(ds);
  doc.autoTable({head:[ds.headers],body:ds.rows.map(r=>r.map(cell)),
    foot:tot?[tot.row.map(cell)]:undefined,showFoot:tot?'lastPage':undefined,startY:y,
    styles:{fontSize:7.5,cellPadding:4,lineColor:[216,224,234],lineWidth:.5,overflow:'linebreak'},
    headStyles:{fillColor:[15,61,51],textColor:255,fontStyle:'bold'},
    footStyles:{fillColor:[230,235,245],textColor:20,fontStyle:'bold'},
    alternateRowStyles:{fillColor:[248,250,252]},
    columnStyles:buildPdfColumnStyles(ds.headers),margin:{left:40,right:40}});
  let fy=doc.lastAutoTable?doc.lastAutoTable.finalY:y;
  if(tot&&tot.totDebe!=null&&tot.totHaber!=null){
    doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(20);
    doc.text(`Suma DEBE: $${tot.totDebe.toFixed(2)}   ·   Suma HABER: $${tot.totHaber.toFixed(2)}   ·   ${Math.abs(tot.totDebe-tot.totHaber)<0.02?'✓ Cuadra':' Diferencia $'+Math.abs(tot.totDebe-tot.totHaber).toFixed(2)}`,40,fy+18);
    fy+=18;
  }
  if(ds.extraRows&&ds.extraRows.length){
    const H=doc.internal.pageSize.getHeight();
    if(fy+40>H-40){ doc.addPage(); fy=50; }
    const extraBody=ds.extraRows.filter(r=>r.length>0&&r[0]!=='').map(r=>r.map(cell));
    if(extraBody.length){
      doc.autoTable({body:extraBody,startY:fy+10,styles:{fontSize:7.5,cellPadding:4,lineColor:[216,224,234],lineWidth:.5,overflow:'linebreak'},
        alternateRowStyles:{fillColor:[248,250,252]},margin:{left:40,right:40}});
      fy=doc.lastAutoTable?doc.lastAutoTable.finalY:fy;
    }
  }
  drawPdfSignatures(doc,fy); addPdfPageNumbers(doc);
  doc.save(`${slug(EMPRESA.nombre)}_${slug(ds.title)}_${hoyISO()}.pdf`);
  showToast('PDF generado');
}

/* Auto-expose window */
window.exportPaneExcel = exportPaneExcel;
window.exportPanePDF = exportPanePDF;
