/* CONTSERTRIB · Nómina ecuatoriana */
'use strict';

const NOM_DEF={personal:9.45,patronal:11.15,sbu:482.00,fondoReserva:8.33,extensionConyuge:3.41};
let NOMINA_EMPLEADOS=LS.get(K.nomEmp,[]).map(e=>({...e,activo:e.activo!==false}));
let storedCfg=LS.get(K.nomCfg,{});
if(!storedCfg || typeof storedCfg !== 'object' || Array.isArray(storedCfg) || typeof storedCfg === 'function') storedCfg={};
let NOMINA_CONFIG={};
Object.keys(NOM_DEF).forEach(k=>{
  const v=storedCfg[k];
  NOMINA_CONFIG[k]=(v!=null && typeof v==='number' && !isNaN(v) && isFinite(v))?v:NOM_DEF[k];
});
console.log('[NOMINA] Config cargada:', NOMINA_CONFIG);
let NOMINA_RUNS=LS.get(K.nomRuns,{});
let nomEditId=null, nomCalc=null, revLineas=[], pagoPeriodo=null, pagoExtra=0, pagoSaldos=[];
const persistEmpleados=()=>LS.set(K.nomEmp,NOMINA_EMPLEADOS);
const persistNomCfg=()=>LS.set(K.nomCfg,NOMINA_CONFIG);
const persistRuns=()=>LS.set(K.nomRuns,NOMINA_RUNS);

const CTA_N={
  Sueldos:{cod:'5.2.1.01',nom:'Gasto Sueldos y Salarios'},
  Patronal:{cod:'5.2.1.02',nom:'Gasto Aporte Patronal IESS'},
  D13:{cod:'5.2.1.01.001',nom:'Provisión Décimo Tercer Sueldo'},
  D14:{cod:'5.2.1.01.002',nom:'Provisión Décimo Cuarto Sueldo'},
  Vac:{cod:'5.2.1.01.003',nom:'Provisión Vacaciones'},
  frGasto:{cod:'5.2.1.01.004',nom:'Gasto Fondos de Reserva'},
  sueldosPagar:{cod:'2.1.3.01',nom:'Sueldos por Pagar'},
  iessPagar:{cod:'2.1.3.02',nom:'IESS por Pagar (ap. personal + patronal + quiro. + ext.)'},
  d13Pagar:{cod:'2.1.3.03',nom:'Décimo Tercer Sueldo por Pagar'},
  d14Pagar:{cod:'2.1.3.04',nom:'Décimo Cuarto Sueldo por Pagar'},
  vacPagar:{cod:'2.1.3.05',nom:'Vacaciones por Pagar'},
  frPagar:{cod:'2.1.3.06',nom:'Fondos de Reserva por Pagar'},
  anticipos:{cod:'1.1.2.02',nom:'Anticipos a Empleados'},
  prestamos:{cod:'1.1.2.03',nom:'Préstamos a Empleados'}
};
const BANCOS=['1.1.1.02','1.1.1.03','1.1.1.04','1.1.1.01'];

/* ============================================================
   FIX #1: renderNomina() — función que faltaba (app.js la llama)
   ============================================================ */
function renderNomina(){
  refreshNominaPeriodos();
  applyNominaConfigToUI();
  renderEmpleados();
  renderNominaHistorial();
  if(nomCalc) renderNominaPreview();
}

function applyNominaConfigToUI(){
  const s=(id,v)=>{const e=document.getElementById(id);if(e)e.value=v;};
  s('nom-cfg-personal',NOMINA_CONFIG.personal); s('nom-cfg-patronal',NOMINA_CONFIG.patronal);
  s('nom-cfg-sbu',NOMINA_CONFIG.sbu); s('nom-cfg-fr',NOMINA_CONFIG.fondoReserva); s('nom-cfg-ext',NOMINA_CONFIG.extensionConyuge);
}
function saveNominaConfig(){
  const g=(id,d)=>{const v=parseFloat(document.getElementById(id).value); return isNaN(v)?d:v;};
  NOMINA_CONFIG={personal:g('nom-cfg-personal',NOM_DEF.personal),patronal:g('nom-cfg-patronal',NOM_DEF.patronal),
    sbu:g('nom-cfg-sbu',NOM_DEF.sbu),fondoReserva:g('nom-cfg-fr',NOM_DEF.fondoReserva),extensionConyuge:g('nom-cfg-ext',NOM_DEF.extensionConyuge)};
  persistNomCfg(); nomCalc=null; document.getElementById('nom-preview').innerHTML='';
  console.log('[NOMINA] Config guardada:', NOMINA_CONFIG);
  showToast('Parámetros de nómina actualizados');
}

/* ============================================================
   FIX #2: Rango de años extendido (y0+1 hasta y0-20) + input
   de año personalizado para años fuera del rango.
   ============================================================ */
