/* CONTSERTRIB · Vistas e interacción */
'use strict';

/* ============ COMPRAS ============ */
let txPage=1,txSize=15,txSort='FECHA EMISION',txDir=1,txFiltered=[],txSelected=new Set();
function renderStatsTx(){
  const t=DATA.reduce((a,d)=>a+(+d.TOTAL||0),0), b=DATA.reduce((a,d)=>a+(+d.BASENETA||0),0), i=DATA.reduce((a,d)=>a+(+d.IVA||0),0);
  const sinCla=DATA.filter(d=>d._ctaCod==='5.2.1.11').length;
  document.getElementById('stats-tx').innerHTML=`
   <div class="stat-card"><div class="stat-label">Total Compras</div><div class="stat-value red">$${fmt(t)}</div></div>
   <div class="stat-card"><div class="stat-label">Base Neta</div><div class="stat-value blue">$${fmt(b)}</div></div>
   <div class="stat-card"><div class="stat-label">IVA Crédito Tributario</div><div class="stat-value green">$${fmt(i)}</div></div>
   <div class="stat-card"><div class="stat-label">Comprobantes</div><div class="stat-value amber">${DATA.length}</div></div>
   <div class="stat-card"><div class="stat-label">Por Clasificar</div><div class="stat-value ${sinCla?'red':'green'}">${sinCla}</div></div>`;
}
function filterTx(){
  const q=(document.getElementById('tx-search').value||'').toLowerCase();
  const per=document.getElementById('tx-periodo').value, cta=document.getElementById('tx-cuenta').value, iva=document.getElementById('tx-iva').value;
  txFiltered=DATA.filter(d=>{
    if(per&&d.PERIODO!==per) return false;
    if(cta&&d.CUENTA!==cta) return false;
    if(iva==='con'&&!(+d.IVA)) return false;
    if(iva==='sin'&&(+d.IVA)) return false;
    if(q&&!`${d['RAZON SOCIAL EMISOR']} ${d.RESUMEN} ${d['NO COMPROBANTE']} ${d.CUENTA} ${d['RUC EMISOR']} ${d._ctaNom}`.toLowerCase().includes(q)) return false;
    return true;
  }).sort((a,b)=>{const x=a[txSort],y=b[txSort];return typeof x==='string'?txDir*String(x).localeCompare(String(y)):txDir*((+x||0)-(+y||0));});
  txPage=1; renderTxTable(); renderStatsTx();
}
function sortTx(c){ if(txSort===c) txDir*=-1; else {txSort=c;txDir=1;} filterTx(); }
function clearFiltersTx(){ ['tx-search','tx-periodo','tx-cuenta','tx-iva'].forEach(i=>document.getElementById(i).value=''); filterTx(); }
function renderTxTable(){
  const st=(txPage-1)*txSize, page=txFiltered.slice(st,st+txSize), b=document.getElementById('tx-body');
  b.innerHTML = page.length? page.map(d=>`<tr>
    <td data-label=""><input type="checkbox" ${txSelected.has(d._idx)?'checked':''} onchange="onTxCheck(${d._idx},this.checked)"></td>
    <td data-label="Fecha">${fmtDate(d['FECHA EMISION'])}</td>
    <td data-label="RUC" class="mono small">${esc(d['RUC EMISOR'])}</td>
    <td data-label="Proveedor" class="ellip" title="${esc(d['RAZON SOCIAL EMISOR'])}">${esc(d['RAZON SOCIAL EMISOR'])}</td>
    <td data-label="N° Factura" class="mono small">${sriLink(d.AUTORIZACION, d.TIPODOC||'01')}</td>
    <td data-label="Resumen" class="ellip small" title="${esc(d.RESUMEN)}">${esc(d.RESUMEN)}</td>
    <td data-label="Categoría"><span class="badge ${d._ctaCod==='5.2.1.11'?'badge-red':'badge-blue'}">${esc(d.CUENTA)}</span></td>
    <td data-label="Base Neta" class="num">$${fmt(d.BASENETA)}</td>
    <td data-label="IVA" class="num">${(+d.IVA)?'$'+fmt(d.IVA):'<span class="text-muted">0%</span>'}</td>
    <td data-label="Total" class="num"><strong>$${fmt(d.TOTAL)}</strong></td>
    <td data-label="Cuenta"><span class="cuenta-code">${esc(d._ctaCod)}</span><br><span class="text-muted small">${esc(d._ctaNom)}</span>${TX_OVERRIDES[d._idx]?' <span class="badge badge-blue">Manual</span>':''}</td>
    <td data-label="Acción"><button class="btn btn-ghost btn-sm" onclick="openTxModal(${d._idx})">✏️</button></td></tr>`).join('')
    : '<tr><td colspan="12" class="empty">Sin resultados. Importa comprobantes del SRI para comenzar.</td></tr>';
  renderPag('tx',txFiltered.length,txPage,txSize,'txGoPage');
  updateTxSelCount();
  const all=document.getElementById('tx-check-all');
  if(all) all.checked = page.length>0 && page.every(d=>txSelected.has(d._idx));
}
function txGoPage(p){ txPage=p; renderTxTable(); }
function onTxCheck(i,c){ c?txSelected.add(i):txSelected.delete(i); updateTxSelCount(); }
function toggleAllTx(cb){ const st=(txPage-1)*txSize; txFiltered.slice(st,st+txSize).forEach(d=>cb.checked?txSelected.add(d._idx):txSelected.delete(d._idx)); renderTxTable(); }
function selectAllFilteredTx(){ txFiltered.forEach(d=>txSelected.add(d._idx)); renderTxTable(); showToast(`${txFiltered.length} seleccionada(s)`); }
function clearTxSelection(){ txSelected.clear(); renderTxTable(); }
function updateTxSelCount(){
  document.getElementById('tx-sel-count').textContent=`${txSelected.size} seleccionada(s)`;
  document.getElementById('tx-filtered-count').textContent=txFiltered.length;
}
function applyTxCuentaMasivo(){
  if(!txSelected.size) return showToast('Selecciona al menos una transacción','err');
  const v=document.getElementById('tx-masivo-select').value;
  if(!v) return showToast('Selecciona la cuenta contable','err');
  const [cod,nom]=v.split('|'); const n=txSelected.size;
  txSelected.forEach(i=>TX_OVERRIDES[i]={cod,nom});
  persistTxOverrides(); txSelected.clear(); rebuildData(); filterTx(); refreshAccountingViews();
  showToast(`${n} transacción(es) reclasificadas a "${nom}"`);
}
function clearTxOverrideMasivo(){
  if(!txSelected.size) return showToast('Selecciona al menos una transacción','err');
  const n=txSelected.size;
  txSelected.forEach(i=>delete TX_OVERRIDES[i]);
  persistTxOverrides(); txSelected.clear(); rebuildData(); filterTx(); refreshAccountingViews();
  showToast(`Clasificación automática restaurada en ${n} registro(s)`);
}
let txModalIdx=-1;
function openTxModal(i){
  txModalIdx=i; const d=DATA[i];
  document.getElementById('modal-tx-info').innerHTML=`<strong>${esc(d['RAZON SOCIAL EMISOR'])}</strong><br>
    <span class="text-muted">Fac: ${esc(d['NO COMPROBANTE'])} · ${fmtDate(d['FECHA EMISION'])} · Total $${fmt(d.TOTAL)}</span><br>
    <span class="text-muted small">${esc(d.RESUMEN)}</span>`;
  const s=document.getElementById('modal-cuenta-select');
  s.innerHTML=accountOptions(d._ctaCod); s.value=d._ctaCod+'|'+d._ctaNom;
  openModal('modal-cuenta');
}
function saveCuentaTx(){
  const [cod,nom]=document.getElementById('modal-cuenta-select').value.split('|');
  TX_OVERRIDES[txModalIdx]={cod,nom}; persistTxOverrides();
  rebuildData(); closeModal('modal-cuenta'); filterTx(); refreshAccountingViews();
  showToast('Cuenta contable actualizada');
}
function renderPag(ns,total,page,size,fn){
  const c=document.getElementById(ns+'-pagination'); if(!c) return;
  const pages=Math.ceil(total/size);
  if(pages<=1){ c.innerHTML=`<span class="page-info">${total} registro(s)</span>`; return; }
  let h=`<span class="page-info">${total} registros</span><button class="page-btn" onclick="${fn}(${Math.max(1,page-1)})">‹</button>`;
  for(let i=1;i<=pages;i++){
    if(i===1||i===pages||Math.abs(i-page)<=1) h+=`<button class="page-btn ${i===page?'active':''}" onclick="${fn}(${i})">${i}</button>`;
    else if(Math.abs(i-page)===2) h+='<span class="page-info">…</span>';
  }
  c.innerHTML=h+`<button class="page-btn" onclick="${fn}(${Math.min(pages,page+1)})">›</button>`;
}

