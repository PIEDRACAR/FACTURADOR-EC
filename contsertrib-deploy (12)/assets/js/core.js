/* =====================================================================
   core.js — CONTSERTRIB Núcleo: almacenamiento, utilidades, plan de cuentas,
   empresa, configuración, tema, respaldo, roles
   ===================================================================== */
'use strict';

/* ---------- Constantes fiscales Ecuador (LRTI / NIIF-PYMES) ---------- */
const PCT_PART_TRAB = 0.15;   // 15 % participación trabajadores (art. 97 LRTI)
const PCT_IR_SOC   = 0.25;   // 25 % impuesto a la renta sociedades (art. 10 LRTI)
const IVA_RATE     = 0.15;    // 15 % IVA general 2026

/* ---------- Claves de almacenamiento ---------- */
const K = {
  compras:'ct_compras_v2', ventas:'ct_ventas_v2', ret:'ct_retenciones_v2',
  manual:'ct_asientos_manuales_v2', provRules:'ct_reglas_proveedor_v2', cliRules:'ct_reglas_cliente_v2',
  txOv:'ct_tx_overrides_v2', custom:'ct_plan_custom_v2', accOv:'ct_plan_overrides_v2',
  mapOv:'ct_cuenta_map_overrides_v2', adjAuto:'ct_ajustes_auto_v2', adjEntry:'ct_ajustes_asiento_v2',
  empresa:'ct_empresa_v2', theme:'ct_theme_v2', config:'ct_config_v2',
  nomEmp:'ct_nomina_empleados_v2', nomCfg:'ct_nomina_config_v2', nomRuns:'ct_nomina_runs_v2',
  conciliacion:'ct_conciliacion_v2', conciliaHist:'ct_conciliacion_hist_v2',
  activos:'ct_activos_fijos_v2', activosDep:'ct_activos_depreciacion_v2',
  dashboardCfg:'ct_dashboard_config_v2'
};

let _quotaWarned = false;
const LS = {
  get(k, fb){ try{ return DB.get(k, fb); }catch(e){ return fb; } },
  set(k, v){
    try{ DB.set(k, v); return true; }
    catch(e){
      console.warn('Almacenamiento local:', e);
      if(!_quotaWarned){ _quotaWarned=true; showToast('Almacenamiento del navegador lleno. Descarga un respaldo desde "Datos y respaldo".','err'); setTimeout(()=>_quotaWarned=false,15000); }
      return false;
    }
  },
  del(k){ try{ DB.del(k); }catch(e){} }
};