function refreshNominaPeriodos(){
  const s=document.getElementById('nom-periodo'); if(!s) return;
  const prev=s.value, y0=new Date().getFullYear();
  /* Determinar año mínimo: el más bajo entre y0-20 y cualquier año
     que ya exista en NOMINA_RUNS (para permitir ver períodos históricos contabilizados) */
  const runYears=Object.keys(NOMINA_RUNS).map(p=>+p.split('-')[0]);
  const minY=Math.min(y0-20, ...(runYears.length?runYears:[y0-8]));
  let h='';
  for(let y=y0+1;y>=minY;y--){ h+=`<optgroup label="${y}">`;
    for(let m=1;m<=12;m++){ const p=`${y}-${String(m).padStart(2,'0')}`; h+=`<option value="${p}">${MESES_ES[m-1]} ${y}${NOMINA_RUNS[p]?' ✓':''}</option>`; }
    h+='</optgroup>'; }
  s.innerHTML=h;
  const actual=`${y0}-${String(new Date().getMonth()+1).padStart(2,'0')}`;
  s.value=(prev&&[...s.options].some(o=>o.value===prev))?prev:actual;
}
function onNominaPeriodoChange(){ renderEmpleados(); nomCalc=null; document.getElementById('nom-preview').innerHTML=''; }
function resetEmpleadoForm(){
  nomEditId=null; document.getElementById('nemp-save-btn').textContent='+ Agregar empleado';
  ['nemp-nombre','nemp-cedula','nemp-cargo','nemp-sueldo','nemp-fecha','nemp-quiro','nemp-prest','nemp-salida'].forEach(i=>document.getElementById(i).value='');
  ['nemp-activo','nemp-fr','nemp-d13','nemp-d14','nemp-ext'].forEach((i,k)=>document.getElementById(i).selectedIndex=0);
}
function saveEmpleado(){
  const g=id=>(document.getElementById(id).value||'').trim();
  const nombre=g('nemp-nombre'), sueldo=round2(document.getElementById('nemp-sueldo').value);
  if(!nombre||!sueldo) return showToast('Ingresa nombre y sueldo mensual','err');
  if(sueldo<NOMINA_CONFIG.sbu) showToast(`Atención: el sueldo es inferior al SBU vigente ($${fmt(NOMINA_CONFIG.sbu)})`);
  const fechaSalida=g('nemp-salida');
  const e={nombre,cedula:g('nemp-cedula'),cargo:g('nemp-cargo'),sueldo,fecha:g('nemp-fecha'),
    fechaSalida,
    activo:fechaSalida&&fechaSalida<=hoyISO()?false:document.getElementById('nemp-activo').value==='1',
    frModo:document.getElementById('nemp-fr').value,d13Modo:document.getElementById('nemp-d13').value,
    d14Modo:document.getElementById('nemp-d14').value,quiro:round2(document.getElementById('nemp-quiro').value||0),
    prestamo:round2(document.getElementById('nemp-prest').value||0),extConyuge:document.getElementById('nemp-ext').value==='1'};
  if(nomEditId){ const i=NOMINA_EMPLEADOS.findIndex(x=>x.id===nomEditId); if(i>=0) NOMINA_EMPLEADOS[i]={...NOMINA_EMPLEADOS[i],...e}; }
  else NOMINA_EMPLEADOS.push({id:Date.now(),...e});
  persistEmpleados(); resetEmpleadoForm(); renderEmpleados(); showToast('Empleado guardado');
}
function editEmpleado(id){
  const e=NOMINA_EMPLEADOS.find(x=>x.id===id); if(!e) return;
  nomEditId=id;
  const s=(i,v)=>document.getElementById(i).value=v??'';
  s('nemp-nombre',e.nombre); s('nemp-cedula',e.cedula); s('nemp-cargo',e.cargo); s('nemp-sueldo',e.sueldo);
  s('nemp-fecha',e.fecha); s('nemp-salida',e.fechaSalida||''); s('nemp-activo',e.activo?'1':'0'); s('nemp-fr',e.frModo||'acumulado');
  s('nemp-d13',e.d13Modo||'acumulado'); s('nemp-d14',e.d14Modo||'acumulado');
  s('nemp-quiro',e.quiro||''); s('nemp-prest',e.prestamo||''); s('nemp-ext',e.extConyuge?'1':'0');
  document.getElementById('nemp-save-btn').textContent='Actualizar empleado';
  document.getElementById('nemp-form-grid').scrollIntoView({behavior:'smooth',block:'center'});
}
function deleteEmpleado(id){
  if(!confirm('¿Eliminar este empleado? Los roles ya contabilizados no se modifican.')) return;
  NOMINA_EMPLEADOS=NOMINA_EMPLEADOS.filter(e=>e.id!==id); persistEmpleados(); renderEmpleados();
}
function mesesAntiguedad(f,per,fechaSalida){
  if(!f||!per) return 0;
  const i=new Date(f+'T00:00:00'), [y,m]=per.split('-').map(Number), fin=new Date(y,m,0);
  if(isNaN(i)||fin<i) return 0;
  /* Si hay fecha de salida y es anterior al fin del período, cap antigüedad ahí */
  let limite=fin;
  if(fechaSalida){ const s=new Date(fechaSalida+'T00:00:00'); if(!isNaN(s)&&s<fin) limite=s; }
  let ms=(limite.getFullYear()-i.getFullYear())*12+(limite.getMonth()-i.getMonth());
  if(i.getDate()>1 && limite.getDate()<i.getDate()) ms--;
  return Math.max(0,ms);
}
function renderEmpleados(){
  applyNominaConfigToUI();
  const b=document.getElementById('nemp-body'); if(!b) return;
  const per=document.getElementById('nom-periodo')?.value||hoyISO().slice(0,7);
  b.innerHTML = NOMINA_EMPLEADOS.length? NOMINA_EMPLEADOS.map(e=>{
    const m=mesesAntiguedad(e.fecha,per,e.fechaSalida), fr=m>=12;
    const desc=[e.quiro?`Quiro. $${fmt(e.quiro)}`:'',e.prestamo?`Empresa $${fmt(e.prestamo)}`:'',
      e.extConyuge?`Cónyuge $${fmt(round2(e.sueldo*NOMINA_CONFIG.extensionConyuge/100))}`:''].filter(Boolean);
    return `<tr>
      <td data-label="Nombre">${esc(e.nombre)}</td><td data-label="Cédula" class="mono small">${esc(e.cedula||'-')}</td>
      <td data-label="Cargo">${esc(e.cargo||'-')}</td><td data-label="Sueldo" class="num">$${fmt(e.sueldo)}</td>
      <td data-label="Ingreso">${e.fecha?fmtDate(e.fecha):'-'}</td>
      <td data-label="Salida">${e.fechaSalida?fmtDate(e.fechaSalida):'-'}</td>
      <td data-label="Estado"><span class="badge ${e.activo?'badge-green':'badge-red'}">${e.activo?'Activo':'Inactivo'}</span></td>
      <td data-label="F. Reserva">${fr?`<span class="badge badge-green">${e.frModo==='mensual'?'Mensualizado':'Acumulado'}</span>`:`<span class="badge badge-amber">Aún no (${m}m)</span>`}</td>
      <td data-label="Descuentos" class="text-muted small">${desc.join(' · ')||'-'}</td>
      <td data-label="Acción"><button class="btn btn-ghost btn-sm" onclick="editEmpleado(${e.id})">Editar</button>
        <button class="btn btn-danger btn-sm" onclick="deleteEmpleado(${e.id})">Eliminar</button></td></tr>`;
  }).join('') : '<tr><td colspan="10" class="empty">Sin empleados registrados.</td></tr>';
}

/* ============================================================
   FIX #3: Fondos de Reserva — se calcula automáticamente
   para empleados con >=12 meses de antigüedad, sin necesidad
   del checkbox. El checkbox ahora funciona como "excluir FR"
   (para casos excepcionales donde no se desea incluir FR
   aunque el empleado sea elegible). Por defecto está
   desmarcado (FR se incluye automáticamente).
   ============================================================ */
