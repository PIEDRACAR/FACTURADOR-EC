/* CONTSERTRIB · Estado, reglas, asientos, mayores y estados financieros */
'use strict';

let RAW_COMPRAS = LS.get(K.compras,[]);
let RAW_VENTAS  = LS.get(K.ventas,[]);
let RAW_RET     = LS.get(K.ret,[]);
let PROVEEDOR_RULES = LS.get(K.provRules,{});
let CLIENTE_RULES   = LS.get(K.cliRules,{});
let TX_OVERRIDES    = LS.get(K.txOv,{});
let MANUAL_ASIENTOS = LS.get(K.manual,[]);
let AUTO_ADJ  = LS.get(K.adjAuto,{});
let ENTRY_ADJ = LS.get(K.adjEntry,{});
let DATA=[], DATA_VENTAS=[], DATA_RETENCIONES=[];

const saveCompras=()=>LS.set(K.compras,RAW_COMPRAS);
const saveVentas =()=>LS.set(K.ventas,RAW_VENTAS);
const saveRet    =()=>LS.set(K.ret,RAW_RET);
const persistProveedorRules=()=>LS.set(K.provRules,PROVEEDOR_RULES);
const persistClienteRules  =()=>LS.set(K.cliRules,CLIENTE_RULES);
const persistTxOverrides   =()=>LS.set(K.txOv,TX_OVERRIDES);
const persistManuales      =()=>LS.set(K.manual,MANUAL_ASIENTOS);
const persistAutoAdj       =()=>LS.set(K.adjAuto,AUTO_ADJ);
const persistEntryAdj      =()=>LS.set(K.adjEntry,ENTRY_ADJ);

function rebuildData(){
  DATA = RAW_COMPRAS.map((r,i)=>{
    const base = CUENTA_MAP[r.CUENTA] || CUENTA_MAP['GASTOS POR CLASIFICAR SRI'];
    const regla = PROVEEDOR_RULES[String(r['RUC EMISOR']||'').trim()];
    const c = TX_OVERRIDES[i] || regla || base;
    return {...r,_idx:i,_ctaCod:c.cod,_ctaNom:c.nom};
  });
}
function rebuildVentas(){
  DATA_VENTAS = RAW_VENTAS.map((r,i)=>{
    const regla = CLIENTE_RULES[String(r['RUC RECEPTOR']||'').trim()];
    const c = regla || CTA.ingreso;
    return {...r,_idx:i,_ctaCod:c.cod,_ctaNom:c.nom};
  });
}
function rebuildRetenciones(){ DATA_RETENCIONES = RAW_RET.map((r,i)=>({...r,_idx:i})); }
function rebuildAll(){ rebuildData(); rebuildVentas(); rebuildRetenciones(); }

function periodosDisponibles(){
  return [...new Set([
    ...RAW_COMPRAS.map(d=>d.PERIODO), ...RAW_VENTAS.map(d=>d.PERIODO),
    ...RAW_RET.map(d=>d.PERIODO), ...MANUAL_ASIENTOS.map(a=>a.periodo)
  ].filter(Boolean))].sort();
}