/* ============ PROVEEDORES ============ */
function renderProveedores(){
  const q=(document.getElementById('prov-search').value||'').toLowerCase(), est=document.getElementById('prov-estado').value;
  const all=getProveedoresResumen();
  let rows=all;
  if(q) rows=rows.filter(p=>`${p.ruc} ${p.nombre}`.toLowerCase().includes(q));
  if(est==='regla') rows=rows.filter(p=>PROVEEDOR_RULES[p.ruc]);
  if(est==='sinregla') rows=rows.filter(p=>!PROVEEDOR_RULES[p.ruc]);
  if(est==='mixto') rows=rows.filter(p=>p.cuentas.size>1);
  const con=all.filter(p=>PROVEEDOR_RULES[p.ruc]).length;
  document.getElementById('stats-prov').innerHTML=`
   <div class="stat-card"><div class="stat-label">Proveedores</div><div class="stat-value blue">${all.length}</div></div>
   <div class="stat-card"><div class="stat-label">Con regla</div><div class="stat-value green">${con}</div></div>
   <div class="stat-card"><div class="stat-label">Sin regla</div><div class="stat-value amber">${all.length-con}</div></div>`;
  const ms=document.getElementById('prov-masivo-select');
  if(!ms.dataset.filled){ ms.innerHTML='<option value="">Selecciona cuenta…</option>'+accountOptions(); ms.dataset.filled='1'; }
  document.getElementById('prov-body').innerHTML = rows.length? rows.map(p=>{
    const r=PROVEEDOR_RULES[p.ruc], sel=r?r.cod:(p.cuentas.size===1?[...p.cuentas][0]&&(DATA.find(d=>d['RUC EMISOR']==p.ruc)||{})._ctaCod:'');
    return `<tr>
      <td data-label=""><input type="checkbox" class="prov-check" value="${esc(p.ruc)}" onchange="updateProvSel()"></td>
      <td data-label="RUC" class="mono small">${esc(p.ruc)}</td>
      <td data-label="Proveedor">${esc(p.nombre)}${r?' <span class="badge badge-green">Regla</span>':''}${!r&&p.cuentas.size>1?' <span class="badge badge-amber">Mixto</span>':''}</td>
      <td data-label="# Fact." class="num">${p.count}</td>
      <td data-label="Total" class="num">$${fmt(p.total)}</td>
      <td data-label="Cuenta"><select id="ps-${slug(p.ruc)}">${accountOptions(sel)}</select></td>
      <td data-label="Acción"><button class="btn btn-primary btn-sm" onclick="applyProveedorRule('${esc(p.ruc)}')">Aplicar</button>
      ${r?`<button class="btn btn-ghost btn-sm" onclick="clearProveedorRule('${esc(p.ruc)}')">Quitar</button>`:''}</td></tr>`;
  }).join('') : '<tr><td colspan="7" class="empty">No hay proveedores.</td></tr>';
  updateProvSel();
}
const selProvRucs=()=>[...document.querySelectorAll('.prov-check:checked')].map(c=>c.value);
function updateProvSel(){ document.getElementById('prov-sel-count').textContent=`${selProvRucs().length} seleccionado(s)`; }
function toggleAllProveedores(cb){ document.querySelectorAll('.prov-check').forEach(c=>c.checked=cb.checked); updateProvSel(); }
function applyProveedorRule(ruc){
  const v=document.getElementById('ps-'+slug(ruc)).value; if(!v) return;
  const [cod,nom]=v.split('|'); PROVEEDOR_RULES[ruc]={cod,nom};
  persistProveedorRules(); rebuildData(); renderProveedores(); filterTx(); refreshAccountingViews();
  showToast('Facturas del proveedor reclasificadas');
}
function clearProveedorRule(ruc){
  delete PROVEEDOR_RULES[ruc]; persistProveedorRules(); rebuildData(); renderProveedores(); filterTx(); refreshAccountingViews();
  showToast('Regla eliminada');
}
function applyProveedorRuleMasivo(){
  const r=selProvRucs(); if(!r.length) return showToast('Selecciona proveedores','err');
  const v=document.getElementById('prov-masivo-select').value; if(!v) return showToast('Selecciona la cuenta','err');
  const [cod,nom]=v.split('|'); r.forEach(x=>PROVEEDOR_RULES[x]={cod,nom});
  persistProveedorRules(); rebuildData(); renderProveedores(); filterTx(); refreshAccountingViews();
  showToast(`Cuenta "${nom}" aplicada a ${r.length} proveedor(es)`);
}
function clearProveedorRuleMasivo(){
  const r=selProvRucs(); if(!r.length) return showToast('Selecciona proveedores','err');
  r.forEach(x=>delete PROVEEDOR_RULES[x]);
  persistProveedorRules(); rebuildData(); renderProveedores(); filterTx(); refreshAccountingViews();
  showToast(`Regla quitada a ${r.length} proveedor(es)`);
}

/* ============ VENTAS ============ */
let vtPage=1,vtSize=15,vtFiltered=[];
function filterVentas(){
  const q=(document.getElementById('vt-search').value||'').toLowerCase(), per=document.getElementById('vt-periodo').value;
  vtFiltered=DATA_VENTAS.filter(v=>{
    if(per&&v.PERIODO!==per) return false;
    if(q&&!`${v['RAZON SOCIAL RECEPTOR']} ${v['NO DOCUMENTO']} ${v['RUC RECEPTOR']}`.toLowerCase().includes(q)) return false;
    return true;
  }).sort((a,b)=>String(a['FECHA EMISION']).localeCompare(String(b['FECHA EMISION'])));
  vtPage=1; renderVentasTable();
}
function clearFiltersVentas(){ document.getElementById('vt-search').value=''; document.getElementById('vt-periodo').value=''; filterVentas(); }
function renderVentasTable(){
  const st=(vtPage-1)*vtSize, page=vtFiltered.slice(st,st+vtSize);
  document.getElementById('vt-body').innerHTML = page.length? page.map(v=>`<tr>
    <td data-label="Fecha">${fmtDate(v['FECHA EMISION'])}</td>
    <td data-label="Cliente" class="ellip" title="${esc(v['RAZON SOCIAL RECEPTOR'])}">${esc(v['RAZON SOCIAL RECEPTOR'])}</td>
    <td data-label="N° Doc" class="mono small">${sriLink(v.AUTORIZACION, v['TIPO COMPROBANTE']||'01')}</td>
    <td data-label="Base Neta" class="num">$${fmt(v.BASENETA)}</td>
    <td data-label="IVA" class="num">${(+v.IVA)?'$'+fmt(v.IVA):'<span class="text-muted">0%</span>'}</td>
    <td data-label="Total" class="num"><strong>$${fmt(v.TOTAL)}</strong></td></tr>`).join('')
    : '<tr><td colspan="6" class="empty">Sin ventas registradas.</td></tr>';
  renderPag('vt',vtFiltered.length,vtPage,vtSize,'vtGoPage');
}
function vtGoPage(p){ vtPage=p; renderVentasTable(); }
function renderVentas(){
  const t=DATA_VENTAS.reduce((a,v)=>a+(+v.TOTAL||0),0), b=DATA_VENTAS.reduce((a,v)=>a+(+v.BASENETA||0),0), i=DATA_VENTAS.reduce((a,v)=>a+(+v.IVA||0),0);
  document.getElementById('stats-ventas').innerHTML=`
   <div class="stat-card"><div class="stat-label">Total Ventas</div><div class="stat-value green">$${fmt(t)}</div></div>
   <div class="stat-card"><div class="stat-label">Base Neta (Ingreso)</div><div class="stat-value blue">$${fmt(b)}</div></div>
   <div class="stat-card"><div class="stat-label">IVA por Pagar</div><div class="stat-value amber">$${fmt(i)}</div></div>
   <div class="stat-card"><div class="stat-label">Facturas</div><div class="stat-value blue">${DATA_VENTAS.length}</div></div>`;
  filterVentas();
}

/* ============ CLIENTES ============ */
function renderClientes(){
  const q=(document.getElementById('cli-search').value||'').toLowerCase(), est=document.getElementById('cli-estado').value;
  const all=getClientesResumen(); let rows=all;
  if(q) rows=rows.filter(c=>`${c.ruc} ${c.nombre}`.toLowerCase().includes(q));
  if(est==='regla') rows=rows.filter(c=>CLIENTE_RULES[c.ruc]);
  if(est==='sinregla') rows=rows.filter(c=>!CLIENTE_RULES[c.ruc]);
  const con=all.filter(c=>CLIENTE_RULES[c.ruc]).length;
  document.getElementById('stats-cli').innerHTML=`
   <div class="stat-card"><div class="stat-label">Clientes</div><div class="stat-value blue">${all.length}</div></div>
   <div class="stat-card"><div class="stat-label">Con regla</div><div class="stat-value green">${con}</div></div>
   <div class="stat-card"><div class="stat-label">Sin regla</div><div class="stat-value amber">${all.length-con}</div></div>`;
  const ms=document.getElementById('cli-masivo-select');
  if(!ms.dataset.filled){ ms.innerHTML='<option value="">Selecciona cuenta de ingreso…</option>'+accountOptionsPrefix('4.'); ms.dataset.filled='1'; }
  document.getElementById('cli-body').innerHTML = rows.length? rows.map(c=>{
    const r=CLIENTE_RULES[c.ruc], sel=r?r.cod:CONFIG.ctaIngreso;
    return `<tr>
      <td data-label=""><input type="checkbox" class="cli-check" value="${esc(c.ruc)}" onchange="updateCliSel()"></td>
      <td data-label="RUC" class="mono small">${esc(c.ruc)}</td>
      <td data-label="Cliente">${esc(c.nombre)}${r?' <span class="badge badge-green">Regla</span>':''}</td>
      <td data-label="# Fact." class="num">${c.count}</td>
      <td data-label="Total" class="num">$${fmt(c.total)}</td>
      <td data-label="Cuenta"><select id="cs-${slug(c.ruc)}">${accountOptionsPrefix('4.',sel)}</select></td>
      <td data-label="Acción"><button class="btn btn-primary btn-sm" onclick="applyClienteRule('${esc(c.ruc)}')">Aplicar</button>
      ${r?`<button class="btn btn-ghost btn-sm" onclick="clearClienteRule('${esc(c.ruc)}')">Quitar</button>`:''}</td></tr>`;
  }).join('') : '<tr><td colspan="7" class="empty">No hay clientes.</td></tr>';
  updateCliSel();
}
const selCliRucs=()=>[...document.querySelectorAll('.cli-check:checked')].map(c=>c.value);
function updateCliSel(){ document.getElementById('cli-sel-count').textContent=`${selCliRucs().length} seleccionado(s)`; }
function toggleAllClientes(cb){ document.querySelectorAll('.cli-check').forEach(c=>c.checked=cb.checked); updateCliSel(); }
function afterCliRule(){ persistClienteRules(); rebuildVentas(); renderClientes(); renderVentas(); refreshAccountingViews(); }
function applyClienteRule(ruc){ const v=document.getElementById('cs-'+slug(ruc)).value; if(!v)return; const [cod,nom]=v.split('|'); CLIENTE_RULES[ruc]={cod,nom}; afterCliRule(); showToast('Ventas del cliente reclasificadas'); }
function clearClienteRule(ruc){ delete CLIENTE_RULES[ruc]; afterCliRule(); showToast('Regla eliminada'); }
function applyClienteRuleMasivo(){
  const r=selCliRucs(); if(!r.length) return showToast('Selecciona clientes','err');
  const v=document.getElementById('cli-masivo-select').value; if(!v) return showToast('Selecciona la cuenta','err');
  const [cod,nom]=v.split('|'); r.forEach(x=>CLIENTE_RULES[x]={cod,nom}); afterCliRule();
  showToast(`Cuenta aplicada a ${r.length} cliente(s)`);
}
function clearClienteRuleMasivo(){ const r=selCliRucs(); if(!r.length) return showToast('Selecciona clientes','err'); r.forEach(x=>delete CLIENTE_RULES[x]); afterCliRule(); showToast('Reglas quitadas'); }