function calcularNomina(){
  const per=document.getElementById('nom-periodo').value;
  /* El checkbox ahora es "excluir FR" — si está marcado, NO se incluye FR.
     Por defecto está desmarcado, así que FR se incluye automáticamente
     para empleados con >=12 meses de antigüedad. */
  const excluirFR=document.getElementById('nom-incluir-fr').checked;
  /* Incluir empleados activos Y también los que tienen fechaSalida dentro del período actual */
  const [py,pm]=per.split('-').map(Number);
  const perInicio=new Date(py,pm-1,1), perFin=new Date(py,pm,0);
  const act=NOMINA_EMPLEADOS.filter(e=>{
    if(e.activo) return true;
    if(e.fechaSalida){
      const fs=new Date(e.fechaSalida+'T00:00:00');
      return fs>=perInicio && fs<=perFin;
    }
    return false;
  });
  if(!act.length) return showToast('No hay empleados activos para este período','err');
  const c=NOMINA_CONFIG;
  const detalle=act.map(e=>{
    const [py2,pm2]=per.split('-').map(Number);
    const diasEnMes=new Date(py2,pm2,0).getDate();
    /* Calcular prorrateo por ingreso/salida a mitad de mes */
    let diasTrabajados=diasEnMes;
    const fIng=e.fecha?new Date(e.fecha+'T00:00:00'):null;
    const fSal=e.fechaSalida?new Date(e.fechaSalida+'T00:00:00'):null;
    if(fIng&&!isNaN(fIng)&&fIng.getFullYear()===py2&&fIng.getMonth()===pm2-1){
      /* Ingresó a mitad de mes: días desde la fecha de ingreso hasta fin de mes */
      diasTrabajados=diasEnMes-fIng.getDate()+1;
    }
    if(fSal&&!isNaN(fSal)&&fSal.getFullYear()===py2&&fSal.getMonth()===pm2-1){
      /* Salió a mitad de mes: días desde inicio hasta la fecha de salida */
      const diasSal=fSal.getDate();
      /* Si también ingresó este mes, tomar el menor rango */
      if(fIng&&!isNaN(fIng)&&fIng.getFullYear()===py2&&fIng.getMonth()===pm2-1){
        diasTrabajados=Math.min(diasSal-fIng.getDate()+1, diasTrabajados);
      } else {
        diasTrabajados=diasSal;
      }
    }
    const factor=round2(diasTrabajados/diasEnMes);
    const sueldo=round2(e.sueldo*factor), personal=round2(sueldo*c.personal/100), patronal=round2(sueldo*c.patronal/100);
    const d13=round2(e.sueldo/12*factor), d14=round2(c.sbu/12*factor), vac=round2(e.sueldo/24*factor);
    const meses=mesesAntiguedad(e.fecha,per,e.fechaSalida);
    /* FR se aplica automáticamente si antigüedad >= 12 meses y no se ha marcado "excluir FR" */
    const aplicaFR=meses>=12 && !excluirFR;
    const fr=aplicaFR?round2(sueldo*c.fondoReserva/100):0;
    const frMensual=(aplicaFR&&(e.frModo||'acumulado')==='mensual')?fr:0, frAcum=aplicaFR?round2(fr-frMensual):0;
    const d13M=(e.d13Modo==='mensual')?d13:0, d13A=round2(d13-d13M);
    const d14M=(e.d14Modo==='mensual')?d14:0, d14A=round2(d14-d14M);
    const quiro=round2(e.quiro||0), prestamo=round2(e.prestamo||0);
    /* Para empleados con fecha de salida, prorratear también quirografario y préstamo */
    const quiroPror=fSal&&!isNaN(fSal)&&fSal<=perFin?round2(quiro*factor):quiro;
    const prestamoPror=fSal&&!isNaN(fSal)&&fSal<=perFin?round2(prestamo*factor):prestamo;
    const ext=e.extConyuge?round2(sueldo*c.extensionConyuge/100):0, anticipo=0;
    const deduc=round2(personal+quiroPror+prestamoPror+ext+anticipo);
    const netoBase=round2(sueldo-deduc);
    return {...e,sueldo,personal,patronal,d13,d14,vac,meses,aplicaFR,fr,frMensual,frAcum,
      d13M,d13A,d14M,d14A,quiro:quiroPror,prestamo:prestamoPror,ext,anticipo,deduc,netoBase,
      diasTrabajados,factor,
      neto:round2(netoBase+frMensual+d13M+d14M)};
  });
  nomCalc={periodo:per,detalle,tot:totalesNomina(detalle)};
  renderNominaPreview();
}
function totalesNomina(d){
  const k=['sueldo','personal','patronal','d13','d14','vac','fr','frMensual','frAcum','d13M','d13A','d14M','d14A','quiro','prestamo','ext','anticipo','neto','netoBase'];
  const t={}; k.forEach(x=>t[x]=round2(d.reduce((a,r)=>a+(+r[x]||0),0))); return t;
}
function actualizarModoNomina(id,campo,modo){
  const r=nomCalc.detalle.find(x=>x.id===id); if(!r) return;
  if(campo==='fr'){ if(!r.aplicaFR) return; r.frMensual=modo==='mensual'?r.fr:0; r.frAcum=round2(r.fr-r.frMensual); }
  if(campo==='d13'){ r.d13M=modo==='mensual'?r.d13:0; r.d13A=round2(r.d13-r.d13M); r.d13Modo=modo; }
  if(campo==='d14'){ r.d14M=modo==='mensual'?r.d14:0; r.d14A=round2(r.d14-r.d14M); r.d14Modo=modo; }
  const e=NOMINA_EMPLEADOS.find(x=>x.id===id);
  if(e){ e[campo==='fr'?'frModo':campo==='d13'?'d13Modo':'d14Modo']=modo; persistEmpleados(); }
  r.neto=round2(r.netoBase+r.frMensual+r.d13M+r.d14M);
  nomCalc.tot=totalesNomina(nomCalc.detalle); renderNominaPreview();
}
function actualizarAnticipo(id,v){
  const r=nomCalc.detalle.find(x=>x.id===id); if(!r) return;
  r.anticipo=round2(v||0);
  r.deduc=round2(r.personal+r.quiro+r.prestamo+r.ext+r.anticipo);
  r.netoBase=round2(r.sueldo-r.deduc);
  r.neto=round2(r.netoBase+r.frMensual+r.d13M+r.d14M);
  nomCalc.tot=totalesNomina(nomCalc.detalle); renderNominaPreview();
}
function renderNominaPreview(){
  const c=document.getElementById('nom-preview'); if(!c||!nomCalc) return;
  const {periodo,detalle,tot}=nomCalc, hecho=!!NOMINA_RUNS[periodo];
  /* Calcular totales del asiento para el preview */
  const _frM=tot.frMensual||0, _d13M=tot.d13M||0, _d14M=tot.d14M||0;
  const _frAcum=tot.frAcum||(tot.fr?round2(tot.fr-_frM):0);
  const _d13A=tot.d13A||(tot.d13?round2(tot.d13-_d13M):0);
  const _d14A=tot.d14A||(tot.d14?round2(tot.d14-_d14M):0);
  const totalDebe=round2(tot.sueldo+tot.patronal+tot.d13+tot.d14+tot.vac+tot.fr);
  const totalHaber=round2(tot.netoBase+_frM+_d13M+_d14M+(tot.personal+tot.patronal+(tot.quiro||0)+(tot.ext||0))+(tot.anticipo||0)+(tot.prestamo||0)+_d13A+_d14A+(tot.vac||0)+_frAcum);
  const diff=round2(totalDebe-totalHaber), cuadra=Math.abs(diff)<0.01;
  const selFR=r=>hecho?`<span class="badge badge-green">${r.frMensual?'Mensual':'Acumulado'}</span>`:
    `<select style="font-size:11px;padding:3px" onchange="actualizarModoNomina(${r.id},'fr',this.value)">
      <option value="acumulado" ${r.frMensual?'':'selected'}>Acumular</option><option value="mensual" ${r.frMensual?'selected':''}>Mensualizar</option></select>`;
  const selD=(r,k)=>hecho?`<span class="badge badge-green">${r[k+'M']?'Mensual':'Acumulado'}</span>`:
    `<select style="font-size:11px;padding:3px" onchange="actualizarModoNomina(${r.id},'${k}',this.value)">
      <option value="acumulado" ${r[k+'M']?'':'selected'}>Acumular</option><option value="mensual" ${r[k+'M']?'selected':''}>Mensualizar</option></select>`;
  c.innerHTML=`<div class="table-wrap"><table class="rtable"><thead><tr>
      <th>Empleado</th><th class="num">Sueldo</th><th class="num">Ap. Personal</th><th>F. Reserva</th>
      <th class="num">Préstamo Quiro.</th><th class="num">Préstamo Empresa</th><th class="num">Ext. Cónyuge</th>
      <th class="num">Anticipo</th><th class="num">Neto a Pagar</th><th class="num">Ap. Patronal</th>
      <th>Décimo 13°</th><th>Décimo 14°</th><th class="num">Prov. Vacaciones</th><th>Rol</th></tr></thead>
    <tbody>${detalle.map((r,i)=>`<tr>
      <td data-label="Empleado">${esc(r.nombre)}</td><td data-label="Sueldo" class="num">$${fmt(r.sueldo)}</td>
      <td data-label="Ap. Personal" class="num">$${fmt(r.personal)}</td>
      <td data-label="F. Reserva">${r.aplicaFR?'$'+fmt(r.fr)+' '+selFR(r):`<span class="text-muted small">No aplica (${r.meses}m)</span>`}</td>
      <td data-label="Quiro." class="num">${r.quiro?'$'+fmt(r.quiro):'-'}</td>
      <td data-label="Préstamo" class="num">${r.prestamo?'$'+fmt(r.prestamo):'-'}</td>
      <td data-label="Cónyuge" class="num">${r.ext?'$'+fmt(r.ext):'-'}</td>
      <td data-label="Anticipo" class="num">${hecho?'$'+fmt(r.anticipo):`<input type="number" class="num" step="0.01" min="0" style="width:88px" value="${r.anticipo||''}" placeholder="0.00" onchange="actualizarAnticipo(${r.id},this.value)">`}</td>
      <td data-label="Neto" class="num"><strong>$${fmt(r.neto)}</strong></td>
      <td data-label="Ap. Patronal" class="num">$${fmt(r.patronal)}</td>
      <td data-label="13°">$${fmt(r.d13)} ${selD(r,'d13')}</td>
      <td data-label="14°">$${fmt(r.d14)} ${selD(r,'d14')}</td>
      <td data-label="Vacaciones" class="num">$${fmt(r.vac)}</td>
      <td data-label="Rol"><button class="btn btn-ghost btn-sm" onclick="exportRolIndividual(${i})"> PDF</button></td></tr>`).join('')}</tbody>
    <tfoot><tr><td>TOTAL (${detalle.length})</td><td class="num">$${fmt(tot.sueldo)}</td><td class="num">$${fmt(tot.personal)}</td>
      <td class="num">$${fmt(tot.fr)}</td><td class="num">$${fmt(tot.quiro)}</td><td class="num">$${fmt(tot.prestamo)}</td>
      <td class="num">$${fmt(tot.ext)}</td><td class="num">$${fmt(tot.anticipo)}</td><td class="num">$${fmt(tot.neto)}</td>
      <td class="num">$${fmt(tot.patronal)}</td><td class="num">$${fmt(tot.d13)}</td><td class="num">$${fmt(tot.d14)}</td>
      <td class="num">$${fmt(tot.vac)}</td><td></td></tr></tfoot></table></div>
    <div class="asiento-total"><span>Total DEBE (gasto): <strong class="debe">$${fmt(totalDebe)}</strong></span><span style="margin-left:18px">Total HABER (obligaciones): <strong class="haber">$${fmt(totalHaber)}</strong></span><span style="margin-left:18px" class="${cuadra?'haber':'debe'}">${cuadra?'✓ Cuadra':'⚠ Diferencia $'+fmt(Math.abs(diff))}</span></div>
    <div class="modal-actions start">
      <button class="btn btn-ghost" onclick="exportRolGeneralPDF()"> Rol General (PDF)</button>
      <button class="btn btn-ghost" onclick="exportRolesIndividuales()"> Roles Individuales</button>
      ${hecho?`<span class="badge badge-green" style="padding:8px 14px">✓ ${periodLabel(periodo)} contabilizada</span>
        <button class="btn btn-danger btn-sm" onclick="revertirNomina('${periodo}')">↺ Revertir</button>`
       :`<button class="btn btn-primary" onclick="abrirRevisionNomina()"> Revisar y contabilizar</button>`}</div>`;
}
function construirLineasNomina(t){
  /* Mensualización: FR/D13/D14 mensualizados se pagan vía Sueldos por Pagar,
     solo la porción ACUMULADA va a su cuenta por pagar respectiva.
     Sueldos por Pagar = netoBase + frMensual + d13M + d14M
     FR por Pagar = frAcum (= fr - frMensual)
     D13 por Pagar = d13A (= d13 - d13M)
     D14 por Pagar = d14A (= d14 - d14M) */
  const frM=t.frMensual||0, d13M=t.d13M||0, d14M=t.d14M||0;
  const frAcum=t.frAcum||(t.fr?round2(t.fr-frM):0);
  const d13A=t.d13A||(t.d13?round2(t.d13-d13M):0);
  const d14A=t.d14A||(t.d14?round2(t.d14-d14M):0);
  const sueldosPagarH=round2(t.netoBase+frM+d13M+d14M);
  return [
    /* --- DEBE (Gastos y provisiones) --- */
    {...CTA_N.sueldos,cta:CTA_N.sueldos.cod,debe:t.sueldo,haber:0},
    {...CTA_N.patronal,cta:CTA_N.patronal.cod,debe:t.patronal,haber:0},
    {...CTA_N.d13,cta:CTA_N.d13.cod,debe:t.d13,haber:0},
    {...CTA_N.d14,cta:CTA_N.d14.cod,debe:t.d14,haber:0},
    {...CTA_N.vac,cta:CTA_N.vac.cod,debe:t.vac,haber:0},
    {...CTA_N.frGasto,cta:CTA_N.frGasto.cod,debe:t.fr,haber:0},
    /* --- HABER (Obligaciones por pagar) --- */
    {...CTA_N.sueldosPagar,cta:CTA_N.sueldosPagar.cod,debe:0,haber:sueldosPagarH},
    {...CTA_N.iessPagar,cta:CTA_N.iessPagar.cod,debe:0,haber:round2(t.personal+t.patronal+(t.quiro||0)+(t.ext||0))},
    {...CTA_N.anticipos,cta:CTA_N.anticipos.cod,debe:0,haber:t.anticipo||0},
    {...CTA_N.prestamos,cta:CTA_N.prestamos.cod,debe:0,haber:t.prestamo||0},
    {...CTA_N.d13Pagar,cta:CTA_N.d13Pagar.cod,debe:0,haber:d13A},
    {...CTA_N.d14Pagar,cta:CTA_N.d14Pagar.cod,debe:0,haber:d14A},
    {...CTA_N.vacPagar,cta:CTA_N.vacPagar.cod,debe:0,haber:t.vac||0},
    {...CTA_N.frPagar,cta:CTA_N.frPagar.cod,debe:0,haber:frAcum}
  ].map(l=>({cta:l.cta,nom:l.nom,debe:round2(l.debe),haber:round2(l.haber)})).filter(l=>l.debe>0||l.haber>0);
}
function abrirRevisionNomina(){
  if(!nomCalc) return showToast('Calcula primero el rol','err');
  if(NOMINA_RUNS[nomCalc.periodo]) return showToast('Este período ya fue contabilizado','err');
  revLineas=construirLineasNomina(nomCalc.tot).map(l=>({...l}));
  const tot=nomCalc.tot;
  const _frM=tot.frMensual||0, _d13M=tot.d13M||0, _d14M=tot.d14M||0;
  const _frAcum=tot.frAcum||(tot.fr?round2(tot.fr-_frM):0);
  const _d13A=tot.d13A||(tot.d13?round2(tot.d13-_d13M):0);
  const _d14A=tot.d14A||(tot.d14?round2(tot.d14-_d14M):0);
  const _sueldosPagarH=round2(tot.netoBase+_frM+_d13M+_d14M);
  const mensualInfo=(_frM||_d13M||_d14M)?`<br><span class="text-muted small">📥 Mensualización: Sueldos por Pagar incluye FR mensualizado $${fmt(_frM)}, D13 mensualizado $${fmt(_d13M)}, D14 mensualizado $${fmt(_d14M)}. Las cuentas por pagar solo reflejan la porción acumulada.</span>`:'';
  document.getElementById('revision-nomina-info').innerHTML=`<strong>Nómina ${esc(periodLabel(nomCalc.periodo))}</strong> · ${nomCalc.detalle.length} empleado(s)<br>
    <span class="text-muted">Revisa y ajusta las líneas antes de aprobar.</span>${mensualInfo}`;
  renderRevLineas(); openModal('modal-revision-nomina');
}
function renderRevLineas(){
  document.getElementById('revision-nomina-lineas').innerHTML=revLineas.map((l,i)=>`<div class="line-editor">
    <select onchange="updRev(${i},'cta',this.value)">${accountOptions(l.cta)}</select>
    <input type="number" class="num" step="0.01" min="0" value="${l.debe||''}" placeholder="Debe" oninput="updRev(${i},'debe',this.value)">
    <input type="number" class="num" step="0.01" min="0" value="${l.haber||''}" placeholder="Haber" oninput="updRev(${i},'haber',this.value)">
    <button class="btn btn-ghost btn-sm" onclick="quitarRev(${i})">✕</button></div>`).join('');
  balRev();
}
function updRev(i,c,v){ const l=revLineas[i]; if(!l) return; if(c==='cta'){const[a,b]=v.split('|');l.cta=a;l.nom=b;}else l[c]=round2(v||0); balRev(); }
function quitarRev(i){ revLineas.splice(i,1); renderRevLineas(); }
function agregarLineaRevisionNomina(){ revLineas.push({cta:'',nom:'',debe:0,haber:0}); renderRevLineas(); }
function balRev(){
  const d=round2(revLineas.reduce((a,l)=>a+(+l.debe||0),0)), h=round2(revLineas.reduce((a,l)=>a+(+l.haber||0),0)), ok=Math.abs(d-h)<0.01;
  const e=document.getElementById('revision-nomina-balance');
  e.style.background=ok?'rgba(15,159,110,.15)':'rgba(212,63,94,.15)'; e.style.color=ok?'var(--green)':'var(--red)';
  e.innerHTML=`DEBE: <strong>$${fmt(d)}</strong> · HABER: <strong>$${fmt(h)}</strong> · ${ok?'✓ Cuadra':' Diferencia $'+fmt(Math.abs(d-h))}`;
  document.getElementById('revision-nomina-aprobar-btn').disabled=!ok||!revLineas.length;
}
function aprobarYContabilizarNomina(){
  if(!nomCalc) return;
  const {periodo,tot,detalle}=nomCalc;
  const lines=revLineas.filter(l=>l.cta&&(l.debe>0||l.haber>0));
  const d=round2(lines.reduce((a,l)=>a+l.debe,0)), h=round2(lines.reduce((a,l)=>a+l.haber,0));
  if(!lines.length||Math.abs(d-h)>=0.01) return showToast('El asiento no cuadra','err');
  const id=Date.now(), ref=`NOM-${periodo}`;
  MANUAL_ASIENTOS.push({id,fecha:ultimoDiaMes(periodo),periodo,ref,
    concepto:`Rol de pagos ${periodLabel(periodo)} - sueldos, aportes IESS y provisiones sociales (${detalle.length} empleados)`,
    lines,createdAt:new Date().toISOString(),nomina:true});
  persistManuales();
  NOMINA_RUNS[periodo]={manualId:id,ref,fecha:ultimoDiaMes(periodo),totales:tot,detalle,cantEmpleados:detalle.length,creadoEn:new Date().toISOString(),pagos:[]};
  persistRuns(); closeModal('modal-revision-nomina');
  refreshNominaPeriodos(); renderNominaPreview(); renderNominaHistorial(); renderManuales(); initFilters(); refreshAccountingViews();
  showToast(`Nómina de ${periodLabel(periodo)} contabilizada`);
}
function revertirNomina(per){
  const r=NOMINA_RUNS[per]; if(!r) return;
  if((r.pagos||[]).length) return showToast('Revierte primero los pagos registrados','err');
  if(!confirm(`¿Revertir la contabilización de ${periodLabel(per)}?`)) return;
  MANUAL_ASIENTOS=MANUAL_ASIENTOS.filter(a=>a.id!==r.manualId); persistManuales();
  delete NOMINA_RUNS[per]; persistRuns();
  refreshNominaPeriodos(); nomCalc&&renderNominaPreview(); renderNominaHistorial(); renderManuales(); refreshAccountingViews();
  showToast('Contabilización revertida');
}
/* --- Pagos --- */
function lineasPorPagar(t){
  /* Mensualización: SueldosPagar incluye FR/D13/D14 mensualizados.
     FR/D13/D14 por Pagar = solo la porción acumulada (no mensualizada). */
  const frM=t.frMensual||0, d13M=t.d13M||0, d14M=t.d14M||0;
  const frAcum=t.frAcum||(t.fr?round2(t.fr-frM):0);
  const d13A=t.d13A||(t.d13?round2(t.d13-d13M):0);
  const d14A=t.d14A||(t.d14?round2(t.d14-d14M):0);
  const sueldosPagarV=round2((t.netoBase!=null?t.netoBase:round2(t.neto-(t.frMensual||0)))+frM+d13M+d14M);
  return [
    {cta:CTA_N.sueldosPagar.cod,nom:CTA_N.sueldosPagar.nom,valor:sueldosPagarV,porBanco:true},
    {cta:CTA_N.iessPagar.cod,nom:CTA_N.iessPagar.nom,valor:round2(t.personal+t.patronal+(t.quiro||0)+(t.ext||0)),porBanco:true},
    {cta:CTA_N.frPagar.cod,nom:CTA_N.frPagar.nom,valor:frAcum,porBanco:frAcum>0},
    {cta:CTA_N.d13Pagar.cod,nom:CTA_N.d13Pagar.nom,valor:d13A,porBanco:false},
    {cta:CTA_N.d14Pagar.cod,nom:CTA_N.d14Pagar.nom,valor:d14A,porBanco:false},
    {cta:CTA_N.vacPagar.cod,nom:CTA_N.vacPagar.nom,valor:t.vac||0,porBanco:false}
  ].filter(l=>l.valor>0);
}
function saldosPendientes(run){
  const pag={}; (run.pagos||[]).forEach(p=>(p.lineas||[]).forEach(l=>pag[l.cta]=round2((pag[l.cta]||0)+l.valor)));
  return lineasPorPagar(run.totales).map(l=>({...l,pagado:pag[l.cta]||0,pendiente:Math.max(0,round2(l.valor-(pag[l.cta]||0)))}));
}
function abrirModalPagoNomina(per){
  const run=NOMINA_RUNS[per]; if(!run) return;
  pagoPeriodo=per; pagoExtra=0;
  pagoSaldos=saldosPendientes(run).filter(l=>l.pendiente>0.005);
  if(!pagoSaldos.length) return showToast('Nómina cancelada en su totalidad');
  const tot=round2(pagoSaldos.reduce((a,l)=>a+l.pendiente,0));
  document.getElementById('pago-nom-info').innerHTML=`<strong>${esc(run.ref)} · ${esc(periodLabel(per))}</strong><br>
    <span class="text-muted">${run.cantEmpleados} empleado(s) · Pendiente $${fmt(tot)}</span>`;
  document.getElementById('pago-nom-detalle').innerHTML=`<div class="table-wrap" style="max-height:none"><table class="rtable">
    <thead><tr><th></th><th>Cuenta por pagar</th><th class="num">Pendiente</th><th>Monto a pagar</th></tr></thead>
    <tbody>${pagoSaldos.map((l,i)=>`<tr>
      <td data-label=""><input type="checkbox" class="pn-check" data-i="${i}" ${l.porBanco?'checked':''} onchange="updPagoTot()"></td>
      <td data-label="Cuenta"><span class="cuenta-code">${esc(l.cta)}</span> ${esc(l.nom)}${l.porBanco?'':' <span class="badge badge-amber">provisión</span>'}</td>
      <td data-label="Pendiente" class="num">$${fmt(l.pendiente)}</td>
      <td data-label="Monto"><input type="number" class="pn-monto num" data-i="${i}" step="0.01" min="0" max="${l.pendiente}" value="${l.porBanco?l.pendiente.toFixed(2):'0.00'}" ${l.porBanco?'':'disabled'} oninput="updPagoTot()"></td></tr>`).join('')}
    </tbody></table></div>`;
  document.getElementById('pago-nom-extra-lines').innerHTML='';
  document.getElementById('pago-nom-banco').innerHTML=BANCOS.map(c=>`<option value="${c}|${esc(cuentaNom(c))}">${c} - ${esc(cuentaNom(c))}</option>`).join('');
  document.getElementById('pago-nom-fecha').value=hoyISO();
  openModal('modal-pago-nomina'); updPagoTot();
}
function addPagoNominaExtraLine(){
  const c=document.getElementById('pago-nom-extra-lines'); const id='pnx-'+(++pagoExtra);
  const d=document.createElement('div'); d.className='line-editor'; d.dataset.line=id;
  d.innerHTML=`<select class="pnx-cta" onchange="updPagoTot()">${accountOptions()}</select>
    <input class="pnx-debe num" type="number" step="0.01" min="0" placeholder="Debe" oninput="updPagoTot()">
    <input class="pnx-haber num" type="number" step="0.01" min="0" placeholder="Haber" oninput="updPagoTot()">
    <button class="btn btn-ghost btn-sm" onclick="this.parentNode.remove();updPagoTot()">✕</button>`;
  c.appendChild(d); updPagoTot();
}
function updPagoTot(){
  let tot=0;
  document.querySelectorAll('.pn-check').forEach(ch=>{
    const inp=document.querySelector(`.pn-monto[data-i="${ch.dataset.i}"]`); if(!inp) return;
    inp.disabled=!ch.checked; if(ch.checked) tot+=+inp.value||0;
  });
  let eD=0,eH=0;
  document.querySelectorAll('#pago-nom-extra-lines .line-editor').forEach(r=>{ eD+=+r.querySelector('.pnx-debe').value||0; eH+=+r.querySelector('.pnx-haber').value||0; });
  const totD=round2(tot+eD), banco=round2(totD-eH);
  const e=document.getElementById('pago-nom-balance'), b=document.getElementById('pago-nom-confirm-btn');
  if(totD<=0){ e.style.background='rgba(192,122,17,.15)'; e.style.color='var(--amber)'; e.textContent='Marca al menos una cuenta a pagar.'; }
  else if(banco<0){ e.style.background='rgba(212,63,94,.15)'; e.style.color='var(--red)'; e.textContent=' Las líneas en Haber superan el total a cancelar.'; }
  else { e.style.background='rgba(15,159,110,.15)'; e.style.color='var(--green)';
    e.innerHTML=`Total a cancelar (Debe): <strong>$${fmt(totD)}</strong> · Sale de banco/caja: <strong>$${fmt(banco)}</strong>`; }
  b.disabled=!(totD>0&&banco>=0);
}
function confirmarPagoNomina(){
  const run=NOMINA_RUNS[pagoPeriodo]; if(!run) return;
  const fecha=document.getElementById('pago-nom-fecha').value;
  const [bCod,bNom]=document.getElementById('pago-nom-banco').value.split('|');
  if(!fecha) return showToast('Selecciona la fecha de pago','err');
  const pagadas=[];
  document.querySelectorAll('.pn-check:checked').forEach(ch=>{
    const i=+ch.dataset.i, base=pagoSaldos[i], v=round2(document.querySelector(`.pn-monto[data-i="${i}"]`).value||0);
    if(base&&v>0.005) pagadas.push({cta:base.cta,nom:base.nom,valor:Math.min(v,base.pendiente)});
  });
  const extra=[...document.querySelectorAll('#pago-nom-extra-lines .line-editor')].map(r=>{
    const [cta,nom]=r.querySelector('.pnx-cta').value.split('|');
    return {cta,nom,debe:round2(r.querySelector('.pnx-debe').value||0),haber:round2(r.querySelector('.pnx-haber').value||0)};
  }).filter(l=>l.cta&&(l.debe>0||l.haber>0));
  if(!pagadas.length&&!extra.length) return showToast('Selecciona al menos una cuenta','err');
  const totD=round2(pagadas.reduce((a,l)=>a+l.valor,0)+extra.reduce((a,l)=>a+l.debe,0));
  const banco=round2(totD-extra.reduce((a,l)=>a+l.haber,0));
  if(banco<=0) return showToast('El monto neto debe ser mayor a cero','err');
  const lines=[...pagadas.map(l=>({cta:l.cta,nom:l.nom,debe:l.valor,haber:0})),
    ...extra,{cta:bCod,nom:bNom,debe:0,haber:banco}];
  const id=Date.now(), seq=(run.pagos||[]).length+1;
  MANUAL_ASIENTOS.push({id,fecha,periodo:fecha.slice(0,7),ref:`PAGO-NOM-${pagoPeriodo}${seq>1?'-'+seq:''}`,
    concepto:`Pago de nómina ${periodLabel(pagoPeriodo)} - cancelación de ${pagadas.map(l=>l.nom).join(', ')||'obligaciones laborales'}`,
    lines,createdAt:new Date().toISOString(),nomina:true,pagoNomina:true});
  persistManuales();
  run.pagos=[...(run.pagos||[]),{id,fecha,banco:{cod:bCod,nom:bNom},manualId:id,lineas:pagadas,extra,total:banco}];
  persistRuns(); closeModal('modal-pago-nomina');
  renderNominaHistorial(); renderManuales(); initFilters(); refreshAccountingViews();
  showToast('Pago de nómina contabilizado');
}
function revertirPagoNomina(per,pid){
  const run=NOMINA_RUNS[per]; if(!run) return;
  const p=(run.pagos||[]).find(x=>String(x.id)===String(pid)); if(!p) return;
  if(!confirm(`¿Revertir el pago del ${fmtDate(p.fecha)} por $${fmt(p.total||0)}?`)) return;
  MANUAL_ASIENTOS=MANUAL_ASIENTOS.filter(a=>a.id!==p.manualId); persistManuales();
  run.pagos=run.pagos.filter(x=>String(x.id)!==String(pid)); persistRuns();
  renderNominaHistorial(); renderManuales(); refreshAccountingViews(); showToast('Pago revertido');
}