/* ---------- Asientos automáticos ---------- */
function getAsientoCompra(d){
  const l=[]; const base=+d.BASENETA||0, iva=+d.IVA||0, tot=+d.TOTAL||0;
  const otros = round2((+d.ICE||0)+(+d.IRBPN||0)+(+d.PROPINA||0));
  if(base) l.push({cta:d._ctaCod,nom:d._ctaNom,debe:base>0?base:0,haber:base<0?-base:0});
  if(iva)  l.push({cta:CTA.ivaCompras.cod,nom:CTA.ivaCompras.nom,debe:iva>0?iva:0,haber:iva<0?-iva:0});
  if(otros)l.push({cta:'5.2.1.14',nom:cuentaNom('5.2.1.14'),debe:otros>0?otros:0,haber:otros<0?-otros:0});
  if(tot)  l.push({cta:CTA.compras.cod,nom:CTA.compras.nom,debe:tot<0?-tot:0,haber:tot>0?tot:0});
  return l;
}
function getAsientoVenta(v){
  const l=[]; const tot=+v.TOTAL||0, base=round2(+v.BASENETA||0), iva=+v.IVA||0;
  if(tot) l.push({cta:CTA.ventas.cod,nom:CTA.ventas.nom,debe:tot,haber:0});
  if(base)l.push({cta:v._ctaCod,nom:v._ctaNom,debe:0,haber:base});
  if(iva) l.push({cta:CTA.ivaVentas.cod,nom:CTA.ivaVentas.nom,debe:0,haber:iva});
  const otros = round2((+v.ICE||0)+(+v.IRBPN||0)+(+v.PROPINA||0)-(+v.DESCUENTO||0));
  if(otros) l.push({cta:CTA.otrosIng.cod,nom:CTA.otrosIng.nom,debe:otros<0?-otros:0,haber:otros>0?otros:0});
  return l;
}
function getAsientoRetencion(r){
  const l=[]; const ir=+r['VALOR RET RENTA']||0, iv=+r['VALOR RET IVA']||0;
  if(ir) l.push({cta:CTA.retIR.cod,nom:CTA.retIR.nom,debe:ir,haber:0});
  if(iv) l.push({cta:CTA.retIVA.cod,nom:CTA.retIVA.nom,debe:iv,haber:0});
  const t=round2(ir+iv);
  if(t)  l.push({cta:CTA.ventas.cod,nom:CTA.ventas.nom,debe:0,haber:t});
  return l;
}
function buildGlosa(e){
  const ref = e.ref?String(e.ref).trim():'';
  switch(e.source){
    case 'auto': return `Por compra de bienes/servicios a ${e.concepto}${ref?', s/comprobante N° '+ref:''}.${e.resumen?' '+e.resumen:''}`;
    case 'auto-venta': return `Por venta de bienes/servicios a ${e.concepto}${ref?', s/documento N° '+ref:''}.`;
    case 'auto-ret': return `Por retención en la fuente recibida de ${e.concepto}${ref?', s/comprobante N° '+ref:''}.`;
    default: return e.concepto || e.resumen || '';
  }
}
function generatedEntries(){
  return DATA.map((d,i)=>{
    const id='AUTO-'+String(i+1).padStart(4,'0');
    const adj=AUTO_ADJ[i], bulk=ENTRY_ADJ[id], orig=getAsientoCompra(d);
    let lines=orig;
    if(bulk&&bulk.lines&&adj&&adj.lines) lines=((bulk.updatedAt||'')>=(adj.updatedAt||''))?bulk.lines:adj.lines;
    else if(bulk&&bulk.lines) lines=bulk.lines;
    else if(adj&&adj.lines) lines=adj.lines;
    const e={id,dataIdx:i,source:'auto',fecha:d['FECHA EMISION'],periodo:d.PERIODO,ref:d['NO COMPROBANTE'],
      Concepto:d['RAZON SOCIAL EMISOR'],resumen:d.RESUMEN,original:d,lines,
      Adjusted:!!adj,adjustment:adj||null,bulkAdjusted:!!bulk,bulkNote:bulk?(bulk.note||''):''};
    e.glosa=(bulk&&bulk.glosaOverride)?bulk.glosaOverride:buildGlosa(e);
    return e;
  });
}
function generatedVentaEntries(){
  return DATA_VENTAS.map((v,i)=>{
    const id='VTA-'+String(i+1).padStart(4,'0'); const bulk=ENTRY_ADJ[id];
    const e={id,dataIdx:i,source:'auto-venta',fecha:v['FECHA EMISION'],periodo:v.PERIODO,ref:v['NO DOCUMENTO'],
      Concepto:v['RAZON SOCIAL RECEPTOR']||'Cliente',resumen:'Factura de venta',original:v,
      lines:(bulk&&bulk.lines)?bulk.lines:getAsientoVenta(v),adjusted:false,adjustment:null,
      bulkAdjusted:!!bulk,bulkNote:bulk?(bulk.note||''):''};
    e.glosa=(bulk&&bulk.glosaOverride)?bulk.glosaOverride:buildGlosa(e);
    return e;
  });
}
function generatedRetencionEntries(){
  return DATA_RETENCIONES.map((r,i)=>{
    const id='RET-'+String(i+1).padStart(4,'0'); const bulk=ENTRY_ADJ[id];
    const e={id,dataIdx:i,source:'auto-ret',fecha:r['FECHA EMISION'],periodo:r.PERIODO,ref:r['NO COMPROBANTE'],
      Concepto:r['AGENTE RETENCION']||'Agente de retención',
      Resumen:'Retención recibida (sustento: '+(r['DOCUMENTO SUSTENTO']||'-')+')',original:r,
      lines:(bulk&&bulk.lines)?bulk.lines:getAsientoRetencion(r),adjusted:false,adjustment:null,
      bulkAdjusted:!!bulk,bulkNote:bulk?(bulk.note||''):''};
    e.glosa=(bulk&&bulk.glosaOverride)?bulk.glosaOverride:buildGlosa(e);
    return e;
  });
}
function manualEntries(){
  return MANUAL_ASIENTOS.map((a,i)=>{
    const e={id:'MAN-'+String(i+1).padStart(4,'0'),dbId:a.id,source:'manual',fecha:a.fecha,periodo:a.periodo,
      Ref:a.ref,concepto:a.concepto,resumen:a.nomina?'Asiento de nómina':'Asiento manual',original:null,lines:a.lines};
    e.glosa=buildGlosa(e); return e;
  });
}
let _entriesCache=null, _entriesStamp=0;
function invalidateEntries(){ _entriesCache=null; }
function allEntries(){
  if(_entriesCache) return _entriesCache;
  _entriesCache=[...generatedEntries(),...generatedVentaEntries(),...generatedRetencionEntries(),...manualEntries()];
  return _entriesCache;
}
function entryTotals(e){
  const debe=round2(e.lines.reduce((a,l)=>a+(+l.debe||0),0));
  const haber=round2(e.lines.reduce((a,l)=>a+(+l.haber||0),0));
  return {debe,haber,diff:round2(debe-haber)};
}
function diagnosticForEntry(e){
  const t=entryTotals(e);
  if(Math.abs(t.diff)<0.01) return 'Cuadra correctamente.';
  if(e.source==='manual') return 'Asiento manual descuadrado: revisa los valores digitados o la cuenta de contrapartida.';
  const d=e.original||{};
  const suma=round2((+d.BASENETA||0)+(+d.IVA||0)+(+d.ICE||0)+(+d.IRBPN||0)+(+d.PROPINA||0));
  const total=round2(+d.TOTAL||0), difDoc=round2(suma-total);
  if(Math.abs(+d.DIFERENCIA||0)>=0.01||Math.abs(difDoc)>=0.01)
    return `Diferencia en el documento fuente: suma de bases + impuestos $${fmt(suma)} vs. Total del comprobante $${fmt(total)} (diferencia $${fmt(+d.DIFERENCIA||difDoc)}). Suele ser redondeo del emisor o descuentos no desglosados.`;
  return 'La diferencia proviene del armado contable: revisa IVA, base no objeto o la cuenta de contrapartida.';
}

