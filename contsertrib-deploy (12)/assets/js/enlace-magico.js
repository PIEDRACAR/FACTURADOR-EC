/* CONTSERTRIB · Enlace Mágico — Split-view comprobantes → asiento */
'use strict';

/* ---------- Estado ---------- */
let EM_SELECTED = null;
let EM_TIPO = 'compras';
let EM_PAGE = 1;
const EM_PERPAGE = 20;

/* ---------- Helpers ---------- */
function emGetComprobantes(tipo, page){
  let data = [];
  if(tipo === 'compras') data = RAW_COMPRAS || [];
  else if(tipo === 'ventas') data = RAW_VENTAS || [];
  else if(tipo === 'retenciones') data = RAW_RET || [];
  
  const start = (page-1)*EM_PERPAGE;
  const end = start + EM_PERPAGE;
  return {
    items: data.slice(start, end),
    total: data.length,
    pages: Math.ceil(data.length / EM_PERPAGE) || 1,
    page
  };
}

function emGetAsiento(tipo, comp){
  if(!comp) return null;
  if(tipo === 'compras' && typeof getAsientoCompra === 'function') return getAsientoCompra(comp);
  if(tipo === 'ventas' && typeof getAsientoVenta === 'function') return getAsientoVenta(comp);
  if(tipo === 'retenciones' && typeof getAsientoRetencion === 'function') return getAsientoRetencion(comp);
  return null;
}

/* ---------- Vista principal ---------- */
function buildEnlaceMagicoView(container){
  let h = '<div class="pane-header"><h2><i class="fa-solid fa-link"></i> Enlace Mágico</h2>';
  h += '<div class="pane-actions">';
  h += '<select id="em-tipo" onchange="cambiarTipoEM()">';
  h += '<option value="compras"'+(EM_TIPO==='compras'?' selected':'')+'>Compras</option>';
  h += '<option value="ventas"'+(EM_TIPO==='ventas'?' selected':'')+'>Ventas</option>';
  h += '<option value="retenciones"'+(EM_TIPO==='retenciones'?' selected':'')+'>Retenciones</option>';
  h += '</select>';
  h += '<input type="text" id="em-search" placeholder="Buscar comprobante..." oninput="buscarEM()" value="">';
  h += '</div></div>';

  /* Split view */
  h += '<div class="em-split">';
  
  /* Panel izquierdo: lista de comprobantes */
  h += '<div class="em-left" id="em-left">';
  h += '<div class="em-list-header"><h3>Comprobantes</h3><span id="em-count"></span></div>';
  h += '<div class="em-list" id="em-list"></div>';
  h += '<div class="em-pagination" id="em-pagination"></div>';
  h += '</div>';
  
  /* Panel derecho: detalle + asiento */
  h += '<div class="em-right" id="em-right">';
  h += '<div class="em-placeholder" id="em-placeholder"><i class="fa-solid fa-arrow-left"></i><p>Selecciona un comprobante de la lista para ver su detalle y asiento contable</p></div>';
  h += '<div class="em-detail" id="em-detail" style="display:none"></div>';
  h += '</div>';
  
  h += '</div>';

  container.innerHTML = h;
  renderEMList();
}