/* ============ RETENCIONES ============ */
let retPage=1,retSize=15,retFiltered=[];
function filterRetenciones(){
  const q=(document.getElementById('ret-search').value||'').toLowerCase(), per=document.getElementById('ret-periodo').value;
  retFiltered=DATA_RETENCIONES.filter(r=>{
    if(per&&r.PERIODO!==per) return false;
    if(q&&!`${r['AGENTE RETENCION']} ${r['DOCUMENTO SUSTENTO']} ${r['NO COMPROBANTE']}`.toLowerCase().includes(q)) return false;
    return true;
  }).sort((a,b)=>String(a['FECHA EMISION']).localeCompare(String(b['FECHA EMISION'])));
  retPage=1; renderRetTable();
}
function clearFiltersRetenciones(){ document.getElementById('ret-search').value=''; document.getElementById('ret-periodo').value=''; filterRetenciones(); }
function renderRetTable(){
  const st=(retPage-1)*retSize, page=retFiltered.slice(st,st+retSize);
  document.getElementById('ret-body').innerHTML = page.length? page.map(r=>`<tr>
    <td data-label="Fecha">${fmtDate(r['FECHA EMISION'])}</td>
    <td data-label="Agente" class="ellip" title="${esc(r['AGENTE RETENCION'])}">${esc(r['AGENTE RETENCION'])}</td>
    <td data-label="Sustento" class="mono small">${sriLink(r.AUTORIZACION, '07')}</td>
    <td data-label="Ret. Renta" class="num">$${fmt(r['VALOR RET RENTA'])}</td>
    <td data-label="Ret. IVA" class="num">$${fmt(r['VALOR RET IVA'])}</td>
    <td data-label="Total" class="num"><strong>$${fmt(round2((+r['VALOR RET RENTA']||0)+(+r['VALOR RET IVA']||0)))}</strong></td></tr>`).join('')
    : '<tr><td colspan="6" class="empty">Sin retenciones registradas.</td></tr>';
  renderPag('ret',retFiltered.length,retPage,retSize,'retGoPage');
}
function retGoPage(p){ retPage=p; renderRetTable(); }
function renderRetenciones(){
  const ir=DATA_RETENCIONES.reduce((a,r)=>a+(+r['VALOR RET RENTA']||0),0);
  const iv=DATA_RETENCIONES.reduce((a,r)=>a+(+r['VALOR RET IVA']||0),0);
  document.getElementById('stats-retenciones').innerHTML=`
   <div class="stat-card"><div class="stat-label">Ret. Renta</div><div class="stat-value blue">$${fmt(ir)}</div></div>
   <div class="stat-card"><div class="stat-label">Ret. IVA</div><div class="stat-value blue">$${fmt(iv)}</div></div>
   <div class="stat-card"><div class="stat-label">Total Retenido</div><div class="stat-value amber">$${fmt(round2(ir+iv))}</div></div>
   <div class="stat-card"><div class="stat-label">Comprobantes</div><div class="stat-value blue">${DATA_RETENCIONES.length}</div></div>`;
  filterRetenciones();
}

/* ============ PLAN DE CUENTAS ============ */
function renderPlanCuentas(){
  const q=(document.getElementById('pc-search').value||'').toLowerCase(), niv=document.getElementById('pc-nivel').value;
  const rows=PLAN_CUENTAS.filter(p=>(!niv||p.niv===+niv)&&(!q||`${p.cod} ${p.nom}`.toLowerCase().includes(q)));
  document.getElementById('plan-cuentas-container').innerHTML = rows.length? rows.map(p=>`
    <div class="pc-row pc-${p.niv}">
      <span><span class="cuenta-code">${esc(p.cod)}</span> &nbsp; ${esc(p.nom)}${p.custom?' <span class="badge badge-blue">Personalizada</span>':''}</span>
      <button class="btn btn-ghost btn-sm" onclick="editCuentaContable('${esc(p.cod)}')">✏️</button>
    </div>`).join('') : '<div class="empty">Sin cuentas para el filtro.</div>';
}
function addCuentaContable(){
  const cod=(document.getElementById('pc-new-cod').value||'').trim(), nom=(document.getElementById('pc-new-nom').value||'').trim();
  const niv=+document.getElementById('pc-new-niv').value;
  if(!cod||!nom) return showToast('Ingresa código y nombre','err');
  if(!/^\d+(\.\d+)*$/.test(cod)) return showToast('Formato de código inválido (ej.: 5.2.1.19)','err');
  if(PLAN_CUENTAS.some(c=>c.cod===cod)) return showToast('Ya existe una cuenta con ese código','err');
  const c={cod,nom,niv,custom:true};
  PLAN_CUENTAS.push(c); PLAN_CUENTAS.sort((a,b)=>a.cod.localeCompare(b.cod));
  CUSTOM_ACCOUNTS.push(c); persistCustomAccounts();
  document.getElementById('pc-new-cod').value=''; document.getElementById('pc-new-nom').value='';
  refreshAccountSelects(); renderPlanCuentas(); showToast('Cuenta agregada');
}
function editCuentaContable(cod){
  const c=PLAN_CUENTAS.find(x=>x.cod===cod); if(!c) return;
  document.getElementById('ec-cod-original').value=c.cod;
  const ci=document.getElementById('ec-cod'); ci.value=c.cod; ci.disabled=!c.custom;
  document.getElementById('ec-nom').value=c.nom;
  const ns=document.getElementById('ec-niv'); ns.value=String(c.niv); ns.disabled=!c.custom;
  document.getElementById('ec-hint').textContent = c.custom?'Cuenta personalizada: puedes editar todo o eliminarla si no está en uso.':'Cuenta base del sistema: por integridad contable solo puedes renombrarla.';
  document.getElementById('ec-delete-btn').style.display=c.custom?'inline-block':'none';
  openModal('modal-editar-cuenta');
}
function saveEditCuenta(){
  const old=document.getElementById('ec-cod-original').value, c=PLAN_CUENTAS.find(x=>x.cod===old); if(!c) return;
  const nom=(document.getElementById('ec-nom').value||'').trim();
  if(!nom) return showToast('El nombre no puede estar vacío','err');
  let cod=old, niv=c.niv;
  if(c.custom){
    cod=(document.getElementById('ec-cod').value||'').trim(); niv=+document.getElementById('ec-niv').value;
    if(!/^\d+(\.\d+)*$/.test(cod)) return showToast('Formato de código inválido','err');
    if(cod!==old&&PLAN_CUENTAS.some(x=>x.cod===cod)) return showToast('Ya existe ese código','err');
  }
  c.cod=cod; c.nom=nom; c.niv=niv; PLAN_CUENTAS.sort((a,b)=>a.cod.localeCompare(b.cod));
  if(c.custom){ const i=CUSTOM_ACCOUNTS.findIndex(x=>x.cod===old); if(i>=0) CUSTOM_ACCOUNTS[i]={cod,nom,niv,custom:true}; persistCustomAccounts(); }
  else { delete ACCOUNT_OVERRIDES[old]; ACCOUNT_OVERRIDES[cod]=nom; persistAccountOverrides(); }
  let refs=0;
  Object.keys(CUENTA_MAP).forEach(k=>{ if(CUENTA_MAP[k].cod===old){CUENTA_MAP[k]={cod,nom};CUENTA_MAP_OVERRIDES[k]={cod,nom};refs++;} });
  persistCuentaMapOverrides();
  [[PROVEEDOR_RULES,persistProveedorRules],[CLIENTE_RULES,persistClienteRules],[TX_OVERRIDES,persistTxOverrides]].forEach(([o,p])=>{
    Object.keys(o).forEach(k=>{ if(o[k].cod===old){o[k]={cod,nom};refs++;} }); p();
  });
  MANUAL_ASIENTOS.forEach(a=>(a.lines||[]).forEach(l=>{ if(l.cta===old){l.cta=cod;l.nom=nom;refs++;} })); persistManuales();
  Object.values(ENTRY_ADJ).forEach(a=>(a.lines||[]).forEach(l=>{ if(l.cta===old){l.cta=cod;l.nom=nom;} })); persistEntryAdj();
  Object.values(AUTO_ADJ).forEach(a=>(a.lines||[]).forEach(l=>{ if(l.cta===old){l.cta=cod;l.nom=nom;} })); persistAutoAdj();
  rebuildAll(); refreshAccountSelects(); renderPlanCuentas(); refreshAccountingViews(); closeModal('modal-editar-cuenta');
  showToast(`Cuenta actualizada${refs?` y sincronizada en ${refs} referencia(s)`:''}`);
}
function deleteCuentaContable(){
  const cod=document.getElementById('ec-cod-original').value, c=PLAN_CUENTAS.find(x=>x.cod===cod);
  if(!c||!c.custom) return showToast('Solo se eliminan cuentas personalizadas','err');
  const enUso = DATA.some(d=>d._ctaCod===cod)||DATA_VENTAS.some(v=>v._ctaCod===cod)||
    MANUAL_ASIENTOS.some(a=>(a.lines||[]).some(l=>l.cta===cod))||
    [PROVEEDOR_RULES,CLIENTE_RULES,TX_OVERRIDES].some(o=>Object.values(o).some(r=>r.cod===cod));
  if(enUso) return showToast('La cuenta está en uso. Reclasifica antes de eliminarla.','err');
  if(!confirm(`¿Eliminar ${c.cod} – ${c.nom}?`)) return;
  PLAN_CUENTAS.splice(PLAN_CUENTAS.indexOf(c),1);
  CUSTOM_ACCOUNTS=CUSTOM_ACCOUNTS.filter(x=>x.cod!==cod); persistCustomAccounts();
  refreshAccountSelects(); renderPlanCuentas(); closeModal('modal-editar-cuenta'); showToast('Cuenta eliminada');
}
function refreshAccountSelects(){
  const html=accountOptions();
  document.querySelectorAll('.ml-cuenta').forEach(s=>{const v=s.value;s.innerHTML=html;if([...s.options].some(o=>o.value===v))s.value=v;});
  ['tx-masivo-select','prov-masivo-select'].forEach(id=>{const s=document.getElementById(id);if(s){s.innerHTML='<option value="">Selecciona cuenta…</option>'+html;s.dataset.filled='1';}});
  const cs=document.getElementById('cli-masivo-select');
  if(cs){ cs.innerHTML='<option value="">Selecciona cuenta de ingreso…</option>'+accountOptionsPrefix('4.'); cs.dataset.filled='1'; }
}

