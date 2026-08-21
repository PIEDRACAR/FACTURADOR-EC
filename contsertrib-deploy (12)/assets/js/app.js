/* =====================================================================
   app.js — CONTSERTRIB Navigation, Theme & Initialization
   Sidebar-based navigation with 7 modules
   ===================================================================== */

/* ---------- THEME ---------- */
function toggleTheme(){
  const h=document.documentElement;
  const cur=h.getAttribute('data-theme');
  const nxt=cur==='dark'?'light':'dark';
  h.setAttribute('data-theme',nxt);
  LS.set(K.theme,nxt);
  updateThemeButtons(nxt);
}
function updateThemeButtons(t){
  const icon=t==='dark'?'☀️':'🌙';
  const label=t==='dark'?'Modo claro':'Modo oscuro';
  const toggleSidebar=document.getElementById('theme-toggle-sidebar');
  const toggleHeader=document.getElementById('theme-toggle');
  if(toggleSidebar){toggleSidebar.textContent=icon+' '+label;}
  if(toggleHeader){toggleHeader.textContent=icon;}
}

/* ---------- SIDEBAR ---------- */
function toggleSidebar(){
  const sb=document.getElementById('sidebar');
  const ov=document.getElementById('sidebar-overlay');
  sb.classList.toggle('open');
  ov.classList.toggle('show');
}
function closeSidebar(){
  const sb=document.getElementById('sidebar');
  const ov=document.getElementById('sidebar-overlay');
  sb.classList.remove('open');
  ov.classList.remove('show');
}

/* ---------- NAVIGATION ---------- */
function showPane(id){
  // Hide all panes
  document.querySelectorAll('.pane').forEach(p=>p.classList.remove('active'));
  // Show target pane
  const pane=document.getElementById('pane-'+id);
  if(pane) pane.classList.add('active');
  // Update nav items
  document.querySelectorAll('.nav-item').forEach(n=>{
    n.classList.toggle('active',n.getAttribute('data-pane')===id);
  });
  // Close sidebar on mobile
  closeSidebar();
  // Render pane content
  renderPane(id);
  // Update header
  updateHeader();
}

function renderPane(id){
  switch(id){
    case 'empresa': loadEmpresa(); break;
    case 'config': loadConfig(); break;
    case 'storage': renderStorage(); break;
    case 'auth': updateAuthUI(); break;
    case 'plancuentas': renderPlanCuentas(); break;
    case 'librodiario': renderDiario(); break;
    case 'manuales': renderManuales(); break;
    case 'descuadrados': renderDescuadrados(); break;
    case 'mayores': renderMayores(); break;
    case 'balance': renderBalance(); break;
    case 'balancegeneral': renderBalanceGeneral(); break;
    case 'eresultados': renderEstadoResultados(); break;
    case 'compras': renderComprasPane(); break;
    case 'proveedores': renderProveedores(); break;
    case 'ventas': renderVentas(); break;
    case 'clientes': renderClientes(); break;
    case 'retenciones': renderRetenciones(); break;
    case 'enlacemagico': renderEnlaceMagico(); break;
    case 'nomina': renderNomina(); break;
    case 'conciliacion': renderConciliacion(); break;
    case 'activos': renderActivosFijos(); break;
    case 'dashboard': renderDashboard(); break;
  }
}

function updateHeader(){
  const emp=getEmpresa();
  const hName=document.getElementById('header-empresa-nombre');
  const hRuc=document.getElementById('header-empresa-ruc');
  const sName=document.getElementById('sb-emp-nombre');
  const sRuc=document.getElementById('sb-emp-ruc');
  if(hName) hName.textContent=emp.nombre||'CONTSERTRIB';
  if(hRuc) hRuc.textContent=emp.ruc?'RUC: '+emp.ruc:'—';
  if(sName) sName.textContent=emp.nombre||'—';
  if(sRuc) sRuc.textContent=emp.ruc?'RUC: '+emp.ruc:'—';
}

/* ---------- MODAL HELPERS ---------- */
/* openModal, closeModal, showToast — defined in core.js (loaded before app.js) */

/* ---------- MISSING FUNCTIONS (Bug #3, #4, #5) ---------- */
function rerenderActivePane(){
  const active=document.querySelector('.pane.active');
  if(!active) return;
  const id=active.id.replace('pane-','');
  renderPane(id);
}

function refreshCuentaFilters(){
  /* Populate diar-cuenta with cod|nom format (matches openConfigModal pattern) */
  const sel=document.getElementById('diar-cuenta');
  if(!sel) return;
  const curVal=sel.value; // preserve current selection
  sel.innerHTML='<option value="">— Todas las cuentas —</option>';
  (PLAN_CUENTAS||[]).forEach(c=>{
    const o=document.createElement('option');
    o.value=c.cod+'|'+c.nom; o.textContent=c.cod+' '+c.nom;
    sel.appendChild(o);
  });
  if(curVal) sel.value=curVal;
}

