/* CONTSERTRIB · Activos Fijos y Depreciación (SRI Ecuador) */
'use strict';

/* ---------- Datos persistentes ---------- */
const AF_K = 'ct_activos_fijos_v2';
let ACTIVOS_FIJOS = LS.get(AF_K, []);
const saveAF = () => LS.set(AF_K, ACTIVOS_FIJOS);

/* ---------- Grupos SRI de depreciación ---------- */
const SRI_ACTIVOS_GRUPOS = [
  {cod:'1',nom:'Edificaciones',vidaUtil:20,pctAnual:5},
  {cod:'2',nom:'Vehículos',vidaUtil:5,pctAnual:20},
  {cod:'3',nom:'Maquinaria y equipos de producción',vidaUtil:10,pctAnual:10},
  {cod:'4',nom:'Muebles y enseres de oficina',vidaUtil:10,pctAnual:10},
  {cod:'5',nom:'Equipos de computación y software',vidaUtil:3,pctAnual:33.33},
  {cod:'6',nom:'Instalaciones y mejoras',vidaUtil:20,pctAnual:5},
  {cod:'7',nom:'Envases y embalajes',vidaUtil:5,pctAnual:20},
  {cod:'8',nom:'Equipos y muebles de laboratorio',vidaUtil:8,pctAnual:12.5},
  {cod:'9',nom:'Otros activos fijos',vidaUtil:10,pctAnual:10}
];

/* Mapa de grupo → cuentas contables */
const ACTIVO_CUENTA_MAP = {
  '1':{cta:'1.2.1.02',nom:'Edificaciones',depAcum:'1.2.1.09.001'},
  '2':{cta:'1.2.1.05',nom:'Vehículos',depAcum:'1.2.1.09.004'},
  '3':{cta:'1.2.1.06',nom:'Maquinaria y equipos',depAcum:'1.2.1.09.005'},
  '4':{cta:'1.2.1.04',nom:'Muebles y enseres',depAcum:'1.2.1.09.003'},
  '5':{cta:'1.2.1.03',nom:'Equipos de computación',depAcum:'1.2.1.09.002'},
  '6':{cta:'1.2.1.08',nom:'Instalaciones y mejoras',depAcum:'1.2.1.09.006'},
  '7':{cta:'1.2.1.10',nom:'Envases y embalajes',depAcum:'1.2.1.09.006'},
  '8':{cta:'1.2.1.07',nom:'Equipos de oficina',depAcum:'1.2.1.09.006'},
  '9':{cta:'1.2.1.10',nom:'Otros activos fijos',depAcum:'1.2.1.09.006'}
};

/* ---------- Helpers ---------- */
function getGrupo(cod){ return SRI_ACTIVOS_GRUPOS.find(g => g.cod === cod) || SRI_ACTIVOS_GRUPOS[8]; }
function getCtaMap(cod){ return ACTIVO_CUENTA_MAP[cod] || ACTIVO_CUENTA_MAP['9']; }

function calcularDepreciacion(activo){
  const grupo = getGrupo(activo.grupo);
  const costo = +activo.costo || 0;
  const valorResidual = +activo.valorResidual || 0;
  const depreciable = round2(costo - valorResidual);
  const anual = round2(depreciable * grupo.pctAnual / 100);
  const mensual = round2(anual / 12);
  const fechaAdq = new Date(activo.fechaAdq);
  const hoy = new Date();
  const mesesUso = Math.max(0, Math.floor((hoy - fechaAdq) / (30.44 * 86400000)));
  const mesesVidaUtil = grupo.vidaUtil * 12;
  const mesesRestantes = Math.max(0, mesesVidaUtil - mesesUso);
  const depAcumulada = round2(Math.min(mensual * mesesUso, depreciable));
  const valorEnLibros = round2(costo - depAcumulada);
  const totalmenteDepreciado = mesesUso >= mesesVidaUtil;
  return { costo, valorResidual, depreciable, pctAnual: grupo.pctAnual, anual, mensual, mesesUso, mesesVidaUtil, mesesRestantes, depAcumulada, valorEnLibros, totalmenteDepreciado };
}