/* ============================================================
   FIX #4: Historial con refs clicables + preview de comprobante
   ============================================================ */
function renderNominaHistorial(){
  const c=document.getElementById('nom-historial'); if(!c) return;
  const pers=Object.keys(NOMINA_RUNS).sort().reverse();
  c.innerHTML = pers.length? pers.map(per=>{
    const r=NOMINA_RUNS[per], t=r.totales;
    const debe=round2(t.sueldo+t.patronal+t.d13+t.d14+t.vac+(t.fr||0));
    const sal=saldosPendientes(r), pend=round2(sal.reduce((a,l)=>a+l.pendiente,0));
    const pagos=r.pagos||[], comp=pend<=0.01;
    /* Ref del asiento de nómina clicable */
    const refNom=`<a href="#" class="ref-link" onclick="event.preventDefault();previewVoucher('${esc(r.ref)}')">${esc(r.ref)}</a>`;
    return `<div class="asiento-card"><div class="asiento-header">
      <div class="asiento-meta"><div class="asiento-proveedor">${refNom} · ${esc(periodLabel(per))}
        ${comp?'<span class="badge badge-green">Cancelada</span>':pagos.length?`<span class="badge badge-amber">Parcial · pendiente $${fmt(pend)}</span>`:'<span class="badge badge-amber">Pendiente de pago</span>'}</div>
        <div class="asiento-detail"><span> ${fmtDate(r.fecha)}</span><span> ${r.cantEmpleados}</span>
          <span> Gasto $${fmt(debe)}</span><span> Neto $${fmt(t.neto)}</span></div></div>
      <span><button class="btn btn-ghost btn-sm" onclick="exportRolHistorialPDF('${per}')"> Rol General</button>
        <button class="btn btn-ghost btn-sm" onclick="exportRolesHistorialPDF('${per}')"> Individuales</button>
        ${comp?'':`<button class="btn btn-primary btn-sm" onclick="abrirModalPagoNomina('${per}')"> ${pagos.length?'Otro pago':'Registrar pago'}</button>`}
        <button class="btn btn-danger btn-sm" onclick="revertirNomina('${per}')">↺ Revertir</button></span></div>
      ${pagos.length?`<div class="table-wrap" style="max-height:none;border:none"><table class="rtable"><thead><tr><th>Fecha</th><th>Banco</th><th>Cuentas</th><th class="num">Monto</th><th>Ref</th><th></th></tr></thead>
        <tbody>${pagos.map(p=>{
          const pRef=`PAGO-NOM-${per}${(r.pagos||[]).indexOf(p)>0?'-'+((r.pagos||[]).indexOf(p)+1):''}`;
          const pagoRefLink=`<a href="#" class="ref-link" onclick="event.preventDefault();previewVoucher('${esc(pRef)}')">${esc(pRef)}</a>`;
          return `<tr><td data-label="Fecha">${fmtDate(p.fecha)}</td><td data-label="Banco">${esc(p.banco?.nom||'-')}</td>
        <td data-label="Cuentas" class="small">${esc((p.lineas||[]).map(l=>l.nom).join(', '))}</td>
        <td data-label="Monto" class="num">$${fmt(p.total)}</td>
        <td data-label="Ref">${pagoRefLink}</td>
        <td data-label=""><button class="btn btn-ghost btn-sm" onclick="revertirPagoNomina('${per}','${p.id}')">↺</button></td></tr>`;}).join('')}</tbody></table></div>`:''}
      </div>`;
  }).join('') : '<div class="empty">Aún no se ha contabilizado ninguna nómina.</div>';
}