/* ============ LIBRO DIARIO ============ */
let diarPage=1,diarSize=8,diarFiltered=[],DIAR_SELECTED=new Set();
function filterDiario(){
  const qEl=document.getElementById('diar-search'); if(!qEl) return;
  const q=(qEl.value||'').toLowerCase(), per=document.getElementById('diar-periodo').value, cta=document.getElementById('diar-cuenta').value;
  diarFiltered=allEntries().filter(e=>{
    if(per&&e.periodo!==per) return false;
    if(cta&&!e.lines.some(l=>l.cta===cta.split('|')[0])) return false;
    if(q&&!`${e.concepto} ${e.resumen} ${e.glosa||''} ${e.ref} ${e.id} ${e.lines.map(l=>l.cta+' '+l.nom).join(' ')}`.toLowerCase().includes(q)) return false;
    return true;
  }).sort((a,b)=>String(a.fecha||'').localeCompare(String(b.fecha||'')));
  const td=round2(diarFiltered.reduce((a,e)=>a+entryTotals(e).debe,0));
  const th=round2(diarFiltered.reduce((a,e)=>a+entryTotals(e).haber,0));
  document.getElementById('diario-totales').innerHTML=`<div class="stats">
    <div class="stat-card"><div class="stat-label">Asientos</div><div class="stat-value blue">${diarFiltered.length}</div></div>
    <div class="stat-card"><div class="stat-label">Total DEBE</div><div class="stat-value red">$${fmt(td)}</div></div>
    <div class="stat-card"><div class="stat-label">Total HABER</div><div class="stat-value green">$${fmt(th)}</div></div>
    <div class="stat-card"><div class="stat-label">Control</div><div class="stat-value ${Math.abs(td-th)<0.02?'green':'red'}">${Math.abs(td-th)<0.02?'✓':'$'+fmt(Math.abs(td-th))}</div></div></div>`;
  const st=(diarPage-1)*diarSize, page=diarFiltered.slice(st,st+diarSize);
  document.getElementById('diario-container').innerHTML = page.length? page.map(e=>renderEntryCard(e,{selectable:true})).join('') : '<div class="empty">Sin asientos para el filtro.</div>';
  renderPag('diar',diarFiltered.length,diarPage,diarSize,'diarGoPage');
  updateDiarBulk();
}
function diarGoPage(p){ diarPage=p; filterDiario(); }
function clearFiltersDiario(){ ['diar-search','diar-periodo','diar-cuenta'].forEach(i=>document.getElementById(i).value=''); filterDiario(); }
function renderEntryCard(e,opts={}){
  const t=entryTotals(e);
  const chk=opts.selectable?`<label class="chk"><input type="checkbox" ${DIAR_SELECTED.has(e.id)?'checked':''} onchange="toggleDiarSelect('${esc(e.id)}',this.checked)"></label>`:'';
  const adj=e.adjusted?`<div class="diagnostico">🔧 <strong>Ajustado manualmente</strong>${e.adjustment.userNote?': '+esc(e.adjustment.userNote):''}<div class="small">${esc(e.adjustment.autoNote||'')}</div></div>`:'';
  const bulk=e.bulkAdjusted?`<div class="diagnostico">🧮 <strong>Editado en lote</strong>${e.bulkNote?': '+esc(e.bulkNote):''}</div>`:'';
  const tipo=e.source==='manual'?'✍️ Manual':e.source==='auto-venta'?'💰 Venta':e.source==='auto-ret'?'🧮 Retención':(e.adjusted?'⚙️ Compra (ajustado)':'⚙️ Compra');
  return `<div class="asiento-card">
    <div class="asiento-header">${chk}<div class="asiento-num">${esc(e.id)}</div>
      <div class="asiento-meta"><div class="asiento-proveedor">${esc(e.concepto)}</div>
        <div class="asiento-detail"><span>📅 ${fmtDate(e.fecha)}</span><span>📌 ${esc(e.periodo)}</span><span>🔖 <a class="ref-link" onclick="previewVoucher('${esc(e.ref)}')">${esc(e.ref)}</a></span><span>${tipo}</span></div></div>
      <button class="btn btn-ghost btn-sm" onclick="editEntry('${esc(e.id)}')">✏️ Editar</button></div>
    <div class="table-wrap" style="max-height:none;border:none;border-radius:0"><table><thead><tr><th>Código</th><th>Cuenta</th><th class="num">DEBE</th><th class="num">HABER</th></tr></thead>
      <tbody>${e.lines.map(l=>`<tr><td data-label="Código" class="cuenta-code">${esc(l.cta)}</td><td data-label="Cuenta">${esc(l.nom)}</td>
      <td data-label="Debe" class="num debe">${l.debe?'$'+fmt(l.debe):''}</td><td data-label="Haber" class="num haber">${l.haber?'$'+fmt(l.haber):''}</td></tr>`).join('')}</tbody></table></div>
    <div class="asiento-total"><span>DEBE: <strong class="debe">$${fmt(t.debe)}</strong></span><span>HABER: <strong class="haber">$${fmt(t.haber)}</strong></span>
      <span class="${Math.abs(t.diff)<0.01?'haber':'debe'}">${Math.abs(t.diff)<0.01?'✓ Cuadra':'⚠ Diferencia $'+fmt(Math.abs(t.diff))}</span></div>
    ${e.glosa?`<div class="asiento-glosa"><strong>Glosa:</strong> ${esc(e.glosa)}</div>`:''}${adj}${bulk}</div>`;
}
function toggleDiarSelect(id,c){ c?DIAR_SELECTED.add(id):DIAR_SELECTED.delete(id); updateDiarBulk(); }
function toggleDiarSelectAllFiltered(c){ diarFiltered.forEach(e=>c?DIAR_SELECTED.add(e.id):DIAR_SELECTED.delete(e.id)); filterDiario(); }
function clearDiarSelection(){ DIAR_SELECTED.clear(); filterDiario(); }
function updateDiarBulk(){
  document.getElementById('diar-bulk-count').textContent=DIAR_SELECTED.size;
  document.getElementById('diar-bulk-btn').disabled=!DIAR_SELECTED.size;
  const sa=document.getElementById('diar-select-all');
  sa.checked=diarFiltered.length>0&&diarFiltered.every(e=>DIAR_SELECTED.has(e.id));
}
function openBulkDiarioModal(){
  if(!DIAR_SELECTED.size) return showToast('Selecciona asientos','err');
  const sel=allEntries().filter(e=>DIAR_SELECTED.has(e.id));
  document.getElementById('bulk-diar-info').innerHTML=`Se aplicarán los cambios a <strong>${sel.length}</strong> asiento(s).`;
  const m=new Map(); sel.forEach(e=>e.lines.forEach(l=>m.set(l.cta,{cod:l.cta,nom:l.nom})));
  document.getElementById('bulk-diar-cta-actual').innerHTML='<option value="">Cuenta a reclasificar…</option>'+
    [...m.values()].sort((a,b)=>a.cod.localeCompare(b.cod)).map(c=>`<option value="${esc(c.cod)}|${esc(c.nom)}">${esc(c.cod)} – ${esc(c.nom)}</option>`).join('');
  document.getElementById('bulk-diar-cta-nueva').innerHTML='<option value="">Nueva cuenta…</option>'+accountOptions();
  document.getElementById('bulk-diar-glosa').value='';
  openModal('modal-bulk-diario');
}
function bulkApplyGlosa(){
  const txt=(document.getElementById('bulk-diar-glosa').value||'').trim();
  if(!txt) return showToast('Escribe la glosa','err');
  const ids=[...DIAR_SELECTED], mans=manualEntries();
  ids.forEach(id=>{
    if(id.startsWith('MAN-')){ const e=mans.find(x=>x.id===id); const i=MANUAL_ASIENTOS.findIndex(a=>a.id===e?.dbId); if(i>=0) MANUAL_ASIENTOS[i].concepto=txt; }
    else ENTRY_ADJ[id]={...(ENTRY_ADJ[id]||{}),glosaOverride:txt,note:'Glosa actualizada en lote',updatedAt:new Date().toISOString()};
  });
  persistManuales(); persistEntryAdj(); closeModal('modal-bulk-diario'); renderManuales(); refreshAccountingViews();
  showToast(`Glosa actualizada en ${ids.length} asiento(s)`);
}
function bulkApplyReclasificacion(){
  const o=document.getElementById('bulk-diar-cta-actual').value, n=document.getElementById('bulk-diar-cta-nueva').value;
  if(!o||!n) return showToast('Selecciona ambas cuentas','err');
  const [oc]=o.split('|'), [nc,nn]=n.split('|');
  if(oc===nc) return showToast('Las cuentas deben ser distintas','err');
  let ch=0; const all=allEntries();
  [...DIAR_SELECTED].forEach(id=>{
    const e=all.find(x=>x.id===id); if(!e) return;
    const nl=e.lines.map(l=>l.cta===oc?{...l,cta:nc,nom:nn}:l);
    if(JSON.stringify(nl)===JSON.stringify(e.lines)) return;
    if(e.source==='manual'){ const i=MANUAL_ASIENTOS.findIndex(a=>a.id===e.dbId); if(i>=0){MANUAL_ASIENTOS[i].lines=nl;ch++;} }
    else { ENTRY_ADJ[id]={...(ENTRY_ADJ[id]||{}),lines:nl,note:`Reclasificación en lote: ${oc} → ${nc}`,updatedAt:new Date().toISOString()}; ch++; }
  });
  if(ch){ persistManuales(); persistEntryAdj(); }
  closeModal('modal-bulk-diario'); renderManuales(); refreshAccountingViews();
  showToast(ch?`Reclasificación aplicada en ${ch} asiento(s)`:'Ningún asiento tenía esa cuenta');
}

/* ============ ASIENTOS MANUALES ============ */
let manualLineCount=0, manualEditId=null;
function addManualLine(l={}){
  const c=document.getElementById('manual-lines'); if(!c) return;
  const id='ml-'+(++manualLineCount);
  const d=document.createElement('div'); d.className='line-editor'; d.dataset.line=id;
  d.innerHTML=`<select class="ml-cuenta" onchange="updateManualTotals()">${accountOptions(l.cta||'')}</select>
    <input class="ml-debe num" type="number" step="0.01" min="0" placeholder="Debe" value="${l.debe||''}" oninput="updateManualTotals()">
    <input class="ml-haber num" type="number" step="0.01" min="0" placeholder="Haber" value="${l.haber||''}" oninput="updateManualTotals()">
    <button class="btn btn-ghost btn-sm" onclick="this.parentNode.remove();updateManualTotals()">✕</button>`;
  c.appendChild(d); updateManualTotals();
}
function collectManualLines(){
  return [...document.querySelectorAll('#manual-lines .line-editor')].map(r=>{
    const [cta,nom]=r.querySelector('.ml-cuenta').value.split('|');
    return {cta,nom,debe:round2(r.querySelector('.ml-debe').value),haber:round2(r.querySelector('.ml-haber').value)};
  }).filter(l=>l.cta&&(l.debe>0||l.haber>0));
}
function updateManualTotals(){
  const l=collectManualLines(), d=round2(l.reduce((a,x)=>a+x.debe,0)), h=round2(l.reduce((a,x)=>a+x.haber,0)), df=round2(d-h);
  document.getElementById('manual-totales').innerHTML=`<span>DEBE: <strong class="debe">$${fmt(d)}</strong></span>
    <span>HABER: <strong class="haber">$${fmt(h)}</strong></span>
    <span style="color:${Math.abs(df)<0.01?'var(--green)':'var(--red)'}">${Math.abs(df)<0.01?'✓ Cuadra':'⚠ Diferencia $'+fmt(Math.abs(df))}</span>`;
}
function resetManualForm(){
  manualEditId=null;
  document.getElementById('manual-save-btn').textContent='Guardar asiento';
  document.getElementById('man-fecha').value=hoyISO();
  document.getElementById('man-ref').value=''; document.getElementById('man-concepto').value='';
  document.getElementById('manual-lines').innerHTML=''; manualLineCount=0;
  addManualLine(); addManualLine();
}
function saveManualAsiento(){
  const fecha=document.getElementById('man-fecha').value;
  const periodo=document.getElementById('man-periodo').value||(fecha?fecha.slice(0,7):'');
  const ref=(document.getElementById('man-ref').value||'').trim()||`AJ-${String(MANUAL_ASIENTOS.length+1).padStart(3,'0')}`;
  const concepto=(document.getElementById('man-concepto').value||'').trim();
  const lines=collectManualLines();
  if(!fecha||!periodo||!concepto||lines.length<2) return showToast('Completa fecha, período, concepto y al menos 2 líneas','err');
  const d=round2(lines.reduce((a,l)=>a+l.debe,0)), h=round2(lines.reduce((a,l)=>a+l.haber,0));
  if(Math.abs(d-h)>=0.01) return showToast(`El asiento no cuadra: DEBE $${fmt(d)} vs HABER $${fmt(h)}`,'err');
  if(manualEditId){ const i=MANUAL_ASIENTOS.findIndex(a=>a.id===manualEditId); if(i>=0) MANUAL_ASIENTOS[i]={...MANUAL_ASIENTOS[i],fecha,periodo,ref,concepto,lines,updatedAt:new Date().toISOString()}; }
  else MANUAL_ASIENTOS.push({id:Date.now(),fecha,periodo,ref,concepto,lines,createdAt:new Date().toISOString()});
  persistManuales(); resetManualForm(); renderManuales(); initFilters(); refreshAccountingViews();
  showToast('Asiento manual guardado');
}
/* ============ ASIENTOS CONTABLES (Manual + Auto) ============ */
let manSubTab='manual', manPage=1, manSize=8, manAutoPage=1, manAutoSize=8;
const MAN_SELECTED=new Set();
let manFiltered=[], manAutoFiltered=[];