/* ---------- Registro de activo ---------- */
function registrarActivo(d){
  const a = {
    id: 'AF-' + Date.now(),
    nombre: d.nombre || '', grupo: d.grupo || '9', codigo: d.codigo || '', descripcion: d.descripcion || '',
    costo: +d.costo || 0, valorResidual: +d.valorResidual || 0, fechaAdq: d.fechaAdq || new Date().toISOString().slice(0,10),
    proveedor: d.proveedor || '', factura: d.factura || '', ubicacion: d.ubicacion || '', responsable: d.responsable || '',
    estado: 'activo', fechaBaja: null, motivoBaja: '', depHistorial: [], createdAt: new Date().toISOString()
  };
  ACTIVOS_FIJOS.push(a);
  saveAF();
  renderActivosFijos();
  showToast('Activo fijo registrado correctamente');
  return a;
}

function actualizarActivo(id, datos){
  const idx = ACTIVOS_FIJOS.findIndex(a => a.id === id);
  if(idx < 0) return showToast('Activo no encontrado','err');
  Object.assign(ACTIVOS_FIJOS[idx], datos, {updatedAt: new Date().toISOString()});
  saveAF();
  renderActivosFijos();
  showToast('Activo actualizado');
}

/* ---------- Baja de activo ---------- */
function bajaActivo(id, motivo, precioVenta){
  const idx = ACTIVOS_FIJOS.findIndex(a => a.id === id);
  if(idx < 0) return showToast('Activo no encontrado','err');
  const a = ACTIVOS_FIJOS[idx];
  const dep = calcularDepreciacion(a);
  const valorVenta = +precioVenta || 0;
  a.estado = 'baja';
  a.fechaBaja = new Date().toISOString().slice(0,10);
  a.motivoBaja = motivo || '';
  a.precioVenta = valorVenta;
  saveAF();
  const ctaMap = getCtaMap(a.grupo);
  const ctaGanancia = CONFIG.ctaGananciaActivo || CONFIG_DEFAULT.ctaGananciaActivo;
  const ctaPerdida = CONFIG.ctaPerdidaActivo || CONFIG_DEFAULT.ctaPerdidaActivo;
  const ctaDepAcum = CONFIG.ctaDeprecAcum || ctaMap.depAcum;
  const ctaBanco = CONFIG.ctaBanco || CONFIG_DEFAULT.ctaBanco;
  const lines = [];
  lines.push({cta: ctaDepAcum, nom: cuentaNom(ctaDepAcum)||'Dep. acumulada', debe: dep.depAcumulada, haber: 0});
  if(valorVenta > 0) lines.push({cta: ctaBanco, nom: cuentaNom(ctaBanco)||'Banco', debe: valorVenta, haber: 0});
  lines.push({cta: ctaMap.cta, nom: cuentaNom(ctaMap.cta)||a.nombre, debe: 0, haber: a.costo});
  const resultado = round2(valorVenta + dep.depAcumulada - a.costo);
  if(resultado > 0.01) lines.push({cta: ctaGanancia, nom: cuentaNom(ctaGanancia)||'Ganancia venta activos', debe: 0, haber: resultado});
  else if(resultado < -0.01) lines.push({cta: ctaPerdida, nom: cuentaNom(ctaPerdida)||'Pérdida venta activos', debe: -resultado, haber: 0});
  const asiento = { id: Date.now(), fecha: a.fechaBaja, periodo: a.fechaBaja.slice(0,7), concepto: 'Baja de activo fijo: '+a.nombre, ref: a.codigo||a.id, lines, nomina: false };
  MANUAL_ASIENTOS.push(asiento);
  persistManuales();
  invalidateEntries();
  refreshAccountingViews();
  showToast('Baja de activo registrada con asiento contable');
}

