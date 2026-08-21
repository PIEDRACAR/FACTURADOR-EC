/* ================================================================
   ia.js – Asistente IA + Análisis predictivo local
   CONTSerTrib – Módulo de inteligencia contable mejorado
   ================================================================ */

'use strict';

// ── Historial de chat ──
let IA_HISTORY = [];
const iaActivo = () => !!(CONFIG.iaEndpoint && CONFIG.iaEndpoint.trim());

// ── Cache de respuestas IA (evita llamadas repetidas en la sesión) ──
const IA_CACHE = new Map();
function iaCacheKey(system, message) {
  return btoa(unescape(encodeURIComponent(system + '||' + message))).slice(0, 80);
}

// ── Llamada a IA con timeout, reintento y cache ──
function withTimeout(p, ms) {
  return Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('Tiempo de espera agotado')), ms || 25000))]);
}

async function callIA(system, message, maxTokens, history) {
  if (!iaActivo()) throw new Error('El asistente IA no está configurado. Actívalo en ⚙️ Configuración indicando el endpoint de tu función serverless.');

  const cacheKey = iaCacheKey(system, message);
  if (IA_CACHE.has(cacheKey)) return IA_CACHE.get(cacheKey);

  const body = JSON.stringify({ system, message, maxTokens: maxTokens || 900, history: history || [] });
  let lastErr;

  for (let intento = 0; intento < 2; intento++) {
    try {
      const res = await withTimeout(fetch(CONFIG.iaEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }), 25000);
      if (!res.ok) throw new Error('El asistente respondió con error ' + res.status);
      const d = await res.json();
      const reply = (d.reply || '').trim();
      IA_CACHE.set(cacheKey, reply);
      return reply;
    } catch (e) {
      lastErr = e;
      if (intento === 0) await new Promise(r => setTimeout(r, 800));
    }
  }
  throw lastErr;
}

// ── Contexto financiero mejorado ──
function buildFinancialContext() {
  let bg = {}, er = {}, aux = [];
  try { bg = computeBalanceGeneral(''); } catch (e) { }
  try { er = computeEstadoResultados(''); } catch (e) { }
  try { aux = generarAuxiliares(); } catch (e) { }

  const pendientes = DATA.filter(d => d._ctaCod === '5.2.1.11').length;
  const topGasto = (() => {
    const m = {};
    DATA.forEach(d => { if (d._ctaCod && d._ctaCod !== '5.2.1.11') m[d.CUENTA] = (m[d.CUENTA] || 0) + (+d.TOTAL || 0); });
    const ent = Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 3);
    return ent.map(([c, v]) => `${c}: $${fmt(v)}`).join(' · ') || 'Sin datos';
  })();

  return [
    `Empresa: ${EMPRESA.nombre || '(sin configurar)'} · RUC ${EMPRESA.ruc || '-'} · ${EMPRESA.tipo || '-'}`,
    `Compras: ${DATA.length} (sin clasificar: ${pendientes}) · Ventas: ${DATA_VENTAS.length} · Retenciones: ${DATA_RETENCIONES.length}`,
    `Activo $${fmt(bg.totalActivo || 0)} · Pasivo $${fmt(bg.totalPasivo || 0)} · Patrimonio $${fmt(bg.totalPatrimonio || 0)} · Control $${fmt(bg.diferencia || 0)}`,
    `Ingresos $${fmt(er.totalIngresos || 0)} · Costos $${fmt(er.totalCostos || 0)} · Gastos operacionales $${fmt(er.totalGastosOp || 0)}`,
    `Utilidad bruta $${fmt(er.utilidadBruta || 0)} · Utilidad operacional $${fmt(er.utilidadOperacional || 0)} · Resultado $${fmt(er.resultado || 0)}`,
    `IVA crédito tributario $${fmt(er.totalIVA || 0)}`,
    `Top gastos: ${topGasto}`,
    `Año fiscal: ${EMPRESA.anio || new Date().getFullYear()}`
  ].join('\n');
}

