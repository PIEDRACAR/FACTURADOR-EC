/* CONTSERTRIB · Conciliación Bancaria */
'use strict';

/* ---------- Datos persistentes ---------- */
const CONC_K = 'ct_conciliaciones_v2';
let CONCILIACIONES = LS.get(CONC_K, []);
const saveConc = () => LS.set(CONC_K, CONCILIACIONES);

/* ---------- Estado en memoria ---------- */
let CONC_CURRENT = null; // { periodo, saldoLibro, saldoBanco, itemsBanco:[], itemsLibro:[], matched:[], unmatchedLibro:[], unmatchedBanco:[] }
let CONC_PERIODO = '';

/* ---------- Helpers ---------- */
function fmtConcDate(d){ if(!d) return ''; const p=String(d).split('/'); if(p.length===3) return d; return fmtDate(d); }

/* ---------- Obtener movimientos del Libro Diario para la cuenta de banco ---------- */
function getLibroBanco(periodo){
  const ctaBanco = CONFIG.ctaBanco || CONFIG_DEFAULT.ctaBanco;
  const entries = allEntries().filter(e => !periodo || e.periodo === periodo);
  const movs = [];
  entries.forEach(e => {
    e.lines.forEach(l => {
      if(l.cta === ctaBanco){
        movs.push({
          id: 'LB-'+movs.length,
          fecha: e.fecha,
          ref: e.ref || '',
          concepto: e.concepto || e.glosa || '',
          debe: +l.debe || 0,
          haber: +l.haber || 0,
          asiento: e.id,
          source: e.source
        });
      }
    });
  });
  return movs.sort((a,b) => String(a.fecha).localeCompare(String(b.fecha)));
}