function renderManuales(){
  /* Stats */
  invalidateEntries();
  const all=allEntries(), mans=manualEntries();
  const manTotal=mans.length, autoTotal=all.length-mans.length;
  const manSumD=round2(mans.reduce((s,e)=>s+entryTotals(e).debe,0));
  const manSumH=round2(mans.reduce((s,e)=>s+entryTotals(e).haber,0));
  const descuadrados=mans.filter(e=>Math.abs(entryTotals(e).diff)>=0.01).length;
  const sc=document.getElementById('man-stats');
  if(sc) sc.innerHTML=`
    <div class="stat-card"><div class="stat-label">Asientos Manuales</div><div class="stat-value">${manTotal}</div></div>
    <div class="stat-card"><div class="stat-label">Asientos Automáticos</div><div class="stat-value blue">${autoTotal}</div></div>
    <div class="stat-card"><div class="stat-label">Total DEBE (manual)</div><div class="stat-value">$${fmt(manSumD)}</div></div>
    <div class="stat-card"><div class="stat-label">Total HABER (manual)</div><div class="stat-value">$${fmt(manSumH)}</div></div>
    <div class="stat-card"><div class="stat-label">Descuadrados</div><div class="stat-value ${descuadrados?'red':'green'}">${descuadrados}</div></div>`;
  /* Sub-tab activation */
  document.querySelectorAll('#man-sub-tabs .report-level-tab').forEach(t=>t.classList.toggle('active',t.dataset.sub===manSubTab));
  document.getElementById('man-sub-manual').style.display=manSubTab==='manual'?'':'none';
  document.getElementById('man-sub-auto').style.display=manSubTab==='auto'?'':'none';
  filterManuales();
}
function showManSubTab(sub){
  manSubTab=sub; manPage=1; manAutoPage=1;
  renderManuales();
}
function filterManuales(){
  if(manSubTab==='manual'){
    const q=(document.getElementById('man-search')?.value||'').toLowerCase();
    const pf=document.getElementById('man-periodo-filtro')?.value||'';
    const bf=document.getElementById('man-balance')?.value||'';
    let rows=MANUAL_ASIENTOS.slice().reverse();
    if(q) rows=rows.filter(a=>`${a.ref} ${a.concepto} ${a.periodo} ${a.lines.map(l=>l.cta+' '+l.nom).join(' ')}`.toLowerCase().includes(q));
    if(pf) rows=rows.filter(a=>a.periodo===pf);
    if(bf==='ok') rows=rows.filter(a=>Math.abs(round2(a.lines.reduce((s,l)=>s+l.debe,0)-a.lines.reduce((s,l)=>s+l.haber,0)))<0.01);
    else if(bf==='bad') rows=rows.filter(a=>Math.abs(round2(a.lines.reduce((s,l)=>s+l.debe,0)-a.lines.reduce((s,l)=>s+l.haber,0)))>=0.01);
    manFiltered=rows;
    renderManList();
  } else {
    filterManAuto();
  }
}
function filterManAuto(){
  const q=(document.getElementById('man-auto-search')?.value||'').toLowerCase();
  const pf=document.getElementById('man-auto-periodo')?.value||'';
  const sf=document.getElementById('man-auto-source')?.value||'';
  const cf=document.getElementById('man-auto-cuenta')?.value||'';
  let rows=allEntries().filter(e=>e.source!=='manual');
  if(q) rows=rows.filter(e=>`${e.id} ${e.concepto} ${e.ref} ${e.lines.map(l=>l.cta+' '+l.nom).join(' ')}`.toLowerCase().includes(q));
  if(pf) rows=rows.filter(e=>e.periodo===pf);
  if(sf) rows=rows.filter(e=>e.source===sf);
  if(cf){ const [cc]=cf.split('|'); rows=rows.filter(e=>e.lines.some(l=>l.cta===cc)); }
  manAutoFiltered=rows;
  renderManAutoList();
}
function renderManList(){
  const c=document.getElementById('manuales-list'); if(!c) return;
  const total=manFiltered.length, pages=Math.ceil(total/manSize), start=(manPage-1)*manSize;
  const slice=manFiltered.slice(start,start+manSize);
  c.innerHTML=slice.length? slice.map((a,idx)=>{
    const d=round2(a.lines.reduce((s,l)=>s+l.debe,0)), h=round2(a.lines.reduce((s,l)=>s+l.haber,0));
    const gid=a.id; const sel=MAN_SELECTED.has(gid);
    const num='MAN-'+String(MANUAL_ASIENTOS.length-MANUAL_ASIENTOS.indexOf(a)).padStart(4,'0');
    const nomTag=a.nomina?' 🧾 Nómina':'';
    return `<div class="asiento-card">
      <div class="asiento-header">
      <label class="chk"><input type="checkbox" ${sel?'checked':''} onchange="toggleManSelect(${gid},this.checked)"></label>
      <div class="asiento-num">${esc(num)}</div>
      <div class="asiento-meta"><div class="asiento-proveedor">${esc(a.concepto)}${nomTag}</div>
        <div class="asiento-detail"><span>📅 ${fmtDate(a.fecha)}</span><span>📌 ${esc(a.periodo)}</span><span>🔖 <a class="ref-link" onclick="previewVoucher('${esc(a.ref)}')">${esc(a.ref)}</a></span>
        <span style="color:${Math.abs(d-h)<0.01?'var(--green)':'var(--red)'}">${Math.abs(d-h)<0.01?'✓ Cuadra':'⚠ $'+fmt(Math.abs(d-h))}</span></div></div>
      <span><button class="btn btn-ghost btn-sm" onclick="editManualAsiento(${gid})">✏️ Editar</button>
      <button class="btn btn-warning btn-sm" onclick="reverseManualAsiento(${gid})" title="Revertir">↩️ Revertir</button>
      <button class="btn btn-danger btn-sm" onclick="deleteManualAsiento(${gid})">🗑️</button></span></div>
      <div class="table-wrap" style="max-height:none;border:none"><table><thead><tr><th>Código</th><th>Cuenta</th><th class="num">DEBE</th><th class="num">HABER</th></tr></thead>
      <tbody>${a.lines.map(l=>`<tr><td data-label="Código" class="cuenta-code">${esc(l.cta)}</td><td data-label="Cuenta">${esc(l.nom)}</td>
      <td data-label="Debe" class="num debe">${l.debe?'$'+fmt(l.debe):''}</td><td data-label="Haber" class="num haber">${l.haber?'$'+fmt(l.haber):''}</td></tr>`).join('')}</tbody></table></div>
      <div class="asiento-total"><span>DEBE: <strong class="debe">$${fmt(d)}</strong></span><span>HABER: <strong class="haber">$${fmt(h)}</strong></span></div></div>`;
  }).join('') : '<div class="empty">No hay asientos manuales que coincidan.</div>';
  renderPag('man',total,manPage,manSize,'manGoPage');
  updateManBulk();
}
function renderManAutoList(){
  const c=document.getElementById('man-auto-list'); if(!c) return;
  const total=manAutoFiltered.length, pages=Math.ceil(total/manAutoSize), start=(manAutoPage-1)*manAutoSize;
  const slice=manAutoFiltered.slice(start,start+manAutoSize);
  c.innerHTML=slice.length? slice.map(e=>{
    const t=entryTotals(e);
    const tipo=e.source==='auto-venta'?'💰 Venta':e.source==='auto-ret'?'🧮 Retención':'⚙️ Compra';
    const adjTag=e.adjusted?' <span style="color:var(--amber)">🔧 Ajustado</span>':'';
    return `<div class="asiento-card">
      <div class="asiento-header">
      <div class="asiento-num">${esc(e.id)}</div>
      <div class="asiento-meta"><div class="asiento-proveedor">${esc(e.concepto)}</div>
        <div class="asiento-detail"><span>📅 ${fmtDate(e.fecha)}</span><span>📌 ${esc(e.periodo)}</span><span>🔖 <a class="ref-link" onclick="previewVoucher('${esc(e.ref)}')">${esc(e.ref)}</a></span><span>${tipo}${adjTag}</span></div></div>
      <span><button class="btn btn-ghost btn-sm" onclick="editEntry('${esc(e.id)}')">✏️ Editar</button></span></div>
      <div class="table-wrap" style="max-height:none;border:none"><table><thead><tr><th>Código</th><th>Cuenta</th><th class="num">DEBE</th><th class="num">HABER</th></tr></thead>
      <tbody>${e.lines.map(l=>`<tr><td data-label="Código" class="cuenta-code">${esc(l.cta)}</td><td data-label="Cuenta">${esc(l.nom)}</td>
      <td data-label="Debe" class="num debe">${l.debe?'$'+fmt(l.debe):''}</td><td data-label="Haber" class="num haber">${l.haber?'$'+fmt(l.haber):''}</td></tr>`).join('')}</tbody></table></div>
      <div class="asiento-total"><span>DEBE: <strong class="debe">$${fmt(t.debe)}</strong></span><span>HABER: <strong class="haber">$${fmt(t.haber)}</strong></span>
        <span class="${Math.abs(t.diff)<0.01?'haber':'debe'}">${Math.abs(t.diff)<0.01?'✓ Cuadra':'⚠ Diferencia $'+fmt(Math.abs(t.diff))}</span></div>
      ${e.glosa?`<div class="asiento-glosa"><strong>Glosa:</strong> ${esc(e.glosa)}</div>`:''}</div>`;
  }).join('') : '<div class="empty">No hay asientos automáticos que coincidan.</div>';
  renderPag('man-auto',total,manAutoPage,manAutoSize,'manAutoGoPage');
}
function manGoPage(p){ manPage=p; renderManList(); }
function manAutoGoPage(p){ manAutoPage=p; renderManAutoList(); }