// ════════════════════════════════════════════════════════════════
//  DETECCIÓN DE ANOMALÍAS (100% LOCAL, no requiere IA)
// ════════════════════════════════════════════════════════════════
function detectarAnomalias() {
  const alertas = [];

  // 1. Duplicados exactos por clave SRI
  const vistos = new Set();
  DATA.forEach((d, i) => {
    const clave = `${d.RUC_EMISOR}|${d['NUMERO DE DOCUMENTO']}|${d.FECHA}`;
    if (vistos.has(clave)) alertas.push({ tipo: 'duplicado', severidad: 'alta', idx: i, msg: `Comprobante duplicado: ${d['NUMERO DE DOCUMENTO']} de ${d['RAZON SOCIAL EMISOR']}` });
    else vistos.add(clave);
  });

  // 2. Montos negativos o cero
  DATA.forEach((d, i) => {
    if (+d.TOTAL <= 0) alertas.push({ tipo: 'monto', severidad: 'alta', idx: i, msg: `Comprobante con total ≤ 0: ${d['NUMERO DE DOCUMENTO']}` });
  });

  // 3. IVA inconsistente (> 0 pero BASE IVA = 0)
  DATA.forEach((d, i) => {
    const iva = +d.IVA || 0;
    const base = +d['BASE IVA'] || 0;
    if (iva > 0 && base === 0) alertas.push({ tipo: 'iva', severidad: 'media', idx: i, msg: `IVA ${fmt(iva)} sin base imponible: ${d['NUMERO DE DOCUMENTO']}` });
  });

  // 4. Retenciones sin comprobante de compra
  DATA_RETENCIONES.forEach((r, i) => {
    const match = DATA.find(d => d['NUMERO DE DOCUMENTO'] === r['NUMERO DE DOCUMENTO']);
    if (!match) alertas.push({ tipo: 'retencion_huerfana', severidad: 'media', idx: i, msg: `Retención ${r['NUMERO DE DOCUMENTO']} sin comprobante asociado` });
  });

  // 5. Ventas sin retención esperada (si es proveedor habitual)
  // (Regla opcional: si venta > 1000 y no hay retención)
  DATA_VENTAS.forEach((v, i) => {
    if (+v.TOTAL > 1000) {
      const ret = DATA_RETENCIONES.find(r => r['NUMERO DE DOCUMENTO'] === v['NUMERO DE DOCUMENTO']);
      if (!ret) alertas.push({ tipo: 'retencion_faltante', severidad: 'baja', idx: i, msg: `Venta > $1.000 sin retención registrada: ${v['NUMERO DE DOCUMENTO']}` });
    }
  });

  // 6. Proveedores nuevos con montos muy altos (anomalía estadística)
  const porProveedor = {};
  DATA.forEach(d => {
    const ruc = d.RUC_EMISOR;
    if (!porProveedor[ruc]) porProveedor[ruc] = { nombre: d['RAZON SOCIAL EMISOR'], docs: [], total: 0 };
    porProveedor[ruc].docs.push(d);
    porProveedor[ruc].total += (+d.TOTAL || 0);
  });
  const totales = Object.values(porProveedor).map(p => p.total);
  const media = totales.reduce((a, b) => a + b, 0) / totales.length;
  const desv = Math.sqrt(totales.reduce((a, b) => a + Math.pow(b - media, 2), 0) / totales.length);
  Object.entries(porProveedor).forEach(([ruc, info]) => {
    if (info.docs.length === 1 && info.total > media + 2.5 * desv) {
      alertas.push({ tipo: 'proveedor_nuevo_monto_alto', severidad: 'baja', msg: `Proveedor nuevo ${info.nombre} con monto atípico: $${fmt(info.total)}` });
    }
  });

  return alertas;
}