/* ---------- Mayores ---------- */
function buildLedger(codFilter='', periodo=''){
  const c={};
  allEntries().forEach(e=>{
    if(periodo && e.periodo!==periodo) return;
    e.lines.forEach(l=>{
      if(codFilter && l.cta!==codFilter) return;
      if(!c[l.cta]) c[l.cta]={cod:l.cta,nom:l.nom||cuentaNom(l.cta),movs:[]};
      c[l.cta].movs.push({...l,fecha:e.fecha,ref:e.ref,concepto:e.concepto,resumen:e.resumen,asiento:e.id,source:e.source});
    });
  });
  return Object.values(c).sort((a,b)=>a.cod.localeCompare(b.cod));
}

/* ---------- Estado de Resultados ---------- */
function computeEstadoResultados(periodo){
  const entries=allEntries().filter(e=>!periodo||e.periodo===periodo);
  const g={}, ing={}; let totalIVA=0; const ventasMal=[];
  entries.forEach(e=>{
    if(e.source==='auto-venta' && !e.lines.some(l=>String(l.cta).startsWith('4.'))) ventasMal.push(e);
    e.lines.forEach(l=>{
      const c=String(l.cta||'').trim(), d=+l.debe||0, h=+l.haber||0;
      if(c.startsWith('5.')){ (g[c]=g[c]||{cod:c,nom:l.nom,total:0,docs:new Set()}); g[c].total=round2(g[c].total+(d-h)); g[c].docs.add(e.id); }
      else if(c.startsWith('4.')){ (ing[c]=ing[c]||{cod:c,nom:l.nom,total:0,docs:new Set()}); ing[c].total=round2(ing[c].total+(h-d)); ing[c].docs.add(e.id); }
      else if(c===CTA.ivaCompras.cod) totalIVA=round2(totalIVA+(d-h));
    });
  });
  const arr=o=>Object.values(o).map(x=>({cod:x.cod,nom:x.nom,total:x.total,docs:x.docs.size}));
  const gastos=arr(g), ingresosArr=arr(ing);
  const costos=gastos.filter(x=>x.cod.startsWith('5.1'));
  const gastosOp=gastos.filter(x=>x.cod.startsWith('5.2'));
  const gastosNoOp=gastos.filter(x=>x.cod.startsWith('5.3'));
  const impuestos=gastos.filter(x=>x.cod.startsWith('5.4'));
  const otros=gastos.filter(x=>!/^5\.[1234]/.test(x.cod));
  const s=a=>round2(a.reduce((t,x)=>t+x.total,0));
  const totalCostos=s(costos), totalGastosOp=s(gastosOp), totalGastosNoOp=s(gastosNoOp), totalImp=s(impuestos), totalOtros=s(otros);
  const totalIngresos=s(ingresosArr);
  const totalGastos=round2(totalCostos+totalGastosOp+totalGastosNoOp+totalImp+totalOtros);
  const utilidadBruta=round2(totalIngresos-totalCostos);
  const utilidadOperacional=round2(utilidadBruta-totalGastosOp);
  const utilidadAntes=round2(utilidadOperacional-totalGastosNoOp-totalOtros);
  const partTrab=utilidadAntes>0?round2(utilidadAntes*PCT_PART_TRAB):0;
  const baseIR=round2(utilidadAntes-partTrab);
  const irEstimado=baseIR>0?round2(baseIR*PCT_IR_SOC):0;
  const resultado=round2(totalIngresos-totalGastos);
  return {entries,ingresosArr,costos,gastosOp,gastosNoOp,impuestos,otros,totalCostos,totalGastosOp,totalGastosNoOp,
    totalImp,totalOtros,totalIngresos,totalGastos,utilidadBruta,utilidadOperacional,utilidadAntes,
    partTrab,irEstimado,resultado,totalIVA,ventasMal};
}
/* ---------- Balance General ---------- */
function computeBalanceGeneral(periodo){
  const activo=[],pasivo=[],patrimonio=[]; let tA=0,tP=0,tPat=0;
  buildLedger('',periodo).forEach(c=>{
    const debe=round2(c.movs.reduce((a,m)=>a+(+m.debe||0),0));
    const haber=round2(c.movs.reduce((a,m)=>a+(+m.haber||0),0));
    if(c.cod.startsWith('1')){ const s=round2(debe-haber); if(Math.abs(s)>=0.005){activo.push({cod:c.cod,nom:c.nom,saldo:s}); tA=round2(tA+s);} }
    else if(c.cod.startsWith('2')){ const s=round2(haber-debe); if(Math.abs(s)>=0.005){pasivo.push({cod:c.cod,nom:c.nom,saldo:s}); tP=round2(tP+s);} }
    else if(c.cod.startsWith('3')){ const s=round2(haber-debe); if(Math.abs(s)>=0.005){patrimonio.push({cod:c.cod,nom:c.nom,saldo:s}); tPat=round2(tPat+s);} }
  });
  const resultado=computeEstadoResultados(periodo).resultado;
  const totalPatrimonio=round2(tPat+resultado);
  return {activo,pasivo,patrimonio,resultado,totalActivo:tA,totalPasivo:tP,totalPatrimonio,
    Diferencia:round2(tA-(tP+totalPatrimonio))};
}

