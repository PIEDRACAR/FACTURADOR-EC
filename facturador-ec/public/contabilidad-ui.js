(()=>{
'use strict';
const $=id=>document.getElementById(id);
const qs=(sel,root=document)=>Array.from(root.querySelectorAll(sel));
function filtros(){
  const tab=document.querySelector('.tab.active')?.dataset.t||'diario';
  return {tab,desde:$('desde')?.value||'',hasta:$('hasta')?.value||'',busqueda:$('buscar')?.value||'',cuenta:$('cuentaMayor')?.value||'',estado:$('estadoFiltro')?.value||'',documento:$('documentoFiltro')?.value||'',origenTipo:$('origenFiltro')?.value||'',page:1,pageSize:50};
}
function exportar(formato){
  const f=filtros(),p=new URLSearchParams();for(const [k,v] of Object.entries({...f,formato}))if(v!==''&&v!=null)p.set(k,String(v));
  window.open('/contabilidad/exportar?'+p.toString(),'_blank','noopener');
}
function prepararHerramientas(){
  const permitidas=new Set(['diario','mayor','balanza','nomina']);
  for(const id of permitidas){const panel=$(id),section=panel?.querySelector('.section');if(!section||section.querySelector('.export-tools'))continue;
    const box=document.createElement('div');box.className='tools export-tools';
    for(const formato of ['excel','pdf']){const b=document.createElement('button');b.type='button';b.className='btn';b.textContent=formato==='excel'?'Excel':'PDF';b.addEventListener('click',()=>exportar(formato));box.appendChild(b);}
    if(id==='diario'){const b=document.createElement('button');b.type='button';b.className='btn';b.textContent='Importar MANUAL/AJUSTE';b.addEventListener('click',()=>alert('Importación segura: use la plantilla autorizada y el flujo Previsualizar → Confirmar.'));box.appendChild(b);}
    section.appendChild(box);
  }
}
qs('.workspace-link').forEach(b=>b.addEventListener('click',()=>{const href=b.dataset.href;if(href)location.href=href;}));
prepararHerramientas();

const repVal=id=>$(id)?.value||'';
function repParams(formato){
  const p=new URLSearchParams(),vals={desde:repVal('repDesde'),hasta:repVal('repHasta'),desdeB:repVal('repDesdeB'),hastaB:repVal('repHastaB'),centroCostoId:repVal('repCentro'),nivel:repVal('repNivel'),moneda:repVal('repMoneda')};
  for(const [k,v] of Object.entries(vals))if(v)p.set(k,v);if(formato)p.set('formato',formato);return p;
}
function celda(tr,v,clase){const td=document.createElement('td');td.textContent=v==null?'—':typeof v==='number'?v.toLocaleString('es-EC',{minimumFractionDigits:2,maximumFractionDigits:2}):String(v);if(clase)td.className=clase;tr.appendChild(td);}
function repTabla(rows){
  const head=$('repHead'),body=$('repBody');head.replaceChildren();body.replaceChildren();if(!rows.length){const tr=document.createElement('tr');celda(tr,'Sin datos para los filtros seleccionados.');body.appendChild(tr);return;}
  const keys=Object.keys(rows[0]).filter(k=>!['id','centroId','centroCostoId'].includes(k));const hr=document.createElement('tr');for(const k of keys){const th=document.createElement('th');th.textContent=k.replace(/([A-Z])/g,' $1');hr.appendChild(th);}const drill=document.createElement('th');drill.textContent='Auxiliar';hr.appendChild(drill);head.appendChild(hr);
  for(const row of rows){const tr=document.createElement('tr');for(const k of keys)celda(tr,row[k],typeof row[k]==='number'?'num':'');const td=document.createElement('td');if(row.codigo){const b=document.createElement('button');b.type='button';b.className='btn';b.textContent='Mayor';b.dataset.codigo=String(row.codigo);b.addEventListener('click',()=>{const t=document.querySelector('.tab[data-t="mayor"]');t?.dispatchEvent(new MouseEvent('click',{bubbles:true}));if($('cuentaMayor'))$('cuentaMayor').value=b.dataset.codigo||'';});td.appendChild(b);}tr.appendChild(td);body.appendChild(tr);}
}
function repKpis(d){
  const box=$('repResumen');box.replaceChildren();const candidatos=['activos','pasivos','patrimonio','resultado','ingresos','costos','gastos','efectivoInicial','operacion','inversion','financiamiento','efectivoFinal','diferencia'];
  for(const k of candidatos){if(typeof d[k]!=='number')continue;const el=document.createElement('div');el.className='kpi';const lab=document.createElement('span');lab.textContent=k.replace(/([A-Z])/g,' $1');const val=document.createElement('strong');val.textContent=Number(d[k]).toLocaleString('es-EC',{style:'currency',currency:'USD'});el.append(lab,val);box.appendChild(el);}
  const badge=$('repCuadre');badge.textContent=d.cuadra===true||d.reconcilia===true?'CUADRA':d.cuadra===false||d.reconcilia===false?'REVISAR CUADRE':'INFORMATIVO';
}
function repRows(tipo,d){
  if(tipo==='situacion-financiera'||tipo==='resultados')return d.detalle||[];
  if(tipo==='centros-costo')return d.centros||[];
  if(tipo==='flujo-efectivo')return [{rubro:'Efectivo inicial',valor:d.efectivoInicial},{rubro:'Operación',valor:d.operacion},{rubro:'Inversión',valor:d.inversion},{rubro:'Financiamiento',valor:d.financiamiento},{rubro:'Efectivo final',valor:d.efectivoFinal},{rubro:'Efectivo según balance',valor:d.efectivoBalance}];
  if(tipo==='cambios-patrimonio')return [...(d.patrimonio||[]).map(x=>({codigo:x.codigo,rubro:x.nombre,valor:x.variacion})),{codigo:'RESULTADO',rubro:'Resultado del período',valor:d.resultadoPeriodo}];
  if(tipo==='comparativo')return Object.entries(d).filter(([,v])=>v&&typeof v==='object'&&Object.prototype.hasOwnProperty.call(v,'variacion')).map(([rubro,v])=>({rubro,valorA:v.valorA,valorB:v.valorB,variacion:v.variacion,variacionPorcentual:v.variacionPorcentual}));
  return [];
}
async function consultarReporteria(){
  const tipo=repVal('repTipo'),nota=$('repNota');nota.textContent='Consultando…';
  try{const d=await api('/contabilidad/reportes/'+encodeURIComponent(tipo)+'?'+repParams().toString());repKpis(d);repTabla(repRows(tipo,d));nota.textContent=d.error||d.nota||(Array.isArray(d.noMapeados)&&d.noMapeados.length?`${d.noMapeados.length} movimiento(s) de efectivo sin mapeo; el flujo no debe darse por conciliado.`:'');}
  catch(e){nota.textContent=e.message||String(e);repTabla([]);}
}
function exportarReporteria(formato){const tipo=repVal('repTipo'),p=repParams(formato);window.open('/contabilidad/reportes/'+encodeURIComponent(tipo)+'/exportar?'+p.toString(),'_blank','noopener');}
$('repConsultar')?.addEventListener('click',consultarReporteria);$('repExcel')?.addEventListener('click',()=>exportarReporteria('excel'));$('repPdf')?.addEventListener('click',()=>exportarReporteria('pdf'));
})();