/* ============================================================
   FIX #4: previewVoucher — busca el asiento por ref y lo muestra
   en un modal con opción de imprimir como PDF
   ============================================================ */
function previewVoucher(ref){
  /* Buscar en MANUAL_ASIENTOS por ref */
  const asiento=MANUAL_ASIENTOS.find(a=>a.ref===ref);
  if(!asiento) return showToast('No se encontró el asiento con ref '+ref,'err');
  const d=round2(asiento.lines.reduce((s,l)=>s+l.debe,0));
  const h=round2(asiento.lines.reduce((s,l)=>s+l.haber,0));
  const ok=Math.abs(d-h)<0.01;
  const linesHtml=asiento.lines.map(l=>`<tr>
    <td class="cuenta-code">${esc(l.cta)}</td>
    <td>${esc(l.nom)}</td>
    <td class="num debe">${l.debe?'$'+fmt(l.debe):''}</td>
    <td class="num haber">${l.haber?'$'+fmt(l.haber):''}</td></tr>`).join('');
  const cont=document.getElementById('voucher-preview-content');
  if(!cont) return;
  cont.innerHTML=`
    <div class="voucher-header">
      <div class="voucher-ref">🔖 <strong>${esc(ref)}</strong></div>
      <div class="voucher-date">📅 ${fmtDate(asiento.fecha)} · 📌 ${esc(asiento.periodo)}</div>
      <div class="voucher-concepto">${esc(asiento.concepto)}</div>
    </div>
    <div class="table-wrap" style="max-height:none;border:none">
      <table class="rtable"><thead><tr><th>Código</th><th>Cuenta</th><th class="num">DEBE</th><th class="num">HABER</th></tr></thead>
      <tbody>${linesHtml}</tbody></table>
    </div>
    <div class="asiento-total">
      <span>DEBE: <strong class="debe">$${fmt(d)}</strong></span>
      <span>HABER: <strong class="haber">$${fmt(h)}</strong></span>
      <span class="${ok?'haber':'debe'}">${ok?'✓ Cuadra':'⚠ Diferencia $'+fmt(Math.abs(d-h))}</span>
    </div>`;
  /* Set the PDF button onclick dynamically with the ref */
  const pdfBtn=document.getElementById('voucher-pdf-btn');
  if(pdfBtn) pdfBtn.onclick=()=>exportVoucherPDF(ref);
  openModal('modal-voucher-preview');
}