// ════════════════════════════════════════════════════════════════
//  ANÁLISIS DE TENDENCIAS (LOCAL)
// ════════════════════════════════════════════════════════════════
function analizarTendencias() {
  const res = { meses: [], gastos: [], ingresos: [], alertas: [] };
  const agrupado = {};

  DATA.forEach(d => {
    const m = d.FECHA && d.FECHA.slice(0, 7); // YYYY-MM
    if (!m) return;
    if (!agrupado[m]) agrupado[m] = { gastos: 0, ingresos: 0 };
    agrupado[m].gastos += (+d.TOTAL || 0);
  });
  DATA_VENTAS.forEach(v => {
    const m = v.FECHA && v.FECHA.slice(0, 7);
    if (!m) return;
    if (!agrupado[m]) agrupado[m] = { gastos: 0, ingresos: 0 };
    agrupado[m].ingresos += (+v.TOTAL || 0);
  });

  const orden = Object.keys(agrupado).sort();
  res.meses = orden;
  res.gastos = orden.map(m => agrupado[m].gastos);
  res.ingresos = orden.map(m => agrupado[m].ingresos);

  // Alertas de tendencia
  if (res.gastos.length >= 2) {
    const ult = res.gastos[res.gastos.length - 1];
    const pen = res.gastos[res.gastos.length - 2];
    if (ult > pen * 1.5) res.alertas.push(`📈 Gastos subieron ${((ult / pen - 1) * 100).toFixed(0)}% respecto al mes anterior.`);
    if (ult < pen * 0.5 && pen > 0) res.alertas.push(`📉 Gastos bajaron abruptamente respecto al mes anterior.`);
  }

  const promGasto = res.gastos.reduce((a, b) => a + b, 0) / (res.gastos.length || 1);
  if (res.gastos.length >= 3) {
    const ult3 = res.gastos.slice(-3);
    const creciente = ult3.every((v, i) => i === 0 || v >= ult3[i - 1]);
    if (creciente) res.alertas.push(`⚠️ Tendencia de gastos creciente los últimos 3 meses.`);
  }

  return res;
}

// ════════════════════════════════════════════════════════════════
//  SUGERENCIAS PROACTIVAS FISCALES
// ════════════════════════════════════════════════════════════════
function sugerenciasFiscales() {
  const s = [];
  const hoy = new Date();
  const mesActual = String(hoy.getMonth() + 1).padStart(2, '0');
  const anioActual = String(hoy.getFullYear());

  // Fecha límite ATS: día 28 del mes siguiente
  const mesATS = String(hoy.getMonth()).padStart(2, '0');
  if (mesATS !== '00') {
    s.push({ tipo: 'vencimiento', msg: `🗓️ El ATS del mes ${mesATS}/${anioActual} debe declararse antes del 28 de ${MESES_ES[hoy.getMonth()] || 'este mes'}.` });
  }

  // IVA: declaración mensual (días 10-28)
  s.push({ tipo: 'vencimiento', msg: `🗓️ Declaración de IVA del mes ${mesActual}: del 10 al 28 de ${MESES_ES[hoy.getMonth()]}.` });

  // Comprobantes sin clasificar
  const sinClasificar = DATA.filter(d => d._ctaCod === '5.2.1.11').length;
  if (sinClasificar > 0) s.push({ tipo: 'accion', msg: `Tienes ${sinClasificar} comprobante(s) sin clasificar. Revisa antes de cerrar el mes.` });

  // Diferencia en balance
  try {
    const bg = computeBalanceGeneral('');
    if (Math.abs(bg.diferencia || 0) > 0.01) s.push({ tipo: 'alerta', msg: `⚠️ El balance general tiene una diferencia de $${fmt(bg.diferencia)}. Revisa cuentas de orden o asientos manuales.` });
  } catch (e) { }

  // Empleados sin nómina del mes
  try {
    const claveMes = `${anioActual}-${mesActual}`;
    if (NOMINA_EMPLEADOS.length > 0 && (!NOMINA_RUNS[claveMes] || NOMINA_RUNS[claveMes].length === 0)) {
      s.push({ tipo: 'accion', msg: `👤 No has procesado la nómina de ${MESES_ES[hoy.getMonth()]} ${anioActual}.` });
    }
  } catch (e) { }

  return s;
}