/* ---------- Depreciación mensual (asiento) ---------- */
function generarDepreciacionMensual(periodo){
  if(!periodo) return showToast('Selecciona un período','err');
  const ctaDepGasto = CONFIG.ctaDepreciacion || CONFIG_DEFAULT.ctaDepreciacion;
  const lines = [];
  ACTIVOS_FIJOS.filter(a => a.estado === 'activo').forEach(a => {
    const dep = calcularDepreciacion(a);
    if(dep.totalmenteDepreciado) return;
    const ctaMap = getCtaMap(a.grupo);
    const ctaAcum = CONFIG.ctaDeprecAcum || ctaMap.depAcum;
    lines.push({cta: ctaDepGasto, nom: cuentaNom(ctaDepGasto)||'Depreciación gasto', debe: dep.mensual, haber: 0});
    lines.push({cta: ctaAcum, nom: cuentaNom(ctaAcum)||'Dep. acum. '+a.nombre, debe: 0, haber: dep.mensual});
    if(!a.depHistorial) a.depHistorial = [];
    if(!a.depHistorial.some(h => h.periodo === periodo)){
      a.depHistorial.push({periodo, monto: dep.mensual, fecha: new Date().toISOString(), ctaGasto: ctaDepGasto, ctaAcum});
    }
  });
  if(lines.length === 0) return showToast('No hay activos para depreciar','info');
  const consolidado = {};
  lines.forEach(l => { const k = l.cta; if(!consolidado[k]) consolidado[k] = {cta:l.cta,nom:l.nom,debe:0,haber:0}; consolidado[k].debe = round2(consolidado[k].debe+l.debe); consolidado[k].haber = round2(consolidado[k].haber+l.haber); });
  const asiento = { id: Date.now(), fecha: periodo+'-28', periodo, concepto: 'Depreciación mensual de activos fijos', ref: 'DEP-'+periodo, lines: Object.values(consolidado), nomina: false };
  MANUAL_ASIENTOS.push(asiento);
  persistManuales();
  saveAF();
  invalidateEntries();
  refreshAccountingViews();
  showToast('Depreciación mensual registrada');
}

function eliminarActivo(id){
  const idx = ACTIVOS_FIJOS.findIndex(a => a.id === id);
  if(idx < 0) return;
  ACTIVOS_FIJOS.splice(idx, 1);
  saveAF();
  renderActivosFijos();
  showToast('Activo eliminado');
}

/* ---------- Render principal ---------- */
function renderActivosFijos(){
  const container = document.getElementById('activos-container');
  if(container) buildActivosView(container);
}