function exportVoucherPDF(ref){
  const asiento=MANUAL_ASIENTOS.find(a=>a.ref===ref);
  if(!asiento||!window.jspdf) return showToast('No se pudo generar el PDF','err');
  const {jsPDF}=window.jspdf;
  const doc=new jsPDF({unit:'pt'});
  const W=doc.internal.pageSize.getWidth();
  /* Header */
  let y=drawPdfHeader(doc,`Comprobante: ${ref}`,`${EMPRESA.nombre||'CONTSERTRIB'} · ${fmtDate(asiento.fecha)} · Período: ${asiento.periodo}`);
  /* Concepto */
  doc.setFont('helvetica','italic'); doc.setFontSize(9); doc.setTextColor(80);
  const conceptoLines=doc.splitTextToSize(asiento.concepto||'',W-80);
  doc.text(conceptoLines,40,y+4); y+=conceptoLines.length*12+10;
  /* Lines table */
  const hs=['Código','Cuenta','DEBE','HABER'];
  const body=asiento.lines.map(l=>[l.cta,l.nom,l.debe?fmt(l.debe):'',l.haber?fmt(l.haber):'']);
  const d=round2(asiento.lines.reduce((s,l)=>s+l.debe,0));
  const h=round2(asiento.lines.reduce((s,l)=>s+l.haber,0));
  const foot=[{content:'TOTAL',colSpan:2,styles:{fontStyle:'bold'}},fmt(d),fmt(h)];
  const c=(v,i)=>i>=2&&typeof v==='string'&&v?'$'+v:v;
  doc.autoTable({head:[hs],body:body,foot:[foot],showFoot:'lastPage',startY:y,
    Styles:{fontSize:9,cellPadding:5,lineColor:[216,224,234],lineWidth:.5},
    headStyles:{fillColor:[15,61,51],textColor:255,fontStyle:'bold'},
    footStyles:{fillColor:[230,235,245],textColor:20,fontStyle:'bold'},
    alternateRowStyles:{fillColor:[248,250,252]},
    columnStyles:{0:{cellWidth:90},1:{cellWidth:200},2:{halign:'right',cellWidth:80},3:{halign:'right',cellWidth:80}},
    margin:{left:40,right:40}});
  const fy=doc.lastAutoTable.finalY;
  const ok=Math.abs(d-h)<0.01;
  doc.setFont('helvetica','bold'); doc.setFontSize(9);
  doc.setTextColor(ok?15:212,ok?159:63,ok?110:94);
  doc.text(ok?'✓ Asiento cuadrado':'⚠ Diferencia: $'+fmt(Math.abs(d-h)),40,fy+16);
  addPdfPageNumbers(doc);
  doc.save(`${slug(EMPRESA.nombre)}_comprobante_${ref}.pdf`);
}