/* --- Batch select for manual entries --- */
function toggleManSelect(id,checked){
  checked?MAN_SELECTED.add(id):MAN_SELECTED.delete(id); updateManBulk();
}
function toggleManSelectAll(checked){
  const ids=manFiltered.slice((manPage-1)*manSize,manPage*manSize).map(a=>a.id);
  ids.forEach(id=>checked?MAN_SELECTED.add(id):MAN_SELECTED.delete(id));
  renderManList();
}
function updateManBulk(){
  const bar=document.getElementById('man-select-bar'); if(!bar) return;
  const badge=document.getElementById('man-batch-count');
  const dbtn=document.getElementById('man-bulk-delete-btn');
  const rbtn=document.getElementById('man-bulk-reverse-btn');
  const sa=document.getElementById('man-select-all');
  if(badge) badge.textContent=MAN_SELECTED.size;
  bar.style.display=MAN_SELECTED.size>0?'flex':'none';
  if(dbtn) dbtn.disabled=!MAN_SELECTED.size;
  if(rbtn) rbtn.disabled=!MAN_SELECTED.size;
  if(sa){
    const pageIds=manFiltered.slice((manPage-1)*manSize,manPage*manSize).map(a=>a.id);
    sa.checked=pageIds.length>0&&pageIds.every(id=>MAN_SELECTED.has(id));
  }
}
function bulkDeleteManual(){
  if(!MAN_SELECTED.size) return;
  if(!confirm(`¿Eliminar ${MAN_SELECTED.size} asiento(s) manual(es)? Esta acción no se puede deshacer.`)) return;
  MANUAL_ASIENTOS=MANUAL_ASIENTOS.filter(a=>!MAN_SELECTED.has(a.id));
  persistManuales(); MAN_SELECTED.clear();
  renderManuales(); refreshAccountingViews(); showToast('Asientos eliminados');
}
function bulkReverseManual(){
  if(!MAN_SELECTED.size) return;
  if(!confirm(`¿Revertir ${MAN_SELECTED.size} asiento(s) manual(es)? Se crearán asientos de reversión con DEBE/HABER intercambiados.`)) return;
  const originals=MANUAL_ASIENTOS.filter(a=>MAN_SELECTED.has(a.id));
  originals.forEach(orig=>{
    const rev={
      id:Date.now()+Math.random(),
      fecha:orig.fecha,
      periodo:orig.periodo,
      ref:orig.ref+'-REV',
      concepto:'REVERSIÓN — '+orig.concepto,
      lines:orig.lines.map(l=>({cta:l.cta,nom:l.nom,debe:round2(l.haber),haber:round2(l.debe)})),
      reversedFrom:orig.id,
      createdAt:new Date().toISOString()
    };
    MANUAL_ASIENTOS.push(rev);
  });
  persistManuales(); MAN_SELECTED.clear();
  renderManuales(); refreshAccountingViews(); showToast(`${originals.length} asiento(s) revertido(s)`);
}

/* --- Single reversion --- */
function reverseManualAsiento(id){
  const orig=MANUAL_ASIENTOS.find(a=>a.id===id); if(!orig) return;
  if(!confirm('¿Revertir este asiento? Se creará un nuevo asiento con DEBE/HABER intercambiados.')) return;
  const rev={
    id:Date.now(),
    fecha:orig.fecha,
    periodo:orig.periodo,
    ref:orig.ref+'-REV',
    concepto:'REVERSIÓN — '+orig.concepto,
    lines:orig.lines.map(l=>({cta:l.cta,nom:l.nom,debe:round2(l.haber),haber:round2(l.debe)})),
    reversedFrom:orig.id,
    createdAt:new Date().toISOString()
  };
  MANUAL_ASIENTOS.push(rev); persistManuales();
  renderManuales(); refreshAccountingViews(); showToast('Asiento revertido');
}

/* --- Edit / Delete / Clear / Export (preserved from original) --- */
function editManualAsiento(id){
  const a=MANUAL_ASIENTOS.find(x=>x.id===id); if(!a) return;
  manualEditId=id; showTab('manuales');
  document.getElementById('man-fecha').value=a.fecha;
  const ps=document.getElementById('man-periodo');
  if(![...ps.options].some(o=>o.value===a.periodo)) ps.insertAdjacentHTML('beforeend',`<option value="${esc(a.periodo)}">${esc(periodLabel(a.periodo))}</option>`);
  ps.value=a.periodo;
  document.getElementById('man-ref').value=a.ref; document.getElementById('man-concepto').value=a.concepto;
  document.getElementById('manual-lines').innerHTML=''; manualLineCount=0;
  a.lines.forEach(l=>addManualLine(l));
  document.getElementById('manual-save-btn').textContent='Actualizar asiento';
  updateManualTotals();
}
function deleteManualAsiento(id){
  if(!confirm('¿Eliminar este asiento manual?')) return;
  MANUAL_ASIENTOS=MANUAL_ASIENTOS.filter(a=>a.id!==id); persistManuales();
  renderManuales(); refreshAccountingViews(); showToast('Asiento eliminado');
}
function clearManualAsientos(){
  if(!confirm('¿Eliminar TODOS los asientos manuales (incluidos los de nómina)?')) return;
  MANUAL_ASIENTOS=[]; persistManuales(); renderManuales(); refreshAccountingViews();
}
function exportManualAsientos(){ descargarArchivo('asientos-manuales-'+hoyISO()+'.json',JSON.stringify(MANUAL_ASIENTOS,null,2)); }

/* ============ AJUSTES DE ASIENTOS ============ */
let adjIdx=null, adjEntryId=null, adjCount=0;
function editEntry(id){
  const e=allEntries().find(x=>x.id===id); if(!e) return showToast('Asiento no encontrado','err');
  if(e.source==='manual') return editManualAsiento(e.dbId);
  if(e.source==='auto') return openAdjModal(e.dataIdx,e);
  openEntryAdjModal(e);
}
function addAdjLine(l={}){
  const c=document.getElementById('adj-lines'); const id='adj-'+(++adjCount);
  const d=document.createElement('div'); d.className='line-editor'; d.dataset.line=id;
  d.innerHTML=`<select class="ml-cuenta" onchange="updateAdjTotals()">${accountOptions(l.cta||'')}</select>
    <input class="ml-debe num" type="number" step="0.01" min="0" placeholder="Debe" value="${l.debe||''}" oninput="updateAdjTotals()">
    <input class="ml-haber num" type="number" step="0.01" min="0" placeholder="Haber" value="${l.haber||''}" oninput="updateAdjTotals()">
    <button class="btn btn-ghost btn-sm" onclick="this.parentNode.remove();updateAdjTotals()">✕</button>`;
  c.appendChild(d); updateAdjTotals();
}
function collectAdjLines(){
  return [...document.querySelectorAll('#adj-lines .line-editor')].map(r=>{
    const [cta,nom]=r.querySelector('.ml-cuenta').value.split('|');
    return {cta,nom,debe:round2(r.querySelector('.ml-debe').value),haber:round2(r.querySelector('.ml-haber').value)};
  }).filter(l=>l.cta&&(l.debe>0||l.haber>0));
}
function updateAdjTotals(){
  const l=collectAdjLines(), d=round2(l.reduce((a,x)=>a+x.debe,0)), h=round2(l.reduce((a,x)=>a+x.haber,0)), df=round2(d-h);
  document.getElementById('adj-totales').innerHTML=`<span>DEBE: <strong class="debe">$${fmt(d)}</strong></span>
    <span>HABER: <strong class="haber">$${fmt(h)}</strong></span>
    <span style="color:${Math.abs(df)<0.01?'var(--green)':'var(--red)'}">${Math.abs(df)<0.01?'✓ Cuadra':'⚠ Diferencia $'+fmt(Math.abs(df))}</span>`;
}
function openAdjModal(i,e){
  adjIdx=i; adjEntryId=null; const d=DATA[i];
  document.getElementById('adj-tx-info').innerHTML=`<strong>${esc(d['RAZON SOCIAL EMISOR'])}</strong><br>
    <span class="text-muted">Fac: ${esc(d['NO COMPROBANTE'])} · ${fmtDate(d['FECHA EMISION'])} · Total original $${fmt(d.TOTAL)}</span><br>
    <span class="text-muted small">${esc(d.RESUMEN)}</span>`;
  document.getElementById('adj-lines').innerHTML=''; adjCount=0;
  e.lines.forEach(l=>addAdjLine(l));
  document.getElementById('adj-comentario').value=AUTO_ADJ[i]?.userNote||'';
  document.getElementById('adj-nota-auto').textContent=AUTO_ADJ[i]?('Último ajuste: '+AUTO_ADJ[i].autoNote):'El ajuste se guarda aparte, sin alterar el comprobante original.';
  openModal('modal-ajuste');
}
function openEntryAdjModal(e){
  adjIdx=null; adjEntryId=e.id;
  document.getElementById('adj-tx-info').innerHTML=`<strong>${esc(e.concepto)}</strong><br>
    <span class="text-muted">Ref: ${esc(e.ref)} · ${fmtDate(e.fecha)} · Asiento ${esc(e.id)}</span><br>
    <span class="text-muted small">${esc(e.resumen||'')}</span>`;
  document.getElementById('adj-lines').innerHTML=''; adjCount=0;
  e.lines.forEach(l=>addAdjLine(l));
  document.getElementById('adj-comentario').value=ENTRY_ADJ[e.id]?.note||'';
  document.getElementById('adj-nota-auto').textContent=ENTRY_ADJ[e.id]?'Este asiento ya tiene un ajuste guardado.':'El ajuste se guarda aparte, sin alterar el documento original.';
  openModal('modal-ajuste');
}
function buildAutoDiffNote(o,n){
  const ch=[]; const max=Math.max(o.length,n.length);
  for(let i=0;i<max;i++){
    const a=o[i],b=n[i];
    if(!a){ ch.push(`+ ${b.cta} ${b.nom} (D $${fmt(b.debe)} / H $${fmt(b.haber)})`); continue; }
    if(!b){ ch.push(`− ${a.cta} ${a.nom}`); continue; }
    if(a.cta!==b.cta||round2(a.debe)!==round2(b.debe)||round2(a.haber)!==round2(b.haber))
      ch.push(`${a.cta}: D $${fmt(a.debe)}→$${fmt(b.debe)}, H $${fmt(a.haber)}→$${fmt(b.haber)}`);
  }
  return ch.length?ch.join(' · '):'Sin cambios en valores.';
}
function saveAdjustment(){
  const lines=collectAdjLines();
  if(lines.length<2) return showToast('Agrega al menos 2 líneas','err');
  const d=round2(lines.reduce((a,l)=>a+l.debe,0)), h=round2(lines.reduce((a,l)=>a+l.haber,0));
  if(Math.abs(d-h)>=0.01) return showToast(`No cuadra: DEBE $${fmt(d)} vs HABER $${fmt(h)}`,'err');
  const note=(document.getElementById('adj-comentario').value||'').trim(), now=new Date().toISOString();
  if(adjIdx!==null){
    const orig=getAsientoCompra(DATA[adjIdx]);
    AUTO_ADJ[adjIdx]={lines,originalLines:orig,autoNote:buildAutoDiffNote(orig,lines),userNote:note,updatedAt:now};
    persistAutoAdj();
    const id='AUTO-'+String(adjIdx+1).padStart(4,'0');
    if(ENTRY_ADJ[id]){ ENTRY_ADJ[id]={...ENTRY_ADJ[id],lines,updatedAt:now}; persistEntryAdj(); }
  } else {
    ENTRY_ADJ[adjEntryId]={...(ENTRY_ADJ[adjEntryId]||{}),lines,note:note||'Valores editados manualmente',updatedAt:now};
    persistEntryAdj();
  }
  closeModal('modal-ajuste'); refreshAccountingViews(); showToast('Ajuste guardado');
}
function revertAdjustment(){
  if(adjIdx!==null){ delete AUTO_ADJ[adjIdx]; persistAutoAdj(); delete ENTRY_ADJ['AUTO-'+String(adjIdx+1).padStart(4,'0')]; persistEntryAdj(); }
  else if(adjEntryId){ delete ENTRY_ADJ[adjEntryId]; persistEntryAdj(); }
  closeModal('modal-ajuste'); refreshAccountingViews(); showToast('Asiento revertido al cálculo original');
}