/* ---------- Resúmenes ---------- */
function getProveedoresResumen(){
  const m=new Map();
  DATA.forEach(d=>{
    const ruc=String(d['RUC EMISOR']||'').trim(); if(!ruc) return;
    if(!m.has(ruc)) m.set(ruc,{ruc,nombre:d['RAZON SOCIAL EMISOR']||'(Sin nombre)',count:0,total:0,cuentas:new Set()});
    const p=m.get(ruc); p.count++; p.total=round2(p.total+(+d.TOTAL||0)); p.cuentas.add(d._ctaNom);
  });
  return [...m.values()].sort((a,b)=>b.total-a.total);
}
function getClientesResumen(){
  const m=new Map();
  DATA_VENTAS.forEach(v=>{
    const ruc=String(v['RUC RECEPTOR']||'').trim(); if(!ruc) return;
    if(!m.has(ruc)) m.set(ruc,{ruc,nombre:v['RAZON SOCIAL RECEPTOR']||'(Sin nombre)',count:0,total:0});
    const c=m.get(ruc); c.count++; c.total=round2(c.total+(+v.TOTAL||0));
  });
  return [...m.values()].sort((a,b)=>b.total-a.total);
}

/* ---------- Refrescos globales ---------- */
function afterComprasChange(){ saveCompras(); rebuildData(); invalidateEntries(); initFilters(); rerenderActivePane(); refreshAccountingViews(); }
function afterVentasChange(){ saveVentas(); rebuildVentas(); invalidateEntries(); initFilters(); rerenderActivePane(); refreshAccountingViews(); }
function afterRetChange(){ saveRet(); rebuildRetenciones(); invalidateEntries(); initFilters(); rerenderActivePane(); refreshAccountingViews(); }
/* ---------- Descuadrados ---------- */
function getDescuadrados(){
  return allEntries().filter(e=>{
    const t=entryTotals(e), corr=!!(e.adjusted||e.bulkAdjusted);
    const dataDiff=(e.original&&!corr)?Math.abs(+e.original.DIFERENCIA||0)>=0.01:false;
    return Math.abs(t.diff)>=0.01||dataDiff;
  });
}

/* ---------- Refrescos globales ---------- */
function refreshAccountingViews(){
  invalidateEntries();
  refreshCuentaFilters();
  filterDiario();
  renderMayores(); renderBalance(); renderDescuadrados();
  renderEstadoResultados(); renderBalanceGeneral();
  if(typeof renderConciliacion==='function') renderConciliacion();
  if(typeof renderActivosFijos==='function') renderActivosFijos();
  if(typeof renderDashboard==='function') renderDashboard();
  if(typeof renderEnlaceMagico==='function') renderEnlaceMagico();
}