/* ---------- Importar estado de cuenta bancario (CSV) ---------- */
function parseBankCSV(text, sep){
  const lines = text.trim().split('\n');
  if(lines.length < 2) return [];
  const delim = sep || (lines[0].includes(';') ? ';' : lines[0].includes('\t') ? '\t' : ',');
  const headers = lines[0].split(delim).map(h => h.trim().replace(/"/g,'').toLowerCase());
  const fechaIdx = headers.findIndex(h => /fecha|date|día|dia/.test(h));
  const refIdx = headers.findIndex(h => /referencia|ref|documento|doc|comprobante|n°|no\./.test(h));
  const conceptoIdx = headers.findIndex(h => /concepto|descripción|descripcion|detalle|glosa|beneficiario|narrative/.test(h));
  const debeIdx = headers.findIndex(h => /^debit|débito|debe|cargo|egreso|retiro|withdrawal/.test(h));
  const haberIdx = headers.findIndex(h => /^credit|crédito|haber|abono|deposit|ingreso|deposito/.test(h));
  const saldoIdx = headers.findIndex(h => /saldo|balance/.test(h));
  
  if(fechaIdx < 0) return []; // necesita al menos fecha
  
  const rows = [];
  for(let i=1; i<lines.length; i++){
    const cols = lines[i].split(delim).map(c => c.trim().replace(/"/g,''));
    if(cols.length < 2) continue;
    const fecha = cols[fechaIdx] || '';
    const ref = refIdx >= 0 ? cols[refIdx] : '';
    const concepto = conceptoIdx >= 0 ? cols[conceptoIdx] : '';
    const monto = debeIdx >= 0 ? parseNumEs(cols[debeIdx]) : 0;
    const montoH = haberIdx >= 0 ? parseNumEs(cols[haberIdx]) : 0;
    const saldo = saldoIdx >= 0 ? parseNumEs(cols[saldoIdx]) : 0;
    rows.push({
      id: 'BC-'+rows.length,
      fecha,
      ref,
      concepto,
      debe: monto,
      haber: montoH,
      saldo,
      _matched: false
    });
  }
  return rows;
}

function parseNumEs(v){
  if(!v) return 0;
  const s = String(v).replace(/[^0-9.,-]/g,'');
  // Ecuador usa coma decimal: 1.234,56 → 1234.56
  if(s.includes(',') && s.includes('.')){
    const lastDot = s.lastIndexOf('.'), lastCom = s.lastIndexOf(',');
    if(lastCom > lastDot) return parseFloat(s.replace(/\./g,'').replace(',','.'));
    return parseFloat(s.replace(/,/g,''));
  }
  if(s.includes(',')) return parseFloat(s.replace(',','.'));
  return parseFloat(s) || 0;
}

/* ---------- Matching automático ---------- */
function autoMatchConc(movsLibro, movsBanco){
  const matched = [];
  const umLibro = [];
  const umBanco = [];
  
  // Mapa de banco por monto+fecha para matching rápido
  const bancoMap = new Map();
  movsBanco.forEach(b => {
    if(b._matched) return;
    const key = round2(b.debe - b.haber).toFixed(2) + '_' + b.fecha;
    if(!bancoMap.has(key)) bancoMap.set(key, []);
    bancoMap.get(key).push(b);
  });
  
  movsLibro.forEach(l => {
    const monto = round2(l.debe - l.haber).toFixed(2);
    const key1 = monto + '_' + l.fecha;
    const key2 = monto + '_' + '';  // sin fecha como fallback
    let found = false;
    
    // Intento 1: monto + fecha exacta
    const cands1 = bancoMap.get(key1);
    if(cands1){
      for(const b of cands1){
        if(!b._matched){
          b._matched = true;
          matched.push({libro:l, banco:b, tipo:'auto-fecha'});
          found = true;
          break;
        }
      }
    }
    
    // Intento 2: monto exacto, cualquier fecha (±3 días)
    if(!found){
      for(const [key, arr] of bancoMap){
        if(!key.startsWith(monto)) continue;
        for(const b of arr){
          if(b._matched) continue;
          const diffDias = Math.abs(dateDiffDays(l.fecha, b.fecha));
          if(diffDias <= 3){
            b._matched = true;
            matched.push({libro:l, banco:b, tipo:'auto-cercano'});
            found = true;
            break;
          }
        }
        if(found) break;
      }
    }
    
    // Intento 3: monto invertido (errores de signo)
    if(!found){
      const invMonto = round2(l.haber - l.debe).toFixed(2);
      const invKey = invMonto + '_' + l.fecha;
      const candsInv = bancoMap.get(invKey);
      if(candsInv){
        for(const b of candsInv){
          if(!b._matched){
            b._matched = true;
            matched.push({libro:l, banco:b, tipo:'auto-invertido'});
            found = true;
            break;
          }
        }
      }
    }
    
    if(!found) umLibro.push(l);
  });
  
  // Banco no matcheados
  movsBanco.forEach(b => { if(!b._matched) umBanco.push(b); });
  
  return { matched, unmatchedLibro: umLibro, unmatchedBanco: umBanco };
}

function dateDiffDays(d1, d2){
  const a = parseDateEC(d1), b = parseDateEC(d2);
  if(!a || !b) return 999;
  return Math.round((a - b) / 86400000);
}

function parseDateEC(s){
  if(!s) return null;
  // dd/mm/yyyy
  const p = String(s).split('/');
  if(p.length === 3) return new Date(+p[2], +p[1]-1, +p[0]);
  // yyyy-mm-dd
  const p2 = String(s).split('-');
  if(p2.length === 3) return new Date(+p2[0], +p2[1]-1, +p2[2]);
  return new Date(s);
}

/* ---------- Calcular conciliación ---------- */
function calcularConciliacion(periodo, movsBanco){
  const movsLibro = getLibroBanco(periodo);
  const ctaBanco = CONFIG.ctaBanco || CONFIG_DEFAULT.ctaBanco;
  
  // Saldo según libro: saldo de la cuenta de banco en mayores
  const ledger = buildLedger(ctaBanco, periodo);
  let saldoLibro = 0;
  if(ledger.length > 0){
    const movs = ledger[0].movs;
    saldoLibro = round2(movs.reduce((a,m) => a + (+m.debe||0) - (+m.haber||0), 0));
  }
  
  // Saldo según banco: último saldo del estado de cuenta
  let saldoBanco = movsBanco.length > 0 ? (movsBanco[movsBanco.length-1].saldo || 0) : 0;
  
  const { matched, unmatchedLibro, unmatchedBanco } = autoMatchConc(movsLibro, movsBanco);
  
  // Ajustes: partidas en libro pero no en banco → restar del saldo libro
  const ajustesLibro = round2(unmatchedLibro.reduce((a,l) => a + (l.debe||0) - (l.haber||0), 0));
  // Depósitos en tránsito: partidas en banco pero no en libro → sumar al saldo libro  
  const ajustesBanco = round2(unmatchedBanco.reduce((a,b) => a + (b.debe||0) - (b.haber||0), 0));
  
  const saldoLibroAjustado = round2(saldoLibro + ajustesBanco);
  const saldoBancoAjustado = round2(saldoBanco + ajustesLibro * (-1)); // reverso
  
  CONC_CURRENT = {
    periodo,
    ctaBanco,
    saldoLibro,
    saldoBanco,
    movsBanco,
    movsLibro,
    matched,
    unmatchedLibro,
    unmatchedBanco,
    ajustesLibro,
    ajustesBanco,
    saldoLibroAjustado,
    saldoBancoAjustado,
    diferencia: round2(saldoLibroAjustado - saldoBancoAjustado)
  };
  
  return CONC_CURRENT;
}

/* ---------- Generar asiento de ajuste por conciliación ---------- */
function generarAsientoConciliacion(){
  if(!CONC_CURRENT) return showToast('Calcula primero la conciliación','err');
  const c = CONC_CURRENT;
  if(Math.abs(c.diferencia) < 0.01) return showToast('La conciliación ya cuadra, no se necesita ajuste','info');
  
  const lines = [];
  const ctaBanco = c.ctaBanco;
  
  // Partidas no identificadas del banco → ajustes al libro
  c.unmatchedBanco.forEach(b => {
    if(b.debe > 0){
      // El banco registró un débito que no está en libro → gasto / cargo
      lines.push({cta: '5.2.1.99', nom: cuentaNom('5.2.1.99') || 'Gastos bancarios varios', debe: 0, haber: b.debe});
      // La cuenta de banco se carga (haber en libro = disminución de activo)
    } else if(b.haber > 0){
      // El banco registró un crédito que no está en libro → ingreso / nota de crédito
      lines.push({cta: '4.2.3', nom: cuentaNom('4.2.3') || 'Otros ingresos', debe: b.haber, haber: 0});
      // La cuenta de banco se acredita (debe en libro = aumento de activo)
    }
  });
  
  if(lines.length === 0) return showToast('No hay partidas pendientes para generar ajuste','info');
  
  // Contrapartida: cuenta de banco
  const totDebe = round2(lines.reduce((a,l) => a + l.debe, 0));
  const totHaber = round2(lines.reduce((a,l) => a + l.haber, 0));
  const diff = round2(totDebe - totHaber);
  if(Math.abs(diff) >= 0.01){
    if(diff > 0) lines.push({cta: ctaBanco, nom: cuentaNom(ctaBanco) || 'Banco', debe: 0, haber: diff});
    else lines.push({cta: ctaBanco, nom: cuentaNom(ctaBanco) || 'Banco', debe: -diff, haber: 0});
  }
  
  // Guardar como asiento manual
  const asiento = {
    fecha: new Date().toISOString().slice(0,10),
    periodo: c.periodo,
    concepto: 'Ajuste por conciliación bancaria',
    ref: 'CONC-' + c.periodo,
    lines,
    nomina: false
  };
  MANUAL_ASIENTOS.push(asiento);
  persistManuales();
  invalidateEntries();
  refreshAccountingViews();
  showToast('Asiento de ajuste generado correctamente');
  renderConciliacion();
}

/* ---------- Guardar conciliación ---------- */
function guardarConciliacion(){
  if(!CONC_CURRENT) return;
  const existing = CONCILIACIONES.findIndex(c => c.periodo === CONC_CURRENT.periodo);
  const rec = {
    periodo: CONC_CURRENT.periodo,
    fecha: new Date().toISOString(),
    saldoLibro: CONC_CURRENT.saldoLibro,
    saldoBanco: CONC_CURRENT.saldoBanco,
    diferencia: CONC_CURRENT.diferencia,
    matchedCount: CONC_CURRENT.matched.length,
    unmatchedLibroCount: CONC_CURRENT.unmatchedLibro.length,
    unmatchedBancoCount: CONC_CURRENT.unmatchedBanco.length
  };
  if(existing >= 0) CONCILIACIONES[existing] = rec;
  else CONCILIACIONES.push(rec);
  saveConc();
  showToast('Conciliación guardada');
}

/* ---------- Vista HTML ---------- */
function buildConciliacionView(container){
  const periodos = periodosDisponibles();
  const currentPer = CONC_PERIODO || (periodos.length > 0 ? periodos[periodos.length-1] : new Date().toISOString().slice(0,7));
  
  let html = `<div class="pane-header">
    <h2><i class="fa-solid fa-building-columns"></i> Conciliación Bancaria</h2>
    <div class="pane-actions">
      <select id="conc-periodo" onchange="CONC_PERIODO=this.value;renderConciliacion()">
        <option value="">-- Período --</option>
        ${periodos.map(p => `<option value="${p}" ${p===currentPer?'selected':''}>${p}</option>`).join('')}
      </select>
      <button class="btn btn-primary" onclick="importarEstadoCuenta()"><i class="fa-solid fa-file-import"></i> Importar Estado de Cuenta</button>
    </div>
  </div>`;
  
  if(!CONC_CURRENT){
    html += `<div class="empty-state">
      <i class="fa-solid fa-scale-balanced fa-3x"></i>
      <h3>Conciliación Bancaria</h3>
      <p>Importa el estado de cuenta bancario (CSV) y selecciona el período para cruzar automáticamente con el Libro Diario.</p>
      <p>El sistema detectará partidas conciliadas y no identificadas, calculando los saldos ajustados.</p>
    </div>`;
  } else {
    const c = CONC_CURRENT;
    const cuadra = Math.abs(c.diferencia) < 0.01;
    html += `
    <div class="conc-summary grid-3">
      <div class="conc-card">
        <div class="conc-card-label">Saldo según Libro</div>
        <div class="conc-card-value ${c.saldoLibro >= 0 ? 'positive' : 'negative'}">$${fmt(c.saldoLibro)}</div>
        <div class="conc-card-sub">Cuenta: ${esc(c.ctaBanco)}</div>
      </div>
      <div class="conc-card">
        <div class="conc-card-label">Saldo según Banco</div>
        <div class="conc-card-value ${c.saldoBanco >= 0 ? 'positive' : 'negative'}">$${fmt(c.saldoBanco)}</div>
        <div class="conc-card-sub">Estado de cuenta</div>
      </div>
      <div class="conc-card ${cuadra ? 'card-success' : 'card-warning'}">
        <div class="conc-card-label">Diferencia</div>
        <div class="conc-card-value">$${fmt(c.diferencia)}</div>
        <div class="conc-card-sub">${cuadra ? '✓ Cuadra' : '⚠ No cuadra'}</div>
      </div>
    </div>
    <div class="conc-detail grid-2">
      <div class="conc-section">
        <h3>Partidas Conciliadas (${c.matched.length})</h3>
        <div class="table-wrap"><table class="rtable"><thead><tr><th>Fecha Libro</th><th>Concepto</th><th>Monto Libro</th><th>Fecha Banco</th><th>Monto Banco</th><th>Tipo</th></tr></thead><tbody>
        ${c.matched.map(m => `<tr><td>${fmtDate(m.libro.fecha)}</td><td>${esc(m.libro.concepto)}</td><td class="num">$${fmt(round2(m.libro.debe-m.libro.haber))}</td><td>${fmtDate(m.banco.fecha)}</td><td class="num">$${fmt(round2(m.banco.debe-m.banco.haber))}</td><td><span class="badge badge-ok">${m.tipo}</span></td></tr>`).join('')}
        </tbody></table></div>
      </div>
      <div>
        <div class="conc-section">
          <h3>En Libro, no en Banco (${c.unmatchedLibro.length})</h3>
          <div class="table-wrap"><table class="rtable"><thead><tr><th>Fecha</th><th>Concepto</th><th>Debe</th><th>Haber</th><th>Asiento</th></tr></thead><tbody>
          ${c.unmatchedLibro.map(l => `<tr><td>${fmtDate(l.fecha)}</td><td>${esc(l.concepto)}</td><td class="num">${l.debe?'$'+fmt(l.debe):''}</td><td class="num">${l.haber?'$'+fmt(l.haber):''}</td><td class="mono small">${esc(l.asiento)}</td></tr>`).join('')}
          </tbody></table></div>
        </div>
        <div class="conc-section">
          <h3>En Banco, no en Libro (${c.unmatchedBanco.length})</h3>
          <div class="table-wrap"><table class="rtable"><thead><tr><th>Fecha</th><th>Concepto</th><th>Debe</th><th>Haber</th></tr></thead><tbody>
          ${c.unmatchedBanco.map(b => `<tr><td>${fmtDate(b.fecha)}</td><td>${esc(b.concepto)}</td><td class="num">${b.debe?'$'+fmt(b.debe):''}</td><td class="num">${b.haber?'$'+fmt(b.haber):''}</td></tr>`).join('')}
          </tbody></table></div>
        </div>
      </div>
    </div>
    <div class="conc-ajustes">
      <h3>Resumen de Ajustes</h3>
      <table class="rtable"><thead><tr><th>Concepto</th><th class="num">Monto</th></tr></thead><tbody>
        <tr><td>Ajustes por partidas en libro no en banco</td><td class="num">$${fmt(c.ajustesLibro)}</td></tr>
        <tr><td>Ajustes por partidas en banco no en libro</td><td class="num">$${fmt(c.ajustesBanco)}</td></tr>
      </tbody><tfoot><tr><td><strong>Saldo Libro Ajustado</strong></td><td class="num"><strong>$${fmt(c.saldoLibroAjustado)}</strong></td></tr>
        <tr><td><strong>Saldo Banco Ajustado</strong></td><td class="num"><strong>$${fmt(c.saldoBancoAjustado)}</strong></td></tr>
        <tr class="${cuadra?'ok':'err'}"><td><strong>Diferencia Final</strong></td><td class="num"><strong>$${fmt(c.diferencia)}</strong></td></tr>
      </tfoot></table>
    </div>
    <div class="conc-actions">
      <button class="btn btn-primary" onclick="guardarConciliacion()"><i class="fa-solid fa-floppy-disk"></i> Guardar Conciliación</button>
      ${!cuadra ? '<button class="btn btn-warning" onclick="generarAsientoConciliacion()"><i class="fa-solid fa-wand-magic-sparkles"></i> Generar Asiento de Ajuste</button>' : ''}
    </div>`;
  }
  
  // Historial
  if(CONCILIACIONES.length > 0){
    html += `<div class="conc-historial">
      <h3>Historial de Conciliaciones</h3>
      <div class="table-wrap"><table class="rtable"><thead><tr><th>Período</th><th>Fecha</th><th class="num">Saldo Libro</th><th class="num">Saldo Banco</th><th class="num">Diferencia</th><th>Conciliadas</th><th>Pendientes Libro</th><th>Pendientes Banco</th></tr></thead><tbody>
      ${CONCILIACIONES.map(r => `<tr><td>${r.periodo}</td><td>${fmtDate(r.fecha)}</td><td class="num">$${fmt(r.saldoLibro)}</td><td class="num">$${fmt(r.saldoBanco)}</td><td class="num ${Math.abs(r.diferencia)<0.01?'ok':'err'}">$${fmt(r.diferencia)}</td><td>${r.matchedCount}</td><td>${r.unmatchedLibroCount}</td><td>${r.unmatchedBancoCount}</td></tr>`).join('')}
      </tbody></table></div>
    </div>`;
  }
  
  container.innerHTML = html;
}

/* ---------- Importar estado de cuenta (file input) ---------- */
function importarEstadoCuenta(){
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.csv,.txt';
  input.onchange = (e) => {
    const file = e.target.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const texto = ev.target.result;
      const periodo = CONC_PERIODO || document.getElementById('conc-periodo')?.value;
      if(!periodo) return showToast('Selecciona un período primero','err');
      const movsBanco = parseBankCSV(texto);
      if(movsBanco.length === 0) return showToast('No se pudieron leer movimientos del archivo. Verifica el formato CSV.','err');
      calcularConciliacion(periodo, movsBanco);
      renderConciliacion();
      showToast(`${movsBanco.length} movimientos bancarios importados`);
    };
    reader.readAsText(file);
  };
  input.click();
}

/* ---------- Export PDF conciliación ---------- */
function exportConcPDF(){
  if(!CONC_CURRENT) return showToast('Calcula primero la conciliación','err');
  if(!window.jspdf) return showToast('PDF no disponible','err');
  const {jsPDF} = window.jspdf;
  const doc = new jsPDF({orientation:'landscape',unit:'pt'});
  const c = CONC_CURRENT;
  const y = drawPdfHeader(doc, 'Conciliación Bancaria - ' + c.periodo, 'Cuenta: ' + c.ctaBanco);
  
  // Resumen
  const summaryData = [
    ['Saldo según Libro', '$'+fmt(c.saldoLibro)],
    ['Saldo según Banco', '$'+fmt(c.saldoBanco)],
    ['Ajustes libro (no en banco)', '$'+fmt(c.ajustesLibro)],
    ['Ajustes banco (no en libro)', '$'+fmt(c.ajustesBanco)],
    ['Saldo Libro Ajustado', '$'+fmt(c.saldoLibroAjustado)],
    ['Saldo Banco Ajustado', '$'+fmt(c.saldoBancoAjustado)],
    ['Diferencia Final', '$'+fmt(c.diferencia)]
  ];
  doc.autoTable({head:[['Concepto','Monto']],body:summaryData,startY:y,margin:{left:40,right:40},
    styles:{fontSize:9,cellPadding:4},headStyles:{fillColor:[15,61,51],textColor:255,fontStyle:'bold'}});
  addPdfPageNumbers(doc);
  doc.save(`${slug(EMPRESA.nombre)}_conciliacion_${c.periodo}.pdf`);
}

/* ---------- Exports ---------- */
window.calcularConciliacion = calcularConciliacion;
window.generarAsientoConciliacion = generarAsientoConciliacion;
window.guardarConciliacion = guardarConciliacion;
window.importarEstadoCuenta = importarEstadoCuenta;
window.exportConcPDF = exportConcPDF;
window.buildConciliacionView = buildConciliacionView;