/* ---------- Render lista ---------- */
function renderEMList(){
  const search = (document.getElementById('em-search')?.value||'').toLowerCase();
  const result = emGetComprobantes(EM_TIPO, EM_PAGE);
  
  let items = result.items;
  if(search){
    let allData = [];
    if(EM_TIPO==='compras') allData = RAW_COMPRAS||[];
    else if(EM_TIPO==='ventas') allData = RAW_VENTAS||[];
    else allData = RAW_RET||[];
    items = allData.filter(c => {
      const s = JSON.stringify(c).toLowerCase();
      return s.includes(search);
    });
    result.total = items.length;
    result.pages = Math.ceil(items.length / EM_PERPAGE) || 1;
    items = items.slice((EM_PAGE-1)*EM_PERPAGE, EM_PAGE*EM_PERPAGE);
  }
  
  const countEl = document.getElementById('em-count');
  if(countEl) countEl.textContent = result.total + ' comprobante(s)';
  
  const listEl = document.getElementById('em-list');
  if(!listEl) return;
  
  if(!items.length){
    listEl.innerHTML = '<div class="em-empty">No hay comprobantes para mostrar</div>';
    return;
  }
  
  let h = '';
  items.forEach((c, i) => {
    const num = c.secuencial || c.numero || c.numComprobante || c.claveAcceso || ('#' + ((EM_PAGE-1)*EM_PERPAGE+i+1));
    const fecha = c.fecha || c.fechaEmision || '';
    const total = +(c.total || c.valor || c.baseImponible || 0);
    const ruc = c.ruc || c.rucProveedor || c.identificacion || c.rucCliente || '';
    const nombre = c.razonSocial || c.nombre || c.proveedor || c.cliente || '';
    const sel = EM_SELECTED && (EM_SELECTED.secuencial||EM_SELECTED.numero||EM_SELECTED.claveAcceso||'') === (c.secuencial||c.numero||c.claveAcceso||'');
    
    h += '<div class="em-item'+(sel?' selected':'')+'" onclick="seleccionarEM('+((EM_PAGE-1)*EM_PERPAGE+i)+')">';
    h += '<div class="em-item-num">'+esc(String(num).substring(0,20))+'</div>';
    h += '<div class="em-item-meta">';
    if(fecha) h += '<span class="em-date">'+fmtDate(fecha)+'</span>';
    if(total) h += '<span class="em-amount">$'+fmt(total)+'</span>';
    h += '</div>';
    if(nombre) h += '<div class="em-item-name">'+esc(nombre.substring(0,40))+'</div>';
    if(ruc) h += '<div class="em-item-ruc">'+esc(ruc.substring(0,13))+'</div>';
    h += '</div>';
  });
  listEl.innerHTML = h;
  
  /* Paginación */
  const pagEl = document.getElementById('em-pagination');
  if(pagEl){
    let p = '';
    if(result.pages > 1){
      p += '<button class="btn-sm" onclick="emPage('+(EM_PAGE-1)+')" '+(EM_PAGE<=1?'disabled':'')+'>‹</button>';
      for(let i=1;i<=Math.min(result.pages,7);i++){
        p += '<button class="btn-sm'+(i===EM_PAGE?' active':'')+'" onclick="emPage('+i+')">'+i+'</button>';
      }
      if(result.pages > 7) p += '<span>...</span><button class="btn-sm" onclick="emPage('+result.pages+')">'+result.pages+'</button>';
      p += '<button class="btn-sm" onclick="emPage('+(EM_PAGE+1)+')" '+(EM_PAGE>=result.pages?'disabled':'')+'>›</button>';
    }
    pagEl.innerHTML = p;
  }
}

/* ---------- Selección de comprobante ---------- */
function seleccionarEM(index){
  let allData = [];
  if(EM_TIPO==='compras') allData = RAW_COMPRAS||[];
  else if(EM_TIPO==='ventas') allData = RAW_VENTAS||[];
  else allData = RAW_RET||[];
  
  const search = (document.getElementById('em-search')?.value||'').toLowerCase();
  if(search) allData = allData.filter(c => JSON.stringify(c).toLowerCase().includes(search));
  
  EM_SELECTED = allData[index];
  if(!EM_SELECTED) return;
  renderEMList();
  renderEMDetail();
}