/* --- PDFs de nómina --- */
function rolGeneralPDF(periodo,detalle,tot){
  const {jsPDF}=window.jspdf; const doc=new jsPDF({orientation:'landscape',unit:'pt'});
  const y=drawPdfHeader(doc,`Rol de Pagos - ${periodLabel(periodo)}`,'Generado: '+new Date().toLocaleDateString('es-EC'));
  const hs=['Empleado','Sueldo','Ap. Personal','F. Reserva','Préstamo Quiro.','Préstamo Empresa','Ext. Cónyuge','Anticipo','Neto a Pagar','Ap. Patronal','Prov. 13°','Prov. 14°','Prov. Vacaciones'];
  const body=detalle.map(r=>[r.nombre,r.sueldo,r.personal,r.fr||0,r.quiro||0,r.prestamo||0,r.ext||0,r.anticipo||0,r.neto,r.patronal,r.d13,r.d14,r.vac]);
  const foot=['TOTAL ('+detalle.length+')',tot.sueldo,tot.personal,tot.fr,tot.quiro,tot.prestamo,tot.ext,tot.anticipo,tot.neto,tot.patronal,tot.d13,tot.d14,tot.vac];
  const c=(v,i)=>i>0&&typeof v==='number'?'$'+v.toFixed(2):v;
  doc.autoTable({head:[hs],body:body.map(r=>r.map(c)),foot:[foot.map(c)],showFoot:'lastPage',startY:y,
    Styles:{fontSize:7,cellPadding:3.5,lineColor:[216,224,234],lineWidth:.5},
    headStyles:{fillColor:[15,61,51],textColor:255,fontStyle:'bold'},
    footStyles:{fillColor:[230,235,245],textColor:20,fontStyle:'bold'},
    alternateRowStyles:{fillColor:[248,250,252]},columnStyles:buildPdfColumnStyles(hs),margin:{left:40,right:40}});
  let fy=doc.lastAutoTable.finalY;
  doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(20);
  doc.text(`Total DEBE (gasto): $${round2(tot.sueldo+tot.patronal+tot.d13+tot.d14+tot.vac+tot.fr).toFixed(2)}`,40,fy+18);
  drawPdfSignatures(doc,fy+18); addPdfPageNumbers(doc);
  doc.save(`${slug(EMPRESA.nombre)}_rol_pagos_${periodo}.pdf`);
}
function exportRolGeneralPDF(){ if(!nomCalc) return showToast('Calcula primero el rol','err'); if(!window.jspdf) return showToast('PDF no disponible','err'); rolGeneralPDF(nomCalc.periodo,nomCalc.detalle,nomCalc.tot); }
function exportRolHistorialPDF(per){ const r=NOMINA_RUNS[per]; if(!r) return; rolGeneralPDF(per,r.detalle||[],r.totales); }
function antiguedadTexto(m){ const a=Math.floor(m/12),x=m%12; return [a?`${a} año${a===1?'':'s'}`:'',(x||!a)?`${x} mes${x===1?'':'es'}`:''].filter(Boolean).join(' y '); }
function drawRolIndividual(doc,periodo,r){
  const y0=drawPdfHeader(doc,`Rol de Pago Individual - ${periodLabel(periodo)}`,'Empleado: '+r.nombre);
  const W=doc.internal.pageSize.getWidth(), half=(W-96)/2;
  doc.setFillColor(248,250,252); doc.setDrawColor(216,224,234);
  doc.roundedRect(40,y0,W-80,56,4,4,'FD');
  const info=[['Nombre:',r.nombre||'-','Cédula:',r.cedula||'-'],['Cargo:',r.cargo||'-','Ingreso:',r.fecha?fmtDate(r.fecha):'-'],
    ['Antigüedad:',r.meses!=null?antiguedadTexto(r.meses):'-','Período:',periodLabel(periodo)]];
  let iy=y0+16;
  info.forEach(row=>{
    doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor(70,80,95); doc.text(row[0],50,iy);
    doc.setFont('helvetica','normal'); doc.setTextColor(20); doc.text(String(row[1]),120,iy);
    doc.setFont('helvetica','bold'); doc.setTextColor(70,80,95); doc.text(row[2],50+half,iy);
    doc.setFont('helvetica','normal'); doc.setTextColor(20); doc.text(String(row[3]),120+half,iy);
    iy+=13;
  });
  const top=y0+70;
  const ing=[['Sueldo básico mensual','$'+fmt(r.sueldo)]];
  if(r.frMensual) ing.push(['Fondo de reserva mensualizado','$'+fmt(r.frMensual)]);
  if(r.d13M) ing.push(['Décimo tercero mensualizado','$'+fmt(r.d13M)]);
  if(r.d14M) ing.push(['Décimo cuarto mensualizado','$'+fmt(r.d14M)]);
  const tIng=round2(r.sueldo+(r.frMensual||0)+(r.d13M||0)+(r.d14M||0));
  const ded=[[`Aporte personal IESS (${fmt(NOMINA_CONFIG.personal)}%)`,'$'+fmt(r.personal)]];
  if(r.quiro) ded.push(['Préstamo quirografario IESS','$'+fmt(r.quiro)]);
  if(r.prestamo) ded.push(['Préstamo de la empresa','$'+fmt(r.prestamo)]);
  if(r.ext) ded.push(['Extensión de seguro al cónyuge','$'+fmt(r.ext)]);
  if(r.anticipo) ded.push(['Anticipo de sueldo','$'+fmt(r.anticipo)]);
  const tDed=round2(r.personal+(r.quiro||0)+(r.prestamo||0)+(r.ext||0)+(r.anticipo||0));
  const st={fontSize:8.5,cellPadding:5,lineColor:[216,224,234],lineWidth:.5};
  doc.autoTable({head:[['INGRESOS','Valor']],body:ing,foot:[['TOTAL INGRESOS','$'+fmt(tIng)]],showFoot:'lastPage',
    startY:top,margin:{left:40,right:40+half+16},tableWidth:half,styles:st,
    headStyles:{fillColor:[15,61,51],textColor:255,fontStyle:'bold'},footStyles:{fillColor:[225,245,235],fontStyle:'bold'},columnStyles:{1:{halign:'right'}}});
  const y1=doc.lastAutoTable.finalY;
  doc.autoTable({head:[['DEDUCCIONES','Valor']],body:ded,foot:[['TOTAL DEDUCCIONES','$'+fmt(tDed)]],showFoot:'lastPage',
    startY:top,margin:{left:40+half+16,right:40},tableWidth:half,styles:st,
    headStyles:{fillColor:[15,61,51],textColor:255,fontStyle:'bold'},footStyles:{fillColor:[252,235,235],fontStyle:'bold'},columnStyles:{1:{halign:'right'}}});
  let y=Math.max(y1,doc.lastAutoTable.finalY)+16;
  doc.setFillColor(11,59,117); doc.roundedRect(40,y,W-80,28,4,4,'F');
  doc.setTextColor(255); doc.setFont('helvetica','bold'); doc.setFontSize(11);
  doc.text('NETO A PAGAR',52,y+18); doc.setFontSize(13);
  doc.text('$'+fmt(round2(tIng-tDed)),W-52,y+18,{align:'right'});
  y+=40; doc.setTextColor(20);
  doc.autoTable({head:[['Aportes y provisiones del empleador (informativo)','Valor']],
    body:[[`Aporte patronal IESS (${fmt(NOMINA_CONFIG.patronal)}%)`,'$'+fmt(r.patronal)],
      ['Provisión décimo tercer sueldo','$'+fmt(r.d13)],['Provisión décimo cuarto sueldo','$'+fmt(r.d14)],
      ['Provisión vacaciones','$'+fmt(r.vac)],...(r.fr?[['Fondo de reserva','$'+fmt(r.fr)]]:[])],
    startY:y,margin:{left:40,right:40},styles:{...st,fontSize:8,textColor:80},
    headStyles:{fillColor:[230,235,245],textColor:20,fontStyle:'bold'},columnStyles:{1:{halign:'right'}}});
  drawPdfSignatures(doc,doc.lastAutoTable.finalY+6);
}
function exportRolIndividual(i){
  if(!nomCalc||!window.jspdf) return showToast('Calcula primero el rol','err');
  const r=nomCalc.detalle[i]; if(!r) return;
  const doc=new window.jspdf.jsPDF({unit:'pt'});
  drawRolIndividual(doc,nomCalc.periodo,r); addPdfPageNumbers(doc);
  doc.save(`${slug(EMPRESA.nombre)}_rol_${slug(r.nombre)}_${nomCalc.periodo}.pdf`);
}
function rolesPDF(periodo,detalle){
  if(!detalle||!detalle.length||!window.jspdf) return showToast('Sin detalle disponible','err');
  const doc=new window.jspdf.jsPDF({unit:'pt'});
  detalle.forEach((r,i)=>{ if(i) doc.addPage(); drawRolIndividual(doc,periodo,r); });
  addPdfPageNumbers(doc);
  doc.save(`${slug(EMPRESA.nombre)}_roles_individuales_${periodo}.pdf`);
}
function exportRolesIndividuales(){ if(!nomCalc) return showToast('Calcula primero el rol','err'); rolesPDF(nomCalc.periodo,nomCalc.detalle); }