/* ============ DESCUADRADOS ============ */
function renderDescuadrados(){
  const c=document.getElementById('descuadrados-container'); if(!c) return;
  const q=(document.getElementById('desc-search')?.value||'').toLowerCase(), per=document.getElementById('desc-periodo')?.value||'';
  const rows=allEntries().filter(e=>{
    if(per&&e.periodo!==per) return false;
    const t=entryTotals(e), corr=!!(e.adjusted||e.bulkAdjusted);
    const dataDiff=(e.original&&!corr)?Math.abs(+e.original.DIFERENCIA||0)>=0.01:false;
    if(!(Math.abs(t.diff)>=0.01||dataDiff)) return false;
    if(q&&!`${e.id} ${e.concepto} ${e.ref} ${e.resumen}`.toLowerCase().includes(q)) return false;
    return true;
  });
  c.innerHTML = rows.length? rows.map(e=>`<div class="diagnostico"><strong>${esc(e.id)}:</strong> ${esc(diagnosticForEntry(e))}</div>`+renderEntryCard(e)).join('')
    : '<div class="empty">✓ No hay asientos descuadrados ni diferencias relevantes.</div>';
}

/* ============ MAYORES ============ */
function renderLedgerTable(c){
  let s=0;
  const td=round2(c.movs.reduce((a,m)=>a+(+m.debe||0),0)), th=round2(c.movs.reduce((a,m)=>a+(+m.haber||0),0));
  const rows=c.movs.slice().sort((a,b)=>String(a.fecha).localeCompare(String(b.fecha))).map(m=>{
    s=round2(s+(+m.debe||0)-(+m.haber||0));
    return `<tr><td data-label="Fecha">${fmtDate(m.fecha)}</td><td data-label="Asiento" class="mono small">${esc(m.asiento)}</td>
      <td data-label="Detalle"><strong>${esc(m.concepto)}</strong>${m.resumen?`<span class="detail-resumen">${esc(m.resumen)}</span>`:''}</td>
      <td data-label="Ref." class="mono small">${esc(m.ref)}</td>
      <td data-label="Debe" class="num debe">${m.debe?'$'+fmt(m.debe):''}</td>
      <td data-label="Haber" class="num haber">${m.haber?'$'+fmt(m.haber):''}</td>
      <td data-label="Saldo" class="num"><strong>$${fmt(Math.abs(s))} ${s>=0?'D':'H'}</strong></td></tr>`;
  }).join('');
  return `<div class="table-wrap"><table class="rtable"><thead><tr><th>Fecha</th><th>Asiento</th><th>Detalle</th><th>Ref.</th><th class="num">Debe</th><th class="num">Haber</th><th class="num">Saldo</th></tr></thead>
    <tbody>${rows}</tbody><tfoot><tr><td colspan="4">TOTALES</td><td class="num debe">$${fmt(td)}</td><td class="num haber">$${fmt(th)}</td><td class="num">$${fmt(Math.abs(round2(td-th)))}</td></tr></tfoot></table></div>`;
}
function renderMayores(){
  const c=document.getElementById('mayores-container'); if(!c) return;
  const q=(document.getElementById('may-search').value||'').toLowerCase();
  const ctaSel=document.getElementById('may-cuenta').value, per=document.getElementById('may-periodo').value;
  let cs=buildLedger('',per);
  if(ctaSel) cs=cs.filter(x=>x.nom===ctaSel);
  if(q) cs=cs.filter(x=>`${x.cod} ${x.nom}`.toLowerCase().includes(q));
  c.innerHTML = cs.length? cs.map((x,i)=>{
    const d=round2(x.movs.reduce((a,m)=>a+(+m.debe||0),0)), h=round2(x.movs.reduce((a,m)=>a+(+m.haber||0),0)), s=round2(d-h);
    return `<details class="accordion" ${i===0?'open':''}><summary>
      <div><div class="accordion-title"><span class="cuenta-code">${esc(x.cod)}</span> · ${esc(x.nom)}</div>
      <div class="accordion-meta">${x.movs.length} movimientos · Debe $${fmt(d)} · Haber $${fmt(h)}</div></div>
      <div class="${s>=0?'debe':'haber'}"><strong>$${fmt(Math.abs(s))} ${s>=0?'D':'H'}</strong></div></summary>
      ${renderLedgerTable(x)}</details>`;
  }).join('') : '<div class="empty">No hay movimientos registrados.</div>';
}
function openMayorModal(cod){
  const per=document.getElementById('bal-periodo')?.value||'';
  const c=buildLedger(cod,per)[0]; if(!c) return showToast('Sin movimientos','err');
  document.getElementById('modal-mayor-title').innerHTML=`📒 Mayor · <span class="cuenta-code">${esc(c.cod)}</span> ${esc(c.nom)}`;
  document.getElementById('modal-mayor-body').innerHTML=renderLedgerTable(c);
  openModal('modal-mayor');
}

/* ============ BALANCE DE COMPROBACIÓN ============ */
function renderBalance(){
  const c=document.getElementById('balance-container'); if(!c) return;
  const per=document.getElementById('bal-periodo').value, q=(document.getElementById('bal-search').value||'').toLowerCase();
  const rows=buildLedger('',per).map(x=>{
    const d=round2(x.movs.reduce((a,m)=>a+(+m.debe||0),0)), h=round2(x.movs.reduce((a,m)=>a+(+m.haber||0),0));
    return {cod:x.cod,nom:x.nom,debe:d,haber:h,count:x.movs.length};
  }).filter(r=>!q||`${r.cod} ${r.nom}`.toLowerCase().includes(q));
  const tD=round2(rows.reduce((a,r)=>a+r.debe,0)), tH=round2(rows.reduce((a,r)=>a+r.haber,0));
  const sD=round2(rows.reduce((a,r)=>a+(r.debe>r.haber?r.debe-r.haber:0),0));
  const sH=round2(rows.reduce((a,r)=>a+(r.haber>r.debe?r.haber-r.debe:0),0));
  c.innerHTML=`<div class="table-wrap"><table class="rtable">
    <thead><tr><th>Código</th><th>Cuenta</th><th class="num">DEBE</th><th class="num">HABER</th><th class="num">Saldo Deudor</th><th class="num">Saldo Acreedor</th><th>Mayor</th></tr></thead>
    <tbody>${rows.length?rows.map(r=>`<tr>
      <td data-label="Código" class="cuenta-code">${esc(r.cod)}</td>
      <td data-label="Cuenta">${esc(r.nom)} <span class="count-bubble">${r.count}</span></td>
      <td data-label="Debe" class="num">$${fmt(r.debe)}</td><td data-label="Haber" class="num">$${fmt(r.haber)}</td>
      <td data-label="S. Deudor" class="num debe">${r.debe>r.haber?'$'+fmt(r.debe-r.haber):''}</td>
      <td data-label="S. Acreedor" class="num haber">${r.haber>r.debe?'$'+fmt(r.haber-r.debe):''}</td>
      <td data-label="Mayor"><button class="btn btn-ghost btn-sm" onclick="openMayorModal('${esc(r.cod)}')">Ver</button></td></tr>`).join('')
      :'<tr><td colspan="7" class="empty">Sin movimientos.</td></tr>'}</tbody>
    <tfoot><tr><td colspan="2">TOTALES</td><td class="num">$${fmt(tD)}</td><td class="num">$${fmt(tH)}</td>
      <td class="num debe">$${fmt(sD)}</td><td class="num haber">$${fmt(sH)}</td><td></td></tr></tfoot></table></div>
    <div class="asiento-total"><span>Control: <strong style="color:${Math.abs(tD-tH)<0.01?'var(--green)':'var(--red)'}">${Math.abs(tD-tH)<0.01?'✓ Balance cuadrado':'⚠ Diferencia $'+fmt(Math.abs(tD-tH))}</strong></span></div>`;
}