/* ---------- Vista HTML ---------- */
function buildActivosView(container){
  const grupos = SRI_ACTIVOS_GRUPOS;
  const activosActivos = ACTIVOS_FIJOS.filter(a => a.estado === 'activo');
  const totalCosto = round2(activosActivos.reduce((s,a) => s + (+a.costo||0), 0));
  const totalDep = round2(activosActivos.reduce((s,a) => s + calcularDepreciacion(a).depAcumulada, 0));
  const totalLibros = round2(totalCosto - totalDep);

  const gf = document.getElementById('af-grupo-filter');
  const ef = document.getElementById('af-estado-filter');
  const grupoFilter = gf ? gf.value : '';
  const estadoFilter = ef ? ef.value : 'activo';
  let filtered = ACTIVOS_FIJOS;
  if(grupoFilter) filtered = filtered.filter(a => a.grupo === grupoFilter);
  if(estadoFilter) filtered = filtered.filter(a => a.estado === estadoFilter);

  let h = '<div class="pane-header"><h2><i class="fa-solid fa-landmark"></i> Activos Fijos</h2>';
  h += '<div class="pane-actions">';
  h += '<select id="af-grupo-filter" onchange="renderActivosFijos()"><option value="">Todos los grupos</option>';
  grupos.forEach(g => { h += '<option value="'+g.cod+'"'+(grupoFilter===g.cod?' selected':'')+'>'+g.cod+'. '+g.nom+' ('+g.pctAnual+'%)</option>'; });
  h += '</select>';
  h += '<select id="af-estado-filter" onchange="renderActivosFijos()"><option value=""'+(estadoFilter===''?' selected':'')+'>Todos</option><option value="activo"'+(estadoFilter==='activo'?' selected':'')+'>Activos</option><option value="baja"'+(estadoFilter==='baja'?' selected':'')+'>Dados de baja</option></select>';
  h += '<button class="btn btn-primary" onclick="openModalActivoFijo()"><i class="fa-solid fa-plus"></i> Nuevo Activo</button>';
  h += '<button class="btn btn-success" onclick="generarDepreciacionMensual(prompt(\'Período (YYYY-MM):\',new Date().toISOString().slice(0,7)))"><i class="fa-solid fa-calculator"></i> Depreciación Mensual</button>';
  h += '</div></div>';

  h += '<div class="af-summary grid-4">';
  h += '<div class="stat-card"><div class="stat-label">Total Activos</div><div class="stat-value">'+ACTIVOS_FIJOS.length+'</div></div>';
  h += '<div class="stat-card"><div class="stat-label">Costo Total</div><div class="stat-value">$'+fmt(totalCosto)+'</div></div>';
  h += '<div class="stat-card"><div class="stat-label">Depreciación Acumulada</div><div class="stat-value">$'+fmt(totalDep)+'</div></div>';
  h += '<div class="stat-card"><div class="stat-label">Valor en Libros</div><div class="stat-value">$'+fmt(totalLibros)+'</div></div>';
  h += '</div>';

  if(filtered.length === 0){
    h += '<div class="empty">No hay activos fijos registrados. Haz clic en "Nuevo Activo" para registrar el primero.</div>';
  } else {
    h += '<div class="table-wrap"><table class="rtable"><thead><tr><th>Código</th><th>Nombre</th><th>Grupo SRI</th><th>Fecha Adq.</th><th class="num">Costo</th><th class="num">Dep. Acum.</th><th class="num">Valor Libros</th><th class="num">% Dep.</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>';
    filtered.forEach(a => {
      const dep = calcularDepreciacion(a);
      const pct = a.costo > 0 ? round2(dep.depAcumulada/a.costo*100) : 0;
      const badge = a.estado==='activo' ? '<span class="badge badge-ok">Activo</span>' : '<span class="badge badge-warn">Baja</span>';
      const btnBaja = a.estado==='activo' ? '<button class="btn btn-danger btn-sm" onclick="bajaActivoFijo(\''+a.id+'\')" title="Dar de baja"><i class="fa-solid fa-circle-minus"></i></button>' : '';
      h += '<tr><td class="mono small">'+esc(a.codigo||a.id)+'</td><td><strong>'+esc(a.nombre)+'</strong></td><td>'+a.grupo+'. '+esc(getGrupo(a.grupo).nom)+'</td><td>'+fmtDate(a.fechaAdq)+'</td><td class="num">$'+fmt(a.costo)+'</td><td class="num">$'+fmt(dep.depAcumulada)+'</td><td class="num"><strong>$'+fmt(dep.valorEnLibros)+'</strong></td><td class="num">'+fmt(pct)+'%</td><td>'+badge+'</td><td><button class="btn-sm" onclick="editActivoFijo(\''+a.id+'\')" title="Editar"><i class="fa-solid fa-pen"></i></button>'+btnBaja+'</td></tr>';
    });
    h += '</tbody></table></div>';
  }

  /* Resumen por grupo */
  h += '<div class="af-por-grupo"><h3>Resumen por Grupo SRI</h3><div class="table-wrap"><table class="rtable"><thead><tr><th>Grupo</th><th>Nombre</th><th>Vida Útil</th><th>% Anual</th><th class="num">Costo Total</th><th class="num">Dep. Acum.</th><th class="num">Valor en Libros</th><th>Cant.</th></tr></thead><tbody>';
  grupos.forEach(g => {
    const items = activosActivos.filter(a => a.grupo === g.cod);
    if(!items.length) return;
    const costoG = round2(items.reduce((s,a)=>s+(+a.costo||0),0));
    const depG = round2(items.reduce((s,a)=>s+calcularDepreciacion(a).depAcumulada,0));
    h += '<tr><td>'+g.cod+'</td><td>'+esc(g.nom)+'</td><td>'+g.vidaUtil+' años</td><td class="num">'+g.pctAnual+'%</td><td class="num">$'+fmt(costoG)+'</td><td class="num">$'+fmt(depG)+'</td><td class="num">$'+fmt(round2(costoG-depG))+'</td><td>'+items.length+'</td></tr>';
  });
  h += '</tbody></table></div></div>';

  container.innerHTML = h;
}