/* --- Window exposures --- */
window.renderNomina = renderNomina;
window.abrirRevisionNomina = abrirRevisionNomina;
window.revertirNomina = revertirNomina;
window.abrirModalPagoNomina = abrirModalPagoNomina;
window.revertirPagoNomina = revertirPagoNomina;
window.editEmpleado = editEmpleado;
window.deleteEmpleado = deleteEmpleado;
window.quitarRev = quitarRev;
window.updRev = updRev;
window.exportRolGeneralPDF = exportRolGeneralPDF;
window.exportRolHistorialPDF = exportRolHistorialPDF;
window.exportRolIndividual = exportRolIndividual;
window.exportRolesIndividuales = exportRolesIndividuales;
window.exportRolesHistorialPDF = exportRolesHistorialPDF;

/* Auto-expose window */
window.addPagoNominaExtraLine = addPagoNominaExtraLine;
window.agregarLineaRevisionNomina = agregarLineaRevisionNomina;
window.aprobarYContabilizarNomina = aprobarYContabilizarNomina;
window.calcularNomina = calcularNomina;
window.confirmarPagoNomina = confirmarPagoNomina;
window.onNominaPeriodoChange = onNominaPeriodoChange;
window.resetEmpleadoForm = resetEmpleadoForm;
window.saveEmpleado = saveEmpleado;
window.saveNominaConfig = saveNominaConfig;
window.updPagoTot = updPagoTot;
window.actualizarModoNomina = actualizarModoNomina;
window.actualizarAnticipo = actualizarAnticipo;
window.previewVoucher = previewVoucher;
window.exportVoucherPDF = exportVoucherPDF;