/* ============ ESTADOS FINANCIEROS ============ */
function finHead(titulo,per){
  return `<div class="fin-head"><div class="fh-name">${esc(EMPRESA.nombre||'Empresa sin configurar')}</div>
    <div class="text-muted">${titulo} · ${esc(periodLabel(per))}</div>
    <div class="text-muted small">RUC: ${esc(EMPRESA.ruc||'—')}${EMPRESA.ciudad?' · '+esc(EMPRESA.ciudad):''}</div>
    <div class="text-muted small">Expresado en dólares de los Estados Unidos de América (USD)</div></div>`;
}
function renderEstadoResultados(){
  const el=document.getElementById('er-periodo'); if(!el) return;
  const per=el.value, er=computeEstadoResultados(per);
  const rowsG=a=>a.slice().sort((x,y)=>y.total-x.total).map(g=>`<div class="fin-row fin-indent">
    <span><span class="cuenta-code">${esc(g.cod)}</span> ${esc(g.nom)} <span class="text-muted">(${g.docs} doc.)</span></span>
    <span style="color:var(--red)">($${fmt(g.total)})</span></div>`).join('')||'<div class="fin-row fin-indent"><span class="text-muted">Sin movimientos</span><span></span></div>';
  const rowsI=a=>a.slice().sort((x,y)=>y.total-x.total).map(g=>`<div class="fin-row fin-indent">
    <span><span class="cuenta-code">${esc(g.cod)}</span> ${esc(g.nom)} <span class="text-muted">(${g.docs} doc.)</span></span>
    <span style="color:var(--green)">$${fmt(g.total)}</span></div>`).join('')||'<div class="fin-row fin-indent"><span class="text-muted">Sin ingresos registrados</span><span></span></div>';
  const alerta=er.ventasMal.length?`<div class="diagnostico">⚠ <strong>${er.ventasMal.length} venta(s)</strong> tienen cuenta fuera del grupo 4 (Ingresos) y no se suman aquí. Revisa la pestaña Clientes.</div>`:'';
  document.getElementById('er-container').innerHTML=`<div class="fin-doc">${alerta}${finHead('Estado de Resultados Integral',per)}
    <div class="fin-section"><div class="fin-title">💰 Ingresos</div>${rowsI(er.ingresosArr)}
      <div class="fin-row subtotal"><span>TOTAL INGRESOS</span><span>$${fmt(er.totalIngresos)}</span></div></div>
    <div class="fin-section"><div class="fin-title">🏭 Costo de Ventas</div>${rowsG(er.costos)}
      <div class="fin-row subtotal"><span>TOTAL COSTO DE VENTAS</span><span style="color:var(--red)">($${fmt(er.totalCostos)})</span></div></div>
    <div class="fin-row total"><span>UTILIDAD BRUTA</span><span style="color:${er.utilidadBruta>=0?'var(--green)':'var(--red)'}">$${fmt(er.utilidadBruta)}</span></div>
    <div class="fin-section" style="margin-top:16px"><div class="fin-title">📋 Gastos Operacionales</div>${rowsG(er.gastosOp)}
      <div class="fin-row subtotal"><span>TOTAL GASTOS OPERACIONALES</span><span style="color:var(--red)">($${fmt(er.totalGastosOp)})</span></div></div>
    <div class="fin-row total"><span>UTILIDAD OPERACIONAL</span><span style="color:${er.utilidadOperacional>=0?'var(--green)':'var(--red)'}">$${fmt(er.utilidadOperacional)}</span></div>
    <div class="fin-section" style="margin-top:16px"><div class="fin-title">🏦 Gastos Financieros y No Operacionales</div>${rowsG(er.gastosNoOp.concat(er.otros))}
      <div class="fin-row subtotal"><span>TOTAL</span><span style="color:var(--red)">($${fmt(round2(er.totalGastosNoOp+er.totalOtros))})</span></div></div>
    <hr class="divider">
    <div class="fin-row total"><span>UTILIDAD ANTES DE PARTICIPACIÓN E IMPUESTOS</span><span>$${fmt(er.utilidadAntes)}</span></div>
    <div class="fin-row"><span>(-) ${Math.round(PCT_PART_TRAB*100)}% Participación Trabajadores (estimada)</span><span style="color:var(--red)">($${fmt(er.partTrab)})</span></div>
    <div class="fin-row"><span>(-) Impuesto a la Renta estimado (${Math.round(PCT_IR_SOC*100)}%)</span><span style="color:var(--red)">($${fmt(er.irEstimado)})</span></div>
    <div class="fin-row total ${(er.utilidadAntes-er.partTrab-er.irEstimado)<0?'total-red':'total-green'}">
      <span>RESULTADO NETO ESTIMADO DEL PERÍODO</span><span>$${fmt(round2(er.utilidadAntes-er.partTrab-er.irEstimado))}</span></div>
    <p class="text-muted small" style="margin-top:8px">La participación de trabajadores (${Math.round(PCT_PART_TRAB*100)}%) y el impuesto a la renta (${Math.round(PCT_IR_SOC*100)}% tarifa general para sociedades) son estimaciones automáticas sobre la utilidad contable; la base imponible real requiere conciliación tributaria (gastos no deducibles, amortización de pérdidas, deducciones adicionales).</p>
    <div class="fin-section" style="margin-top:20px"><div class="fin-title">🧾 IVA Crédito Tributario</div>
      <div class="fin-row"><span>Saldo acumulado de IVA en compras</span><span style="color:var(--green)">$${fmt(er.totalIVA)}</span></div></div>
    <div class="panel" style="margin-top:16px"><div class="stats">
      <div class="stat-card"><div class="stat-label">Ingresos</div><div class="stat-value green">$${fmt(er.totalIngresos)}</div></div>
      <div class="stat-card"><div class="stat-label">Costos y Gastos</div><div class="stat-value red">$${fmt(er.totalGastos)}</div></div>
      <div class="stat-card"><div class="stat-label">Margen bruto</div><div class="stat-value blue">${er.totalIngresos?fmt(er.utilidadBruta/er.totalIngresos*100):'0.00'}%</div></div>
      <div class="stat-card"><div class="stat-label">Asientos</div><div class="stat-value amber">${er.entries.length}</div></div></div></div></div>`;
}
function renderBalanceGeneral(){
  const el=document.getElementById('bg-periodo'); if(!el) return;
  const per=el.value, bg=computeBalanceGeneral(per);
  const rows=a=>a.length?a.slice().sort((x,y)=>x.cod.localeCompare(y.cod)).map(r=>`<div class="fin-row fin-indent">
    <span><span class="cuenta-code">${esc(r.cod)}</span> ${esc(r.nom)}</span><span>$${fmt(r.saldo)}</span></div>`).join('')
    :'<div class="fin-row fin-indent"><span class="text-muted">Sin movimientos</span><span></span></div>';
  document.getElementById('bg-container').innerHTML=`<div class="fin-doc">${finHead('Estado de Situación Financiera',per)}
    <div class="fin-section"><div class="fin-title">🏦 Activo</div>${rows(bg.activo)}
      <div class="fin-row subtotal"><span>TOTAL ACTIVO</span><span>$${fmt(bg.totalActivo)}</span></div></div>
    <div class="fin-section"><div class="fin-title">📄 Pasivo</div>${rows(bg.pasivo)}
      <div class="fin-row subtotal"><span>TOTAL PASIVO</span><span>$${fmt(bg.totalPasivo)}</span></div></div>
    <div class="fin-section"><div class="fin-title">🧾 Patrimonio</div>${rows(bg.patrimonio)}
      <div class="fin-row fin-indent"><span>Resultado del ejercicio</span><span style="color:${bg.resultado>=0?'var(--green)':'var(--red)'}">$${fmt(bg.resultado)}</span></div>
      <div class="fin-row subtotal"><span>TOTAL PATRIMONIO</span><span>$${fmt(bg.totalPatrimonio)}</span></div></div>
    <hr class="divider">
    <div class="fin-row total"><span>TOTAL PASIVO + PATRIMONIO</span><span>$${fmt(round2(bg.totalPasivo+bg.totalPatrimonio))}</span></div>
    <div class="asiento-total"><span>Control: <strong style="color:${Math.abs(bg.diferencia)<0.01?'var(--green)':'var(--red)'}">${Math.abs(bg.diferencia)<0.01?'✓ Activo = Pasivo + Patrimonio':'⚠ Diferencia $'+fmt(Math.abs(bg.diferencia))}</strong></span></div></div>`;
}

window.openTxModal = openTxModal;
window.applyProveedorRule = applyProveedorRule;
window.clearProveedorRule = clearProveedorRule;
window.applyClienteRule = applyClienteRule;
window.clearClienteRule = clearClienteRule;
window.editCuentaContable = editCuentaContable;
window.editEntry = editEntry;
window.editManualAsiento = editManualAsiento;
window.deleteManualAsiento = deleteManualAsiento;
window.reverseManualAsiento = reverseManualAsiento;
window.bulkDeleteManual = bulkDeleteManual;
window.bulkReverseManual = bulkReverseManual;
window.toggleManSelect = toggleManSelect;
window.toggleManSelectAll = toggleManSelectAll;
window.manGoPage = manGoPage;
window.manAutoGoPage = manAutoGoPage;
window.showManSubTab = showManSubTab;
window.filterManuales = filterManuales;
window.reverseManualAsiento = reverseManualAsiento;
window.bulkDeleteManual = bulkDeleteManual;
window.bulkReverseManual = bulkReverseManual;
window.toggleManSelect = toggleManSelect;
window.toggleManSelectAll = toggleManSelectAll;
window.manGoPage = manGoPage;
window.manAutoGoPage = manAutoGoPage;
window.showManSubTab = showManSubTab;
window.filterManuales = filterManuales;
window.openMayorModal = openMayorModal;
window.onTxCheck = onTxCheck;
window.updateProvSel = updateProvSel;
window.updateCliSel = updateCliSel;
window.toggleDiarSelect = toggleDiarSelect;

/* Auto-expose window */
window.addAdjLine = addAdjLine;
window.addCuentaContable = addCuentaContable;
window.addManualLine = addManualLine;
window.applyClienteRuleMasivo = applyClienteRuleMasivo;
window.applyProveedorRuleMasivo = applyProveedorRuleMasivo;
window.applyTxCuentaMasivo = applyTxCuentaMasivo;
window.bulkApplyGlosa = bulkApplyGlosa;
window.bulkApplyReclasificacion = bulkApplyReclasificacion;
window.clearClienteRuleMasivo = clearClienteRuleMasivo;
window.clearDiarSelection = clearDiarSelection;
window.clearFiltersDiario = clearFiltersDiario;
window.clearFiltersRetenciones = clearFiltersRetenciones;
window.clearFiltersTx = clearFiltersTx;
window.clearFiltersVentas = clearFiltersVentas;
window.clearManualAsientos = clearManualAsientos;
window.clearProveedorRuleMasivo = clearProveedorRuleMasivo;
window.clearTxOverrideMasivo = clearTxOverrideMasivo;
window.clearTxSelection = clearTxSelection;
window.deleteCuentaContable = deleteCuentaContable;
window.exportManualAsientos = exportManualAsientos;
window.filterDiario = filterDiario;
window.filterRetenciones = filterRetenciones;
window.filterTx = filterTx;
window.filterVentas = filterVentas;
window.openBulkDiarioModal = openBulkDiarioModal;
window.renderBalance = renderBalance;
window.renderBalanceGeneral = renderBalanceGeneral;
window.renderClientes = renderClientes;
window.renderDescuadrados = renderDescuadrados;
window.renderEstadoResultados = renderEstadoResultados;
window.renderManuales = renderManuales;
window.renderMayores = renderMayores;
window.renderPlanCuentas = renderPlanCuentas;
window.renderProveedores = renderProveedores;
window.resetManualForm = resetManualForm;
window.revertAdjustment = revertAdjustment;
window.saveAdjustment = saveAdjustment;
window.saveCuentaTx = saveCuentaTx;
window.saveEditCuenta = saveEditCuenta;
window.saveManualAsiento = saveManualAsiento;
window.selectAllFilteredTx = selectAllFilteredTx;
window.sortTx = sortTx;
window.toggleAllClientes = toggleAllClientes;
window.toggleAllProveedores = toggleAllProveedores;
window.toggleAllTx = toggleAllTx;
window.toggleDiarSelectAllFiltered = toggleDiarSelectAllFiltered;
window.txGoPage = txGoPage;
window.vtGoPage = vtGoPage;
window.retGoPage = retGoPage;
window.diarGoPage = diarGoPage;
/* ============ STUBS: MÓDULOS PENDIENTES ============ */
function renderConciliacion(){
  const c=document.getElementById('conciliacion-container'); if(!c) return;
  if(typeof buildConciliacionView==='function') buildConciliacionView(c);
  else c.innerHTML='<div class="empty">Módulo de conciliación bancaria cargando...</div>';
}
function renderActivosFijos(){
  const c=document.getElementById('activos-container'); if(!c) return;
  if(typeof buildActivosView==='function') buildActivosView(c);
  else c.innerHTML='<div class="empty">Módulo de activos fijos cargando...</div>';
}
function renderDashboard(){
  const c=document.getElementById('dashboard-container'); if(!c) return;
  if(typeof buildDashboardView==='function') buildDashboardView(c);
  else c.innerHTML='<div class="empty">Dashboard inteligente cargando...</div>';
}
function renderEnlaceMagico(){
  const c=document.getElementById('enlacemagico-container'); if(!c) return;
  if(typeof buildEnlaceMagicoView==='function') buildEnlaceMagicoView(c);
  else c.innerHTML='<div class="empty">Enlace Mágico cargando...</div>';
}

window.updateManualTotals = updateManualTotals;
window.updateAdjTotals = updateAdjTotals;
window.renderConciliacion = renderConciliacion;
window.renderActivosFijos = renderActivosFijos;
window.renderDashboard = renderDashboard;
window.renderEnlaceMagico = renderEnlaceMagico;