/* ---------- Render detalle ---------- */
function renderEMDetail(){
  const c = EM_SELECTED;
  if(!c) return;
  
  document.getElementById('em-placeholder').style.display = 'none';
  const detail = document.getElementById('em-detail');
  detail.style.display = 'block';
  
  let h = '<div class="em-detail-header">';
  h += '<h3>Detalle del Comprobante</h3>';
  h += '<span class="badge badge-ok">'+EM_TIPO.toUpperCase()+'</span>';
  h += '</div>';
  
  /* Datos del comprobante */
  h += '<div class="em-comp-data"><table class="rtable compact"><tbody>';
  const fields = [
    ['Secuencial', c.secuencial || c.numero || c.numComprobante || ''],
    ['Clave de acceso', c.claveAcceso || ''],
    ['Fecha', c.fecha || c.fechaEmision || ''],
    ['RUC', c.ruc || c.rucProveedor || c.identificacion || c.rucCliente || ''],
    ['Razón Social', c.razonSocial || c.nombre || c.proveedor || c.cliente || ''],
    ['Tipo', c.tipoComprobante || c.tipo || ''],
    ['Base Imponible', c.baseImponible ? '$'+fmt(+c.baseImponible) : ''],
    ['IVA', c.iva || c.valorIva ? '$'+fmt(+(c.iva||c.valorIva||0)) : ''],
    ['ICE', c.ice || c.valorIce ? '$'+fmt(+(c.ice||c.valorIce||0)) : ''],
    ['Total', c.total || c.valor ? '$'+fmt(+(c.total||c.valor||0)) : '']
  ];
  fields.forEach(([k,v]) => {
    if(v) h += '<tr><td class="lbl">'+k+'</td><td>'+esc(String(v))+'</td></tr>';
  });
  h += '</tbody></table></div>';
  
  /* Asiento contable autogenerado */
  const asiento = emGetAsiento(EM_TIPO, c);
  h += '<div class="em-asiento">';
  h += '<h4><i class="fa-solid fa-book"></i> Asiento Contable Autogenerado</h4>';
  if(asiento && asiento.lines && asiento.lines.length){
    h += '<div class="table-wrap"><table class="rtable"><thead><tr><th>Cuenta</th><th>Nombre</th><th class="num">Debe</th><th class="num">Haber</th></tr></thead><tbody>';
    asiento.lines.forEach(l => {
      h += '<tr><td class="mono small">'+esc(l.cta)+'</td><td>'+esc(l.nom)+'</td><td class="num">'+(l.debe?'$'+fmt(l.debe):'')+'</td><td class="num">'+(l.haber?'$'+fmt(l.haber):'')+'</td></tr>';
    });
    const tDebe = round2(asiento.lines.reduce((s,l)=>s+(l.debe||0),0));
    const tHaber = round2(asiento.lines.reduce((s,l)=>s+(l.haber||0),0));
    h += '<tr class="total-row"><td colspan="2"><strong>TOTAL</strong></td><td class="num"><strong>$'+fmt(tDebe)+'</strong></td><td class="num"><strong>$'+fmt(tHaber)+'</strong></td></tr>';
    const diff = round2(tDebe - tHaber);
    if(Math.abs(diff) > 0.01) h += '<tr class="warn-row"><td colspan="4"><i class="fa-solid fa-triangle-exclamation"></i> Diferencia: $'+fmt(diff)+'</td></tr>';
    h += '</tbody></table></div>';
  } else {
    h += '<div class="em-no-asiento"><i class="fa-solid fa-circle-info"></i> No se pudo generar el asiento contable para este comprobante. Verifica que el Plan de Cuentas y la configuración de mapeo estén completos.</div>';
  }
  h += '</div>';
  
  /* Acciones */
  h += '<div class="em-actions">';
  if(asiento && asiento.lines && asiento.lines.length){
    h += '<button class="btn btn-primary" onclick="registrarAsientoEM()"><i class="fa-solid fa-floppy-disk"></i> Registrar Asiento</button>';
  }
  h += '</div>';
  
  detail.innerHTML = h;
}

/* ---------- Registrar asiento desde enlace mágico ---------- */
function registrarAsientoEM(){
  if(!EM_SELECTED) return showToast('Selecciona un comprobante','err');
  const asiento = emGetAsiento(EM_TIPO, EM_SELECTED);
  if(!asiento || !asiento.lines || !asiento.lines.length) return showToast('No hay asiento para registrar','err');
  
  // Verificar si ya existe
  const ref = EM_SELECTED.secuencial || EM_SELECTED.numero || EM_SELECTED.claveAcceso || '';
  const yaExiste = MANUAL_ASIENTOS.some(a => a.ref === ref);
  if(yaExiste) return showToast('Este asiento ya fue registrado','warn');
  
  asiento.ref = ref;
  asiento.periodo = (asiento.fecha || EM_SELECTED.fecha || new Date().toISOString().slice(0,10)).slice(0,7);
  asiento.concepto = asiento.concepto || (EM_TIPO==='compras'?'Compra':'Venta') + ': ' + (EM_SELECTED.razonSocial || EM_SELECTED.nombre || ref);
  asiento.nomina = false;
  
  MANUAL_ASIENTOS.push(asiento);
  persistManuales();
  invalidateEntries();
  refreshAccountingViews();
  showToast('Asiento registrado correctamente');
  renderEMDetail();
}

/* ---------- Navegación ---------- */
function cambiarTipoEM(){
  EM_TIPO = document.getElementById('em-tipo')?.value || 'compras';
  EM_PAGE = 1;
  EM_SELECTED = null;
  renderEMList();
  const detail = document.getElementById('em-detail');
  const ph = document.getElementById('em-placeholder');
  if(detail) detail.style.display = 'none';
  if(ph) ph.style.display = 'block';
}

function emPage(p){
  EM_PAGE = Math.max(1, p);
  renderEMList();
}

function buscarEM(){
  EM_PAGE = 1;
  renderEMList();
}

/* ---------- Exports ---------- */
window.buildEnlaceMagicoView = buildEnlaceMagicoView;
window.cambiarTipoEM = cambiarTipoEM;
window.seleccionarEM = seleccionarEM;
window.emPage = emPage;
window.buscarEM = buscarEM;
window.registrarAsientoEM = registrarAsientoEM;