// ════════════════════════════════════════════════════════════════
//  CLASIFICACIÓN LOCAL (Fallback sin IA)
// ════════════════════════════════════════════════════════════════
function clasificarLocal() {
  const ops = Object.keys(CUENTA_MAP).filter(k => k !== 'GASTOS POR CLASIFICAR SRI');
  let n = 0;
  DATA.forEach((d, i) => {
    if (d._ctaCod !== '5.2.1.11') return;
    const det = (d.RESUMEN || '').toLowerCase();
    const prov = (d['RAZON SOCIAL EMISOR'] || '').toLowerCase();
    const score = {};
    ops.forEach(c => {
      const cuenta = c.toLowerCase();
      score[c] = 0;
      // Palabras clave en resumen
      const palabras = det.split(/\s+/);
      palabras.forEach(p => { if (cuenta.includes(p) && p.length > 3) score[c] += 2; });
      // Palabras clave en proveedor
      if (cuenta.includes(prov.slice(0, 6))) score[c] += 1;
    });
    const mejor = Object.entries(score).sort((a, b) => b[1] - a[1])[0];
    if (mejor && mejor[1] > 0) {
      RAW_COMPRAS[i].CUENTA = mejor[0];
      n++;
    }
  });
  return n;
}

// ════════════════════════════════════════════════════════════════
//  UI – Panel IA y chat
// ════════════════════════════════════════════════════════════════
function toggleIAPanel() {
  const p = document.getElementById('ia-panel');
  p.classList.toggle('show');
  if (p.classList.contains('show') && !IA_HISTORY.length) {
    const activo = iaActivo();
    const anom = detectarAnomalias();
    const tend = analizarTendencias();
    const sug = sugerenciasFiscales();

    let intro = activo
      ? `Hola 👋 Soy tu asistente contable. Puedo explicarte tus balances, revisar tus gastos o detectar inconsistencias. ¿En qué te ayudo?`
      : `El asistente IA no está configurado. Puedes activarlo en ⚙️ Configuración indicando el endpoint de tu función serverless. Todo el resto del sistema funciona sin IA.`;

    if (anom.length) {
      intro += `\n\n🔍 Anomalías detectadas (${anom.length}):\n` + anom.slice(0, 5).map(a => `• ${a.msg}`).join('\n');
    }
    if (tend.alertas.length) {
      intro += `\n\n📊 Tendencias:\n` + tend.alertas.map(a => `• ${a}`).join('\n');
    }
    if (sug.length) {
      intro += `\n\n💡 Sugerencias:\n` + sug.slice(0, 3).map(s => `• ${s.msg}`).join('\n');
    }

    appendIA('bot', intro);
  }
}

function appendIA(role, text, loading) {
  const box = document.getElementById('ia-messages'), d = document.createElement('div');
  d.className = 'ia-msg ' + role + (loading ? ' loading' : '');
  d.style.whiteSpace = 'pre-wrap';
  d.textContent = text;
  box.appendChild(d); box.scrollTop = box.scrollHeight;
  return d;
}

function sendIASuggestion(t) { document.getElementById('ia-input').value = t; sendIAMessage(); }

async function sendIAMessage() {
  const i = document.getElementById('ia-input'), t = i.value.trim(); if (!t) return;
  i.value = ''; appendIA('user', t); IA_HISTORY.push({ role: 'user', text: t });
  const l = appendIA('bot', 'Pensando...', true);
  try {
    const sys = `Eres un contador experto en normativa ecuatoriana (SRI, IESS, NIIF para PYMES). Responde en español, claro y breve. Usa solo los datos entregados; si algo no está, dilo. No des asesoría vinculante.\n\nDatos:\n${buildFinancialContext()}`;
    const r = await callIA(sys, t, 700, IA_HISTORY.slice(-10).map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text })));
    l.remove(); appendIA('bot', r || 'No obtuve respuesta.'); IA_HISTORY.push({ role: 'bot', text: r });
  } catch (e) { l.remove(); appendIA('bot', '⚠️ ' + e.message); }
}