/* ---------- Modal: nuevo/editar activo fijo ---------- */
function openModalActivoFijo(id){
  const a = id ? ACTIVOS_FIJOS.find(x => x.id === id) : null;
  const title = a ? 'Editar Activo Fijo' : 'Registrar Nuevo Activo Fijo';
  let h = '<div class="modal-body"><div class="form-grid">';
  h += '<div class="field"><label>Nombre del activo *</label><input id="af-nombre" value="'+esc(a?a.nombre:'')+'" placeholder="Ej: Vehículo Toyota Hilux 2024"></div>';
  h += '<div class="field"><label>Código interno</label><input id="af-codigo" value="'+esc(a?a.codigo:'')+'" placeholder="Ej: AF-001"></div>';
  h += '<div class="field"><label>Grupo SRI *</label><select id="af-grupo">';
  SRI_ACTIVOS_GRUPOS.forEach(g => { h += '<option value="'+g.cod+'"'+(a&&a.grupo===g.cod?' selected':'')+'>'+g.cod+'. '+g.nom+' ('+g.pctAnual+'% anual)</option>'; });
  h += '</select></div>';
  h += '<div class="field"><label>Fecha de adquisición *</label><input type="date" id="af-fecha" value="'+(a?a.fechaAdq:'')+'"></div>';
  h += '<div class="field"><label>Costo de adquisición *</label><input type="number" id="af-costo" step="0.01" value="'+(a?a.costo:'')+'" placeholder="0.00"></div>';
  h += '<div class="field"><label>Valor residual</label><input type="number" id="af-residual" step="0.01" value="'+(a?a.valorResidual||0:0)+'" placeholder="0.00"></div>';
  h += '<div class="field"><label>Proveedor</label><input id="af-proveedor" value="'+esc(a?a.proveedor:'')+'"></div>';
  h += '<div class="field"><label>N° Factura</label><input id="af-factura" value="'+esc(a?a.factura:'')+'"></div>';
  h += '<div class="field"><label>Ubicación</label><input id="af-ubicacion" value="'+esc(a?a.ubicacion:'')+'" placeholder="Ej: Oficina principal"></div>';
  h += '<div class="field"><label>Responsable</label><input id="af-responsable" value="'+esc(a?a.responsable:'')+'"></div>';
  h += '<div class="field wide"><label>Descripción adicional</label><textarea id="af-descripcion" rows="2">'+esc(a?a.descripcion:'')+'</textarea></div>';
  h += '</div>';
  h += '<div class="modal-actions"><button class="btn btn-primary" onclick="saveActivoFijo(\''+(id||'')+'\')"><i class="fa-solid fa-floppy-disk"></i> '+(a?'Actualizar':'Registrar')+'</button><button class="btn" onclick="closeGenericModal()">Cancelar</button></div>';
  h += '</div>';
  openGenericModal(title, h);
}

function saveActivoFijo(editId){
  const nombre = (document.getElementById('af-nombre')?.value||'').trim();
  const costo = +(document.getElementById('af-costo')?.value||0);
  const grupo = document.getElementById('af-grupo')?.value||'9';
  const fecha = document.getElementById('af-fecha')?.value||'';
  if(!nombre) return showToast('Ingresa el nombre del activo','err');
  if(!costo) return showToast('Ingresa el costo de adquisición','err');
  if(!fecha) return showToast('Ingresa la fecha de adquisición','err');
  const data = {
    nombre, grupo, fechaAdq: fecha, costo,
    codigo: (document.getElementById('af-codigo')?.value||'').trim(),
    valorResidual: +(document.getElementById('af-residual')?.value||0),
    proveedor: (document.getElementById('af-proveedor')?.value||'').trim(),
    factura: (document.getElementById('af-factura')?.value||'').trim(),
    ubicacion: (document.getElementById('af-ubicacion')?.value||'').trim(),
    responsable: (document.getElementById('af-responsable')?.value||'').trim(),
    descripcion: (document.getElementById('af-descripcion')?.value||'').trim()
  };
  if(editId) actualizarActivo(editId, data);
  else registrarActivo(data);
  closeGenericModal();
}