/* ---------- Utilidades ---------- */
const MESES_ES=['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const MESES_CORTOS=['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const fmt = n => (+(n||0)).toLocaleString('es-EC',{minimumFractionDigits:2,maximumFractionDigits:2});
const round2 = n => Math.round((+(n||0)+Number.EPSILON)*100)/100;
const round4 = n => Math.round((+(n||0)+Number.EPSILON)*10000)/10000;
const esc = v => String(v??'').replace(/[&<>"']/g,s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
const fmtDate = s => { if(!s) return ''; const p=String(s).slice(0,10).split('-'); return p.length===3?`${p[2]}/${p[1]}/${p[0]}`:s; };
const hoyISO = () => new Date().toISOString().slice(0,10);
const hoyPeriodo = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; };
const slug = s => (String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'') || 'empresa');
const normTxt = s => String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
function numOrZero(v){ if(typeof v==='number') return isFinite(v)?v:0; const n=parseFloat(String(v||'0').replace(/\s/g,'').replace(',','.')); return isFinite(n)?n:0; }
function ultimoDiaMes(periodo){ const [y,m]=periodo.split('-').map(Number); return `${y}-${String(m).padStart(2,'0')}-${String(new Date(y,m,0).getDate()).padStart(2,'0')}`; }
function periodLabel(per){
  if(per){ const p=String(per).split('-'); return p.length===2 ? `${MESES_ES[+p[1]-1]||p[1]} ${p[0]}` : per; }
  return 'Sin registros';
}
function showToast(msg, tipo){
  const t=document.createElement('div');
  t.className='toast'+(tipo?' '+tipo:' ok');
  t.textContent=msg; document.body.appendChild(t);
  setTimeout(()=>t.remove(), 3500);
}

/* ---------- Modales ---------- */
function openModal(id){ const m=document.getElementById(id); if(m) m.classList.add('show'); }
function closeModal(id){ const m=document.getElementById(id); if(m) m.classList.remove('show'); }
function openGenericModal(title,bodyHTML){
  const m=document.getElementById('modal-generic'); if(!m) return;
  document.getElementById('modal-generic-title').innerHTML=esc(title);
  document.getElementById('modal-generic-body').innerHTML=bodyHTML;
  m.classList.add('show');
}
function sriLink(claveAcceso,tipoDoc){
  if(!claveAcceso) return '';
  let tipo='01';
  const td=String(tipoDoc||'').toUpperCase();
  if(td==='NC'||td==='04') tipo='04';
  else if(td==='ND'||td==='05') tipo='05';
  else if(td==='RET'||td==='07'||td==='COMPROBANTE DE RETENCION'||td.includes('RETENCION')) tipo='07';
  const url='https://consultas.sri.gob.ec/SRI-WAT-TI-CONSULTA-REC/sri-comprobante-recibo-internet/reporte/cedula/'+tipo+'/'+claveAcceso;
  return '<a class="sri-link" href="'+url+'" target="_blank" rel="noopener" title="Ver comprobante en SRI">'+esc(claveAcceso.slice(0,8))+'…</a>';
}
function descargarArchivo(nombre, contenido, mime){
  const blob = new Blob([contenido], {type: mime||'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=nombre; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1500);
}

/* ---------- Plan de cuentas (NIIF-PYMES Ecuador) ~ 170 cuentas ---------- */
const PLAN_CUENTAS = [
  /* ===== ACTIVO ===== */
  {cod:"1",nom:"ACTIVO",niv:1},
  {cod:"1.1",nom:"ACTIVO CORRIENTE",niv:2},
  {cod:"1.1.1",nom:"EFECTIVO Y EQUIVALENTES",niv:3},
  {cod:"1.1.1.01",nom:"Caja General",niv:4},
  {cod:"1.1.1.01.001",nom:"Caja Chica",niv:5},
  {cod:"1.1.1.02",nom:"Banco Pichincha Cta. Cte.",niv:4},
  {cod:"1.1.1.02.001",nom:"Banco Pichincha - Cta. Ahorros",niv:5},
  {cod:"1.1.1.03",nom:"Banco del Pacífico Cta. Cte.",niv:4},
  {cod:"1.1.1.03.001",nom:"Banco del Pacífico - Cta. Ahorros",niv:5},
  {cod:"1.1.1.04",nom:"Banco Guayaquil Cta. Cte.",niv:4},
  {cod:"1.1.1.04.001",nom:"Banco Guayaquil - Cta. Ahorros",niv:5},
  {cod:"1.1.1.05",nom:"Fondo Fijo",niv:4},
  {cod:"1.1.2",nom:"CUENTAS POR COBRAR",niv:3},
  {cod:"1.1.2.01",nom:"Clientes Nacionales",niv:4},
  {cod:"1.1.2.01.001",nom:"Clientes por Cobrar CV",niv:5},
  {cod:"1.1.2.01.002",nom:"Clientes por Cobrar SRI",niv:5},
  {cod:"1.1.2.02",nom:"Anticipos a Empleados",niv:4},
  {cod:"1.1.2.03",nom:"Préstamos a Empleados",niv:4},
  {cod:"1.1.2.04",nom:"Otras Cuentas por Cobrar",niv:4},
  {cod:"1.1.2.04.001",nom:"Reclamo de IVA",niv:5},
  {cod:"1.1.2.05",nom:"(-) Provisión Cuentas Incobrables",niv:4},
  {cod:"1.1.3",nom:"INVENTARIOS",niv:3},
  {cod:"1.1.3.01",nom:"Inventario de Mercadería",niv:4},
  {cod:"1.1.3.02",nom:"Inventario de Suministros",niv:4},
  {cod:"1.1.3.03",nom:"Inventario de Productos Terminados",niv:4},
  {cod:"1.1.4",nom:"ACTIVOS PAGADOS POR ANTICIPADO",niv:3},
  {cod:"1.1.4.01",nom:"Seguros Prepagados",niv:4},
  {cod:"1.1.4.02",nom:"Arriendos Prepagados",niv:4},
  {cod:"1.1.5",nom:"ACTIVOS POR IMPUESTOS CORRIENTES",niv:3},
  {cod:"1.1.5.01",nom:"IVA Crédito Tributario",niv:4},
  {cod:"1.1.5.01.001",nom:"Crédito IVA Compras 15%",niv:5},
  {cod:"1.1.5.01.002",nom:"Crédito IVA Compras 5%",niv:5},
  {cod:"1.1.5.01.003",nom:"Crédito IVA Servicios 15%",niv:5},
  {cod:"1.1.5.02",nom:"Retenciones IVA Recibidas",niv:4},
  {cod:"1.1.5.03",nom:"Retenciones IR Recibidas",niv:4},
  {cod:"1.1.5.04",nom:"Anticipo Impuesto a la Renta",niv:4},
  /* --- Activo No Corriente --- */
  {cod:"1.2",nom:"ACTIVO NO CORRIENTE",niv:2},
  {cod:"1.2.1",nom:"PROPIEDAD, PLANTA Y EQUIPO",niv:3},
  {cod:"1.2.1.01",nom:"Terrenos",niv:4},
  {cod:"1.2.1.02",nom:"Edificios",niv:4},
  {cod:"1.2.1.03",nom:"Equipo de Cómputo",niv:4},
  {cod:"1.2.1.04",nom:"Muebles y Enseres",niv:4},
  {cod:"1.2.1.05",nom:"Vehículos",niv:4},
  {cod:"1.2.1.06",nom:"Maquinaria y Equipo",niv:4},
  {cod:"1.2.1.07",nom:"Equipo de Oficina",niv:4},
  {cod:"1.2.1.08",nom:"Obras en Construcción",niv:4},
  {cod:"1.2.1.09",nom:"(-) Depreciación Acumulada PPE",niv:4},
  {cod:"1.2.1.09.001",nom:"Deprec. Acum. Edificios",niv:5},
  {cod:"1.2.1.09.002",nom:"Deprec. Acum. Equipo Cómputo",niv:5},
  {cod:"1.2.1.09.003",nom:"Deprec. Acum. Muebles y Enseres",niv:5},
  {cod:"1.2.1.09.004",nom:"Deprec. Acum. Vehículos",niv:5},
  {cod:"1.2.1.09.005",nom:"Deprec. Acum. Maquinaria y Equipo",niv:5},
  {cod:"1.2.1.09.006",nom:"Deprec. Acum. Equipo Oficina",niv:5},
  {cod:"1.2.1.10",nom:"Herramientas y Menores",niv:4},
  {cod:"1.2.2",nom:"ACTIVOS INTANGIBLES",niv:3},
  {cod:"1.2.2.01",nom:"Software y Licencias",niv:4},
  {cod:"1.2.2.02",nom:"Marcas y Patentes",niv:4},
  {cod:"1.2.2.03",nom:"(-) Amortización Acumulada",niv:4},
  {cod:"1.2.3",nom:"OTROS ACTIVOS NO CORRIENTES",niv:3},
  {cod:"1.2.3.01",nom:"Inversiones a Largo Plazo",niv:4},
  {cod:"1.2.3.02",nom:"Garantías Entregadas",niv:4},

  /* ===== PASIVO ===== */
  {cod:"2",nom:"PASIVO",niv:1},
  {cod:"2.1",nom:"PASIVO CORRIENTE",niv:2},
  {cod:"2.1.1",nom:"CUENTAS Y DOCUMENTOS POR PAGAR",niv:3},
  {cod:"2.1.1.01",nom:"Proveedores Locales",niv:4},
  {cod:"2.1.1.01.001",nom:"Proveedores Bienes",niv:5},
  {cod:"2.1.1.01.002",nom:"Proveedores Servicios",niv:5},
  {cod:"2.1.1.02",nom:"Cuentas por Pagar Socios/Accionistas",niv:4},
  {cod:"2.1.1.03",nom:"Anticipos de Clientes",niv:4},
  {cod:"2.1.1.04",nom:"Documentos por Pagar",niv:4},
  {cod:"2.1.2",nom:"OBLIGACIONES CON LA ADMINISTRACIÓN TRIBUTARIA",niv:3},
  {cod:"2.1.2.01",nom:"IVA por Pagar",niv:4},
  {cod:"2.1.2.02",nom:"Retenciones en la Fuente IR por Pagar",niv:4},
  {cod:"2.1.2.03",nom:"Retenciones de IVA por Pagar",niv:4},
  {cod:"2.1.2.04",nom:"Impuesto a la Renta por Pagar",niv:4},
  {cod:"2.1.3",nom:"OBLIGACIONES CON EL IESS Y BENEFICIOS SOCIALES",niv:3},
  {cod:"2.1.3.01",nom:"Sueldos por Pagar",niv:4},
  {cod:"2.1.3.02",nom:"IESS por Pagar",niv:4},
  {cod:"2.1.3.02.001",nom:"Aporte Personal IESS por Pagar",niv:5},
  {cod:"2.1.3.02.002",nom:"Aporte Patronal IESS por Pagar",niv:5},
  {cod:"2.1.3.03",nom:"Décimo Tercer Sueldo por Pagar",niv:4},
  {cod:"2.1.3.04",nom:"Décimo Cuarto Sueldo por Pagar",niv:4},
  {cod:"2.1.3.05",nom:"Vacaciones por Pagar",niv:4},
  {cod:"2.1.3.06",nom:"Fondos de Reserva por Pagar",niv:4},
  {cod:"2.1.3.07",nom:"15% Participación Trabajadores por Pagar",niv:4},
  {cod:"2.1.4",nom:"OBLIGACIONES FINANCIERAS CORTO PLAZO",niv:3},
  {cod:"2.1.4.01",nom:"Préstamo Banco Pichincha",niv:4},
  {cod:"2.1.4.02",nom:"Préstamo Banco del Pacífico",niv:4},
  {cod:"2.1.4.03",nom:"Sobregiro Bancario",niv:4},
  {cod:"2.1.5",nom:"OTRAS CUENTAS POR PAGAR",niv:3},
  {cod:"2.1.5.01",nom:"Dividendos por Pagar",niv:4},
  {cod:"2.1.5.02",nom:"Cuentas por Pagar Relacionadas",niv:4},
  {cod:"2.2",nom:"PASIVO NO CORRIENTE",niv:2},
  {cod:"2.2.1",nom:"OBLIGACIONES FINANCIERAS LARGO PLAZO",niv:3},
  {cod:"2.2.1.01",nom:"Crédito Hipotecario",niv:4},
  {cod:"2.2.2",nom:"PROVISIONES POR BENEFICIOS A EMPLEADOS",niv:3},
  {cod:"2.2.2.01",nom:"Provisión Jubilación Patronal",niv:4},
  {cod:"2.2.2.02",nom:"Provisión Desahucio",niv:4},

  /* ===== PATRIMONIO ===== */
  {cod:"3",nom:"PATRIMONIO",niv:1},
  {cod:"3.1",nom:"CAPITAL",niv:2},
  {cod:"3.1.1",nom:"Capital Suscrito y Pagado",niv:3},
  {cod:"3.1.1.01",nom:"Capital Socios / Accionistas",niv:4},
  {cod:"3.1.2",nom:"Aportes para Futura Capitalización",niv:3},
  {cod:"3.2",nom:"RESERVAS",niv:2},
  {cod:"3.2.1",nom:"Reserva Legal",niv:3},
  {cod:"3.2.2",nom:"Reserva Estatutaria",niv:3},
  {cod:"3.2.3",nom:"Reserva Facultativa",niv:3},
  {cod:"3.3",nom:"RESULTADOS",niv:2},
  {cod:"3.3.1",nom:"Utilidades / Pérdidas Acumuladas",niv:3},
  {cod:"3.3.2",nom:"Utilidad / Pérdida del Ejercicio",niv:3},

  /* ===== INGRESOS ===== */
  {cod:"4",nom:"INGRESOS",niv:1},
  {cod:"4.1",nom:"INGRESOS OPERACIONALES",niv:2},
  {cod:"4.1.1",nom:"VENTAS DE SERVICIOS",niv:3},
  {cod:"4.1.1.01",nom:"Ventas de Servicios Profesionales",niv:4},
  {cod:"4.1.1.02",nom:"Ventas de Servicios Tecnológicos",niv:4},
  {cod:"4.1.1.05",nom:"Ventas de Servicios Facturados (Importación SRI)",niv:4},
  {cod:"4.1.2",nom:"VENTAS DE BIENES",niv:3},
  {cod:"4.1.2.01",nom:"Ventas de Mercadería",niv:4},
  {cod:"4.1.3",nom:"(-) DEVOLUCIONES EN VENTAS",niv:3},
  {cod:"4.1.3.01",nom:"Devoluciones en Ventas",niv:4},
  {cod:"4.1.4",nom:"(-) DESCUENTOS EN VENTAS",niv:3},
  {cod:"4.1.4.01",nom:"Descuentos Concedidos en Ventas",niv:4},
  {cod:"4.2",nom:"INGRESOS NO OPERACIONALES",niv:2},
  {cod:"4.2.1",nom:"Intereses Ganados",niv:3},
  {cod:"4.2.2",nom:"Otros Ingresos",niv:4},
  {cod:"4.2.3",nom:"Ganancia en Venta de Activos",niv:4},

  /* ===== COSTOS Y GASTOS ===== */
  {cod:"5",nom:"COSTOS Y GASTOS",niv:1},
  {cod:"5.1",nom:"COSTO DE VENTAS Y PRODUCCIÓN",niv:2},
  {cod:"5.1.1",nom:"COSTO DE SERVICIOS",niv:3},
  {cod:"5.1.1.01",nom:"Costo de Servicios Prestados",niv:4},
  {cod:"5.1.2",nom:"COSTO DE MERCADERÍA VENDIDA",niv:3},
  {cod:"5.1.2.01",nom:"Compras de Mercadería",niv:4},
  {cod:"5.1.2.02",nom:"(-) Devolución en Compras",niv:4},
  {cod:"5.2",nom:"GASTOS OPERACIONALES",niv:2},
  {cod:"5.2.1",nom:"GASTOS DE ADMINISTRACIÓN",niv:3},
  {cod:"5.2.1.01",nom:"Gasto Sueldos y Salarios",niv:4},
  {cod:"5.2.1.01.001",nom:"Provisión Décimo Tercer Sueldo",niv:5},
  {cod:"5.2.1.01.002",nom:"Provisión Décimo Cuarto Sueldo",niv:5},
  {cod:"5.2.1.01.003",nom:"Provisión Vacaciones",niv:5},
  {cod:"5.2.1.01.004",nom:"Gasto Fondos de Reserva",niv:5},
  {cod:"5.2.1.02",nom:"Gasto Aporte Patronal IESS",niv:4},
  {cod:"5.2.1.03",nom:"Gasto Beneficios Sociales Trabajadores",niv:4},
  {cod:"5.2.1.04",nom:"Gasto Arriendo",niv:4},
  {cod:"5.2.1.05",nom:"Gasto Servicios Básicos - Internet",niv:4},
  {cod:"5.2.1.06",nom:"Gasto Servicios Básicos - Luz, Agua y Teléfono",niv:4},
  {cod:"5.2.1.07",nom:"Gasto Mantenimiento y Reparaciones",niv:4},
  {cod:"5.2.1.08",nom:"Gasto Suministros y Materiales",niv:4},
  {cod:"5.2.1.09",nom:"Gasto Depreciaciones",niv:4},
  {cod:"5.2.1.10",nom:"Gasto Amortizaciones",niv:4},
  {cod:"5.2.1.11",nom:"Gastos por Clasificar (Importación SRI)",niv:4},
  {cod:"5.2.1.12",nom:"Gasto Honorarios Profesionales",niv:4},
  {cod:"5.2.1.13",nom:"Gasto Seguros",niv:4},
  {cod:"5.2.1.14",nom:"Gasto Impuestos, Contribuciones y Patentes",niv:4},
  {cod:"5.2.1.15",nom:"Gasto Provisión Cuentas Incobrables",niv:4},
  {cod:"5.2.1.16",nom:"Gasto Provisión Jubilación Patronal",niv:4},
  {cod:"5.2.1.17",nom:"Gasto Provisión Desahucio",niv:4},
  {cod:"5.2.1.18",nom:"Gasto Capacitación al Personal",niv:4},
  {cod:"5.2.2",nom:"GASTOS DE VENTAS Y COMERCIALIZACIÓN",niv:3},
  {cod:"5.2.2.01",nom:"Gasto Publicidad y Promoción",niv:4},
  {cod:"5.2.2.02",nom:"Gasto Transporte y Envíos",niv:4},
  {cod:"5.2.2.03",nom:"Gasto Alimentación y Eventos",niv:4},
  {cod:"5.2.2.04",nom:"Gasto Combustible y Lubricantes",niv:4},
  {cod:"5.2.2.05",nom:"Gasto Viáticos y Movilización",niv:4},
  {cod:"5.2.3",nom:"GASTOS DE TECNOLOGÍA",niv:3},
  {cod:"5.2.3.01",nom:"Gasto Suscripciones Software / SaaS",niv:4},
  {cod:"5.2.3.02",nom:"Gasto Dominios y Hosting",niv:4},
  {cod:"5.2.4",nom:"GASTOS NO DEDUCIBLES",niv:3},
  {cod:"5.2.4.01",nom:"Multas e Intereses Fiscales",niv:4},
  {cod:"5.2.4.02",nom:"Otros Gastos No Deducibles",niv:4},
  {cod:"5.3",nom:"GASTOS NO OPERACIONALES",niv:2},
  {cod:"5.3.1",nom:"GASTOS FINANCIEROS",niv:3},
  {cod:"5.3.1.01",nom:"Gasto Intereses Bancarios",niv:4},
  {cod:"5.3.1.02",nom:"Gastos Bancarios y Comisiones",niv:4},
  {cod:"5.3.2",nom:"OTROS GASTOS NO OPERACIONALES",niv:3},
  {cod:"5.3.2.01",nom:"Pérdida en Venta de Activos",niv:4},
  {cod:"5.3.2.02",nom:"Otros Gastos No Operacionales",niv:4},
  {cod:"5.4",nom:"PARTICIPACIÓN E IMPUESTO A LA RENTA",niv:2},
  {cod:"5.4.1",nom:"15% Participación Trabajadores",niv:3},
  {cod:"5.4.2",nom:"Gasto Impuesto a la Renta Corriente",niv:3}
];

/* ---------- Categorías SRI → cuenta contable ---------- */
const CUENTA_MAP = {
  "COSTO DE SERVICIOS":{cod:"5.1.1.01",nom:"Costo de Servicios Prestados"},
  "COMPRAS DE MERCADERIA":{cod:"5.1.2.01",nom:"Compras de Mercadería"},
  "GASTO ARRIENDO":{cod:"5.2.1.04",nom:"Gasto Arriendo"},
  "GASTO INTERNET":{cod:"5.2.1.05",nom:"Gasto Servicios Básicos - Internet"},
  "GASTO SERVICIOS BASICOS":{cod:"5.2.1.06",nom:"Gasto Servicios Básicos - Luz, Agua y Teléfono"},
  "GASTO BENEFICIOS TRABAJADORES":{cod:"5.2.1.03",nom:"Gasto Beneficios Sociales Trabajadores"},
  "GASTO SUMINISTROS Y MATERIALES":{cod:"5.2.1.08",nom:"Gasto Suministros y Materiales"},
  "GASTO MANTENIMIENTO":{cod:"5.2.1.07",nom:"Gasto Mantenimiento y Reparaciones"},
  "GASTO HONORARIOS":{cod:"5.2.1.12",nom:"Gasto Honorarios Profesionales"},
  "GASTO SEGUROS":{cod:"5.2.1.13",nom:"Gasto Seguros"},
  "GASTO IMPUESTOS Y PATENTES":{cod:"5.2.1.14",nom:"Gasto Impuestos, Contribuciones y Patentes"},
  "GASTO CAPACITACION":{cod:"5.2.1.18",nom:"Gasto Capacitación al Personal"},
  "GASTO PUBLICIDAD":{cod:"5.2.2.01",nom:"Gasto Publicidad y Promoción"},
  "GASTO TRANSPORTE Y ENVIOS":{cod:"5.2.2.02",nom:"Gasto Transporte y Envíos"},
  "GASTO ALIMENTACION":{cod:"5.2.2.03",nom:"Gasto Alimentación y Eventos"},
  "GASTO COMBUSTIBLE":{cod:"5.2.2.04",nom:"Gasto Combustible y Lubricantes"},
  "GASTO VIATICOS":{cod:"5.2.2.05",nom:"Gasto Viáticos y Movilización"},
  "GASTO SUSCRIPCIONES":{cod:"5.2.3.01",nom:"Gasto Suscripciones Software / SaaS"},
  "GASTO HOSTING Y DOMINIOS":{cod:"5.2.3.02",nom:"Gasto Dominios y Hosting"},
  "GASTO NO DEDUCIBLE":{cod:"5.2.4.02",nom:"Otros Gastos No Deducibles"},
  "GASTO INTERESES":{cod:"5.3.1.01",nom:"Gasto Intereses Bancarios"},
  "GASTOS BANCARIOS":{cod:"5.3.1.02",nom:"Gastos Bancarios y Comisiones"},
  "GASTOS POR CLASIFICAR SRI":{cod:"5.2.1.11",nom:"Gastos por Clasificar (Importación SRI)"}
};
let CUENTA_MAP_OVERRIDES = LS.get(K.mapOv,{});
Object.keys(CUENTA_MAP_OVERRIDES).forEach(k=>{ if(CUENTA_MAP[k]) CUENTA_MAP[k]=CUENTA_MAP_OVERRIDES[k]; });
const persistCuentaMapOverrides = ()=>LS.set(K.mapOv,CUENTA_MAP_OVERRIDES);

/* ---------- Clasificación automática por palabras clave ---------- */
const AUTO_KW = [
  {cta:"GASTO COMBUSTIBLE",kws:["combustible","gasolina","diesel","ecopais","gasolinera","petroecuador","primax"]},
  {cta:"GASTO ARRIENDO",kws:["arriendo","alquiler","arrendamiento","canon"]},
  {cta:"GASTO INTERNET",kws:["internet","banda ancha","fibra optica","netlife","puntonet"]},
  {cta:"GASTO SERVICIOS BASICOS",kws:["energia electrica","empresa electrica","agua potable","epmaps","telefonia","cnt","claro","movistar"]},
  {cta:"GASTO HONORARIOS",kws:["honorario","asesoria","consultoria","auditoria","servicios profesionales","abogado","contable"]},
  {cta:"GASTO SEGUROS",kws:["seguro","poliza","aseguradora"]},
  {cta:"GASTO IMPUESTOS Y PATENTES",kws:["patente","municipio","tasa","contribucion","sri","permiso de funcionamiento","bomberos"]},
  {cta:"GASTO SUMINISTROS Y MATERIALES",kws:["suministro","material","papeleria","ferreteria","utiles","toner","resma"]},
  {cta:"GASTO MANTENIMIENTO",kws:["mantenimiento","reparacion","pintura","limpieza","obra","instalacion"]},
  {cta:"GASTO ALIMENTACION",kws:["alimentacion","restaurante","comida","almuerzo","catering","supermercado","viveres"]},
  {cta:"GASTO SUSCRIPCIONES",kws:["suscripcion","licencia","software","saas","microsoft","google workspace","adobe"]},
  {cta:"GASTO HOSTING Y DOMINIOS",kws:["dominio","hosting","servidor","cloud","aws","azure"]},
  {cta:"GASTO TRANSPORTE Y ENVIOS",kws:["transporte","flete","courier","envio","servientrega","laarcourier","paqueteria"]},
  {cta:"GASTO VIATICOS",kws:["viatico","hospedaje","hotel","pasaje","movilizacion","taxi","uber"]},
  {cta:"GASTO PUBLICIDAD",kws:["publicidad","marketing","promocion","pauta","imprenta","rotulo"]},
  {cta:"GASTO CAPACITACION",kws:["capacitacion","curso","seminario","taller","certificacion"]},
  {cta:"GASTO INTERESES",kws:["interes","financiamiento"]},
  {cta:"GASTOS BANCARIOS",kws:["comision","servicio bancario","cajero","chequera","banco","cooperativa"]},
  {cta:"COMPRAS DE MERCADERIA",kws:["mercaderia","inventario","producto para reventa"]}
];
function autoClasificarSRI(categoria, resumen){
  const t = normTxt(categoria)+' '+normTxt(resumen);
  for(const g of AUTO_KW) if(g.kws.some(k=>t.includes(k))) return g.cta;
  return "GASTOS POR CLASIFICAR SRI";
}

/* ---------- Cuentas personalizadas y renombres ---------- */
let CUSTOM_ACCOUNTS = LS.get(K.custom,[]);
let ACCOUNT_OVERRIDES = LS.get(K.accOv,{});
function loadPlanExtras(){
  CUSTOM_ACCOUNTS.forEach(c=>{ if(c&&c.cod&&!PLAN_CUENTAS.some(p=>p.cod===c.cod)) PLAN_CUENTAS.push({cod:c.cod,nom:c.nom,niv:+c.niv||4,custom:true}); });
  Object.keys(ACCOUNT_OVERRIDES).forEach(cod=>{ const p=PLAN_CUENTAS.find(x=>x.cod===cod); if(p) p.nom=ACCOUNT_OVERRIDES[cod]; });
  PLAN_CUENTAS.sort((a,b)=>a.cod.localeCompare(b.cod));
}
const persistCustomAccounts = ()=>LS.set(K.custom,CUSTOM_ACCOUNTS);
const persistAccountOverrides = ()=>LS.set(K.accOv,ACCOUNT_OVERRIDES);
function cuentaNom(cod){ const p=PLAN_CUENTAS.find(x=>x.cod===cod); return p?p.nom:cod; }
function getSelectableAccounts(){ return PLAN_CUENTAS.filter(c=>c.niv>=3).sort((a,b)=>a.cod.localeCompare(b.cod)); }
function accountOptions(sel=''){
  return getSelectableAccounts().map(c=>`<option value="${esc(c.cod)}|${esc(c.nom)}" ${sel===c.cod?'selected':''}>${esc(c.cod)} - ${esc(c.nom)}</option>`).join('');
}
function accountOptionsPrefix(pref, sel=''){
  return getSelectableAccounts().filter(c=>c.cod.startsWith(pref)).map(c=>`<option value="${esc(c.cod)}|${esc(c.nom)}" ${sel===c.cod?'selected':''}>${esc(c.cod)} - ${esc(c.nom)}</option>`).join('');
}

/* ---------- Configuración contable ---------- */
const CONFIG_DEFAULT = {
  ctaCompras:'5.1.2.01', ctaVentas:'4.1.1.01', ctaIvaCompras:'1.1.5.01',
  ctaIvaVentas:'2.1.2.01', ctaIngreso:'4.1.1.01', iaEndpoint:'',
  ctaBanco:'1.1.1.02', ctaDepreciacion:'5.2.1.09', ctaDeprecAcum:'1.2.1.09',
  ctaGananciaActivo:'4.2.3', ctaPerdidaActivo:'5.3.2.01'
};
let CONFIG = Object.assign({}, CONFIG_DEFAULT, LS.get(K.config,{}) || {});
const cta = cod => ({cod, nom: cuentaNom(cod)});
const CTA = {
  get compras(){ return cta(CONFIG.ctaCompras); },
  get ventas(){ return cta(CONFIG.ctaVentas); },
  get ivaCompras(){ return cta(CONFIG.ctaIvaCompras); },
  get ivaVentas(){ return cta(CONFIG.ctaIvaVentas); },
  get ingreso(){ return cta(CONFIG.ctaIngreso); },
  get banco(){ return cta(CONFIG.ctaBanco); },
  get depreciacion(){ return cta(CONFIG.ctaDepreciacion); },
  get depreciacionAcum(){ return cta(CONFIG.ctaDeprecAcum); },
  get gananciaActivo(){ return cta(CONFIG.ctaGananciaActivo); },
  get perdidaActivo(){ return cta(CONFIG.ctaPerdidaActivo); },
  retIR: {cod:'1.1.5.03',nom:'Retenciones IR Recibidas'},
  retIVA:{cod:'1.1.5.02',nom:'Retenciones IVA Recibidas'},
  otrosIng:{cod:'4.2.2',nom:'Otros Ingresos'}
};

function openConfigModal(){
  const set=(id,pref,val)=>{ const s=document.getElementById(id); if(!s) return; s.innerHTML=pref?accountOptionsPrefix(pref,val):accountOptions(val); s.value=val+'|'+cuentaNom(val); };
  set('cfg-cta-compras-m','',CONFIG.ctaCompras);
  set('cfg-cta-ventas-m','',CONFIG.ctaVentas);
  set('cfg-cta-iva-compras-m','1.',CONFIG.ctaIvaCompras);
  set('cfg-cta-iva-ventas-m','2.',CONFIG.ctaIvaVentas);
  set('cfg-cta-ingreso-m','4.',CONFIG.ctaIngreso);
  set('cfg-cta-banco-m','1.1.1',CONFIG.ctaBanco);
  set('cfg-cta-deprec-m','5.',CONFIG.ctaDepreciacion);
  set('cfg-cta-deprec-acum-m','1.2',CONFIG.ctaDeprecAcum);
  set('cfg-cta-ganancia-activo-m','4.',CONFIG.ctaGananciaActivo);
  set('cfg-cta-perdida-activo-m','5.',CONFIG.ctaPerdidaActivo);
  const iaEl=document.getElementById('cfg-ia-endpoint-m'); if(iaEl) iaEl.value=CONFIG.iaEndpoint||'';
  openModal('modal-config');
}
function loadConfig(){
  /* Populate pane-config selects (IDs without -m) and set values from CONFIG */
  const set=(id,pref,val)=>{ const s=document.getElementById(id); if(!s) return; s.innerHTML='<option value="">— Seleccionar —</option>'+(pref?accountOptionsPrefix(pref,val):accountOptions(val)); s.value=val?val+'|'+cuentaNom(val):''; };
  set('cfg-cta-compras','',CONFIG.ctaCompras);
  set('cfg-cta-ventas','',CONFIG.ctaVentas);
  set('cfg-cta-iva-compras','1.',CONFIG.ctaIvaCompras);
  set('cfg-cta-iva-ventas','2.',CONFIG.ctaIvaVentas);
  set('cfg-cta-ingreso','4.',CONFIG.ctaIngreso);
  set('cfg-cta-banco','1.1.1',CONFIG.ctaBanco);
  set('cfg-cta-deprec','5.',CONFIG.ctaDepreciacion);
  set('cfg-cta-deprec-acum','1.2',CONFIG.ctaDeprecAcum);
  set('cfg-cta-ganancia-activo','4.',CONFIG.ctaGananciaActivo);
  set('cfg-cta-perdida-activo','5.',CONFIG.ctaPerdidaActivo);
  const iaEl=document.getElementById('cfg-ia-endpoint'); if(iaEl) iaEl.value=CONFIG.iaEndpoint||'';
}
function saveConfigModal(){
  /* Read from modal (-m) selects if present and visible, otherwise from pane selects */
  const v=id=>{ const el=document.getElementById(id); return el?((el.value||'').split('|')[0]):''; };
  const modalVisible=document.getElementById('modal-config')&&document.getElementById('modal-config').classList.contains('show');
  const r=id=>modalVisible?v(id+'-m')||v(id):v(id)||v(id+'-m');
  const iaId=modalVisible?'cfg-ia-endpoint-m':'cfg-ia-endpoint';
  const iaEl=document.getElementById(iaId); const iaVal=iaEl?iaEl.value.trim():((document.getElementById('cfg-ia-endpoint')||{}).value||'').trim();
  CONFIG = {
    ctaCompras:r('cfg-cta-compras')||CONFIG_DEFAULT.ctaCompras,
    ctaVentas:r('cfg-cta-ventas')||CONFIG_DEFAULT.ctaVentas,
    ctaIvaCompras:r('cfg-cta-iva-compras')||CONFIG_DEFAULT.ctaIvaCompras,
    ctaIvaVentas:r('cfg-cta-iva-ventas')||CONFIG_DEFAULT.ctaIvaVentas,
    ctaIngreso:r('cfg-cta-ingreso')||CONFIG_DEFAULT.ctaIngreso,
    ctaBanco:r('cfg-cta-banco')||CONFIG_DEFAULT.ctaBanco,
    ctaDepreciacion:r('cfg-cta-deprec')||CONFIG_DEFAULT.ctaDepreciacion,
    ctaDeprecAcum:r('cfg-cta-deprec-acum')||CONFIG_DEFAULT.ctaDeprecAcum,
    ctaGananciaActivo:r('cfg-cta-ganancia-activo')||CONFIG_DEFAULT.ctaGananciaActivo,
    ctaPerdidaActivo:r('cfg-cta-perdida-activo')||CONFIG_DEFAULT.ctaPerdidaActivo,
    iaEndpoint:iaVal||''
  };
  LS.set(K.config,CONFIG);
  /* Populate and sync pane-config selects */
  const paneIds=['cfg-cta-compras','cfg-cta-ventas','cfg-cta-iva-compras','cfg-cta-iva-ventas','cfg-cta-ingreso',
   'cfg-cta-banco','cfg-cta-deprec','cfg-cta-deprec-acum','cfg-cta-ganancia-activo','cfg-cta-perdida-activo'];
  const paneMap={
    'cfg-cta-compras':'','cfg-cta-ventas':'','cfg-cta-iva-compras':'1.','cfg-cta-iva-ventas':'2.',
    'cfg-cta-ingreso':'4.','cfg-cta-banco':'1.1.1','cfg-cta-deprec':'5.','cfg-cta-deprec-acum':'1.2',
    'cfg-cta-ganancia-activo':'4.','cfg-cta-perdida-activo':'5.'
  };
  paneIds.forEach(id=>{
    const ps=document.getElementById(id), ms=document.getElementById(id+'-m');
    /* Ensure pane select has options populated */
    if(ps&&!ps.options.length){
      const cfgKey=id.replace('cfg-cta-','').replace(/-/g,'');
      const pref=paneMap[id]||'';
      ps.innerHTML='<option value="">— Seleccionar —</option>'+(pref?accountOptionsPrefix(pref):accountOptions());
    }
    /* Set value on both pane and modal selects */
    const cfgKeys={
      'cfg-cta-compras':'ctaCompras','cfg-cta-ventas':'ctaVentas','cfg-cta-iva-compras':'ctaIvaCompras',
      'cfg-cta-iva-ventas':'ctaIvaVentas','cfg-cta-ingreso':'ctaIngreso','cfg-cta-banco':'ctaBanco',
      'cfg-cta-deprec':'ctaDepreciacion','cfg-cta-deprec-acum':'ctaDeprecAcum',
      'cfg-cta-ganancia-activo':'ctaGananciaActivo','cfg-cta-perdida-activo':'ctaPerdidaActivo'
    };
    const cod=CONFIG[cfgKeys[id]]||'';
    const val=cod?cod+'|'+cuentaNom(cod):'';
    if(ps) ps.value=val;
    if(ms) ms.value=val;
  });
  /* Sync IA endpoint to pane input */
  const iaPane=document.getElementById('cfg-ia-endpoint'); if(iaPane) iaPane.value=CONFIG.iaEndpoint||'';
  /* Only close modal if it was open */
  if(modalVisible) closeModal('modal-config');
  refreshAccountingViews();
  showToast('Configuración contable actualizada');
}

/* ---------- Empresa ---------- */
const EMPRESA_DEFAULT = {nombre:'',ruc:'',ciudad:'',representante:'',contador:''};
let EMPRESA = Object.assign({},EMPRESA_DEFAULT,LS.get(K.empresa,{}) || {});
function getEmpresa(){ return EMPRESA; }
function applyEmpresaToUI(){
  const n=document.getElementById('header-empresa-nombre'), r=document.getElementById('header-empresa-ruc');
  if(n) n.textContent = EMPRESA.nombre || 'Configura tu empresa';
  if(r) r.textContent = EMPRESA.ruc ? 'RUC: '+EMPRESA.ruc : '';
  document.title = (EMPRESA.nombre? EMPRESA.nombre+' · ':'')+'CONTSERTRIB';
}
function loadEmpresa(){ applyEmpresaToUI(); }
function openEmpresaModal(){
  ['nombre','ruc','ciudad','representante','contador'].forEach(f=>{
    const map={nombre:'emp-nombre',ruc:'emp-ruc',ciudad:'emp-ciudad',representante:'emp-rep',contador:'emp-contador'};
    const el=document.getElementById(map[f]);
    if(el) el.value=EMPRESA[f]||'';
  });
  openModal('modal-empresa');
}
function saveEmpresaModal(){
  const g=id=>(document.getElementById(id).value||'').trim();
  const nombre=g('emp-nombre'), ruc=g('emp-ruc');
  if(!nombre||!ruc){ showToast('Ingresa razón social y RUC','err'); return; }
  if(!/^\d{10,13}$/.test(ruc.replace(/\D/g,''))) showToast('Verifica el RUC: en Ecuador tiene 13 dígitos');
  EMPRESA={nombre,ruc,ciudad:g('emp-ciudad'),representante:g('emp-rep'),contador:g('emp-contador')};
  LS.set(K.empresa,EMPRESA);
  applyEmpresaToUI(); closeModal('modal-empresa');
  if(typeof renderEstadoResultados==='function') renderEstadoResultados();
  if(typeof renderBalanceGeneral==='function') renderBalanceGeneral();
  showToast('Datos de la empresa actualizados');
}

/* ---------- Respaldo / restauración / almacenamiento ---------- */
function fmtBytes(b){ return b<1024? Math.round(b)+' B' : b<1048576? (b/1024).toFixed(1)+' KB' : (b/1048576).toFixed(2)+' MB'; }
function usoLocal(){
  let bytes=0;
  try{ const keys=DB.keys(); keys.forEach(k=>{ if(!k.startsWith('ct_'))return; const v=JSON.stringify(DB.get(k)); bytes+=(k.length+(v||'').length)*2; }); }catch(e){}
  return bytes;
}
function renderStorage(){
  /* Storage pane rendering — called by app.js showPane */
  const uso=usoLocal(), limite=5*1024*1024, pct=Math.min(100,uso/limite*100);
  const pane=document.getElementById('pane-storage');
  if(pane){
    const statsDiv=pane.querySelector('.storage-stats');
    if(statsDiv){
      statsDiv.innerHTML=`
        <div class="info-box">
          <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:6px"><span>Uso en este navegador</span><span>${fmtBytes(uso)} de ~50 MB</span></div>
          <div class="bar"><span style="width:${pct.toFixed(1)}%;background:${pct>90?'var(--red)':pct>70?'var(--amber)':'var(--accent)'}"></span></div>
          <div class="text-muted small" style="margin-top:8px">
            Compras: <strong>${(typeof DATA!=='undefined'?DATA.length:0)}</strong> ·
            Ventas: <strong>${(typeof DATA_VENTAS!=='undefined'?DATA_VENTAS.length:0)}</strong> ·
            Retenciones: <strong>${(typeof DATA_RETENCIONES!=='undefined'?DATA_RETENCIONES.length:0)}</strong> ·
            Asientos manuales: <strong>${(typeof MANUAL_ASIENTOS!=='undefined'?MANUAL_ASIENTOS.length:0)}</strong> ·
            Empleados: <strong>${(typeof NOMINA_EMPLEADOS!=='undefined'?NOMINA_EMPLEADOS.length:0)}</strong>
          </div>
        </div>`;
    }
  }
}
async function exportBackup(){
  if(typeof DB!=='undefined' && DB.syncNow) await DB.syncNow();
  const payload={_app:'CONTSERTRIB',_version:2,_fecha:new Date().toISOString(),data:{}};
  Object.values(K).forEach(k=>{ const v=LS.get(k); if(v!==undefined) payload.data[k]=JSON.stringify(v); });
  descargarArchivo(`respaldo_contsertrib_${slug(EMPRESA.nombre)}_${hoyISO()}.json`, JSON.stringify(payload,null,2));
  showToast('Respaldo descargado');
}
function importBackup(ev){
  const f=ev.target.files&&ev.target.files[0]; ev.target.value='';
  if(!f) return;
  const r=new FileReader();
  r.onload=async e=>{
    try{
      const p=JSON.parse(e.target.result);
      if(!p||p._app!=='CONTSERTRIB'||!p.data) throw new Error('formato');
      if(!confirm('Esto reemplazará TODA la información actual por la del respaldo. ¿Continuar?')) return;
      Object.values(K).forEach(k=>LS.del(k));
      Object.entries(p.data).forEach(([k,v])=>{ try{ LS.set(k,JSON.parse(v)); }catch(err){} });
      if(typeof DB!=='undefined' && DB.syncNow) await DB.syncNow();
      showToast('Respaldo restaurado. Recargando...');
      setTimeout(()=>location.reload(),900);
    }catch(err){ showToast('El archivo no es un respaldo válido de CONTSERTRIB','err'); }
  };
  r.readAsText(f);
}
function resetAllData(){
  if(!confirm('Se eliminará TODA la información contable (compras, ventas, asientos, nómina, configuración). ¿Continuar?')) return;
  if(!confirm('Confirmación final: esta acción no se puede deshacer. ¿Borrar todo?')) return;
  Object.values(K).forEach(k=>LS.del(k));
  location.reload();
}

/* ---------- Roles / Permisos ---------- */
const ROLES = {
  admin: {label:'Administrador', perms:['all']},
  contador: {label:'Contador', perms:['contabilidad','reportes','importar','nomina','activos','conciliacion','dashboard']},
  asistente: {label:'Asistente', perms:['contabilidad','importar','compras','ventas','retenciones']},
  consulta: {label:'Solo consulta', perms:['reportes','dashboard']}
};
let CURRENT_ROLE = 'admin';
function setRole(r){ if(ROLES[r]) CURRENT_ROLE=r; }
function hasPerm(perm){ return ROLES[CURRENT_ROLE].perms.includes('all') || ROLES[CURRENT_ROLE].perms.includes(perm); }

/* ---------- Grupos SRI para depreciación de activos ---------- */
const SRI_ACTIVOS_GRUPOS = [
  {cod:'1',nom:'Edificios',vida:20,porc:5},
  {cod:'2',nom:'Vehículos',vida:5,porc:20},
  {cod:'3',nom:'Muebles y Enseres',vida:10,porc:10},
  {cod:'4',nom:'Equipo de Cómputo',vida:3,porc:33.33},
  {cod:'5',nom:'Maquinaria y Equipo',vida:10,porc:10},
  {cod:'6',nom:'Equipo de Oficina',vida:10,porc:10},
  {cod:'7',nom:'Herramientas y Menores',vida:5,porc:20},
  {cod:'8',nom:'Software y Licencias',vida:3,porc:33.33},
  {cod:'9',nom:'Otros Activos',vida:10,porc:10}
];

/* ---------- Mapa de grupo SRI → cuentas contables ---------- */
const ACTIVO_CUENTA_MAP = {
  '1':{cta:'1.2.1.02',depAcum:'1.2.1.09.001'},  // Edificios
  '2':{cta:'1.2.1.05',depAcum:'1.2.1.09.004'},  // Vehículos
  '3':{cta:'1.2.1.04',depAcum:'1.2.1.09.003'},  // Muebles y Enseres
  '4':{cta:'1.2.1.03',depAcum:'1.2.1.09.002'},  // Equipo de Cómputo
  '5':{cta:'1.2.1.06',depAcum:'1.2.1.09.005'},  // Maquinaria y Equipo
  '6':{cta:'1.2.1.07',depAcum:'1.2.1.09.006'},  // Equipo de Oficina
  '7':{cta:'1.2.1.10',depAcum:'1.2.1.09'},      // Herramientas
  '8':{cta:'1.2.2.01',depAcum:'1.2.2.03'},      // Software
  '9':{cta:'1.2.3.01',depAcum:'1.2.1.09'}       // Otros
};

/* ---------- Window exports ---------- */
window.closeModal = closeModal;
window.openGenericModal = openGenericModal;
window.closeGenericModal = ()=>closeModal('modal-generic');
window.sriLink = sriLink;
window.exportBackup = exportBackup;
window.importBackup = importBackup;
window.openConfigModal = openConfigModal;
window.openEmpresaModal = openEmpresaModal;
/* window.openStorageModal removed — function never defined */
window.resetAllData = resetAllData;
window.saveConfigModal = saveConfigModal;
window.saveEmpresaModal = saveEmpresaModal;
/* window.toggleTheme removed — defined in app.js, exported there */
window.openModal = openModal;
window.showToast = showToast;
window.getEmpresa = getEmpresa;
window.setRole = setRole;
window.hasPerm = hasPerm;
window.esc = esc;
window.fmt = fmt;
window.round2 = round2;
window.numOrZero = numOrZero;
window.fmtDate = fmtDate;
window.loadConfig = loadConfig;
window.hoyISO = hoyISO;
window.descargarArchivo = descargarArchivo;