// ════════════════════════════════════════════════════════════════
//  CLASIFICACIÓN CON IA (con fallback local)
// ════════════════════════════════════════════════════════════════
async function clasificarConIA() {
  const pend = DATA.filter(d => d._ctaCod === '5.2.1.11').slice(0, 40);
  if (!pend.length) return showToast('No hay comprobantes pendientes por clasificar');

  // Fallback local si no hay IA configurada
  if (!iaActivo()) {
    const n = clasificarLocal();
    showToast(`🤖 Clasificación local: ${n} de ${pend.length} comprobantes`);
    afterComprasChange();
    return;
  }

  const b = document.getElementById('btn-clasificar-ia'); b.disabled = true; b.textContent = '🤖 Clasificando...';
  try {
    const ops = Object.keys(CUENTA_MAP).filter(k => k !== 'GASTOS POR CLASIFICAR SRI');
    const sys = `Eres un contador ecuatoriano que clasifica comprobantes de compra. Responde SOLO un JSON válido: [{"idx":0,"cuenta":"NOMBRE"}]. "cuenta" debe ser exactamente uno de: ${JSON.stringify(ops)}.`;
    const lista = pend.map(d => `${d._idx}: proveedor="${d['RAZON SOCIAL EMISOR']}" | detalle="${d.RESUMEN}"`).join('\n');
    const r = await callIA(sys, 'Clasifica:\n' + lista, 2000);
    let n = 0;
    JSON.parse(r.replace(/```json|```/g, '').trim()).forEach(it => {
      if (CUENTA_MAP[it.cuenta] && RAW_COMPRAS[it.idx]) { RAW_COMPRAS[it.idx].CUENTA = it.cuenta; n++; }
    });
    afterComprasChange(); showToast(`🤖 IA clasificó ${n} de ${pend.length} comprobantes`);
  } catch (e) {
    // Si falla la IA, intentar local
    const n = clasificarLocal();
    showToast(`IA falló, clasificación local: ${n} de ${pend.length}`, 'err');
  }
  finally { b.disabled = false; b.textContent = '🤖 Clasificar con IA'; }
}

// ════════════════════════════════════════════════════════════════
//  GENERAR ANÁLISIS IA
// ════════════════════════════════════════════════════════════════
async function generarAnalisisIA(tipo, contId, btnId) {
  const b = document.getElementById(btnId); b.disabled = true; b.textContent = '⏳ Analizando...';
  try {
    const sys = 'Eres un analista financiero senior en Ecuador. Redacta en español un análisis breve (3-5 frases) usando solo los datos dados. Sé concreto y honesto sobre limitaciones.';
    const r = await callIA(sys, `Analiza el ${tipo}:\n${buildFinancialContext()}`, 500);
    let box = document.getElementById(contId + '-ia');
    if (!box) { box = document.createElement('div'); box.id = contId + '-ia'; box.className = 'ia-analysis'; document.getElementById(contId).appendChild(box); }
    box.textContent = '💡 ' + r;
  } catch (e) { showToast('⚠️ ' + e.message, 'err'); }
  finally { b.disabled = false; b.textContent = '💡 Análisis IA'; }
}

// ════════════════════════════════════════════════════════════════
//  EXPOSE A GLOBAL PARA DEBUG
// ════════════════════════════════════════════════════════════════
window.IA_UTILS = { detectarAnomalias, analizarTendencias, sugerenciasFiscales, clasificarLocal };

/* Auto-expose window */
window.clasificarConIA = clasificarConIA;
window.generarAnalisisIA = generarAnalisisIA;
window.sendIAMessage = sendIAMessage;
window.sendIASuggestion = sendIASuggestion;
window.toggleIAPanel = toggleIAPanel;