function renderComprasPane(){
  /* Bug #5: renderCompras was undefined — compras pane now renders via ui.js */
  if(typeof renderStatsTx==='function') renderStatsTx();
  if(typeof filterTx==='function') filterTx();
}

/* ---------- INIT FILTERS / PERIOD SELECTS ---------- */
function initFilters(){
  // Populate period selects
  const periods=getPeriodos();
  document.querySelectorAll('select[id$="-periodo"],select[id$="Periodo"],select[id="man-periodo-filtro"],select[id="man-auto-periodo"]').forEach(sel=>{
    if(!sel.options.length||sel.options.length<=1){
      sel.innerHTML='<option value="">Todos los períodos</option>';
      periods.forEach(p=>{
        const o=document.createElement('option');
        o.value=p;o.textContent=p;
        sel.appendChild(o);
      });
    }
  });
  // Populate cuenta selects (EXCLUDE cfg-cta-* pane selects — loadConfig handles those)
  const pc=PLAN_CUENTAS||[];
  document.querySelectorAll('select[id*="cta-"],select[id*="cuenta"],select[id$="Cuenta"]').forEach(sel=>{
    /* Skip pane-config selects — they are populated by loadConfig() with cod|nom format */
    if(sel.id.startsWith('cfg-cta-')) return;
    if(!sel.options.length){
      /* Use cod|nom format for diario filter (matches filterDiario) */
      const isDiarCuenta=sel.id==='diar-cuenta'||sel.id==='man-auto-cuenta';
      sel.innerHTML='<option value="">— Seleccionar —</option>';
      if(isDiarCuenta){
        pc.forEach(c=>{
          const o=document.createElement('option');
          o.value=c.cod+'|'+c.nom; o.textContent=c.cod+' '+c.nom;
          sel.appendChild(o);
        });
      } else {
        pc.forEach(c=>{
          const o=document.createElement('option');
          o.value=c.cod; o.textContent=c.cod+' '+c.nom;
          sel.appendChild(o);
        });
      }
    }
  });
}

function getPeriodos(){
  return periodosDisponibles();
}

/* ---------- DOMContentLoaded ---------- */
document.addEventListener('DOMContentLoaded',function(){
  // Apply saved theme
  const theme=LS.get(K.theme)||'dark';
  document.documentElement.setAttribute('data-theme',theme);
  updateThemeButtons(theme);

  // Show default pane (Dashboard)
  showPane('dashboard');

  // Init filters
  setTimeout(initFilters,200);

  // Update badges
  updateBadges();

  // Split view resizer for Enlace Mágico
  initSplitResizer('enlace-split','enlace-resizer');

  // Init Supabase if configured
  if(typeof initSupabase==='function') setTimeout(initSupabase,500);
});

/* ---------- WINDOW EXPORTS ---------- */
window.toggleTheme = toggleTheme;
window.rerenderActivePane = rerenderActivePane;
window.refreshCuentaFilters = refreshCuentaFilters;
window.toggleSidebar = toggleSidebar;
window.closeSidebar = closeSidebar;
window.showPane = showPane;

/* ---------- BADGES ---------- */
function updateBadges(){
  const descuadrados=getDescuadrados?getDescuadrados():[];
  const bd=document.getElementById('badge-descuadrados');
  if(bd){
    if(descuadrados.length){bd.style.display='inline-flex';bd.textContent=descuadrados.length;}
    else{bd.style.display='none';}
  }
}

/* ---------- SPLIT RESIZER ---------- */
function initSplitResizer(splitId,resizerId){
  const split=document.getElementById(splitId);
  const resizer=document.getElementById(resizerId);
  if(!split||!resizer) return;
  let startX,startW;
  function onDown(e){
    startX=e.clientX||e.touches[0].clientX;
    startW=split.querySelector('.split-left').offsetWidth;
    document.addEventListener('mousemove',onMove);
    document.addEventListener('mouseup',onUp);
    document.addEventListener('touchmove',onMove);
    document.addEventListener('touchend',onUp);
  }
  function onMove(e){
    const x=e.clientX||e.touches[0].clientX;
    const dx=x-startX;
    const pct=((startW+dx)/split.offsetWidth)*100;
    split.style.gridTemplateColumns=Math.max(20,Math.min(80,pct))+'% 6px '+Math.max(20,100-Math.min(80,pct))+'%';
  }
  function onUp(){
    document.removeEventListener('mousemove',onMove);
    document.removeEventListener('mouseup',onUp);
    document.removeEventListener('touchmove',onMove);
    document.removeEventListener('touchend',onUp);
  }
  resizer.addEventListener('mousedown',onDown);
  resizer.addEventListener('touchstart',onDown);
}