function editActivoFijo(id){ openModalActivoFijo(id); }

function bajaActivoFijo(id){
  const a = ACTIVOS_FIJOS.find(x => x.id === id);
  if(!a) return;
  const dep = calcularDepreciacion(a);
  let h = '<div class="modal-body"><h3>Dar de baja: '+esc(a.nombre)+'</h3>';
  h += '<div class="info-grid"><div><strong>Costo original:</strong> $'+fmt(a.costo)+'</div><div><strong>Depreciación acumulada:</strong> $'+fmt(dep.depAcumulada)+'</div><div><strong>Valor en libros:</strong> $'+fmt(dep.valorEnLibros)+'</div></div>';
  h += '<div class="form-grid"><div class="field"><label>Motivo de baja</label><select id="af-motivo-baja"><option value="venta">Venta</option><option value="deterioro">Deterioro total</option><option value="perdida">Pérdida/robo</option><option value="obsolescencia">Obsolescencia</option><option value="donacion">Donación</option><option value="otro">Otro</option></select></div>';
  h += '<div class="field"><label>Precio de venta (si aplica)</label><input type="number" id="af-precio-venta" step="0.01" value="0" placeholder="0.00"></div></div>';
  h += '<div class="modal-actions"><button class="btn btn-danger" onclick="confirmarBajaActivo(\''+id+'\')"><i class="fa-solid fa-circle-minus"></i> Confirmar Baja</button><button class="btn" onclick="closeGenericModal()">Cancelar</button></div></div>';
  openGenericModal('Baja de Activo Fijo', h);
}

function confirmarBajaActivo(id){
  const motivo = document.getElementById('af-motivo-baja')?.value || 'otro';
  const precio = +(document.getElementById('af-precio-venta')?.value || 0);
  bajaActivo(id, motivo, precio);
  closeGenericModal();
}

/* ---------- Export PDF ---------- */
function exportActivosPDF(){
  if(!window.jspdf) return showToast('PDF no disponible','err');
  const {jsPDF} = window.jspdf;
  const doc = new jsPDF({orientation:'landscape',unit:'pt'});
  const y = drawPdfHeader(doc, 'Registro de Activos Fijos', 'Al '+new Date().toLocaleDateString('es-EC'));
  const headers = ['Código','Nombre','Grupo','Costo','Dep. Acum.','Valor Libros','% Dep.','Estado'];
  const body = ACTIVOS_FIJOS.map(a => {
    const dep = calcularDepreciacion(a);
    const pct = a.costo > 0 ? round2(dep.depAcumulada/a.costo*100) : 0;
    return [a.codigo||a.id, a.nombre, getGrupo(a.grupo).nom, '$'+fmt(a.costo), '$'+fmt(dep.depAcumulada), '$'+fmt(dep.valorEnLibros), fmt(pct)+'%', a.estado];
  });
  doc.autoTable({head:[headers],body,startY:y,margin:{left:40,right:40},styles:{fontSize:7.5,cellPadding:3},headStyles:{fillColor:[15,61,51],textColor:255,fontStyle:'bold'},alternateRowStyles:{fillColor:[248,250,252]}});
  addPdfPageNumbers(doc);
  doc.save(slug(EMPRESA.nombre)+'_activos_fijos.pdf');
}

/* ---------- Exports ---------- */
window.registrarActivo = registrarActivo;
window.actualizarActivo = actualizarActivo;
window.bajaActivo = bajaActivo;
window.eliminarActivo = eliminarActivo;
window.generarDepreciacionMensual = generarDepreciacionMensual;
window.openModalActivoFijo = openModalActivoFijo;
window.saveActivoFijo = saveActivoFijo;
window.editActivoFijo = editActivoFijo;
window.bajaActivoFijo = bajaActivoFijo;
window.confirmarBajaActivo = confirmarBajaActivo;
window.exportActivosPDF = exportActivosPDF;
window.buildActivosView = buildActivosView;
window.renderActivosFijos = renderActivosFijos;