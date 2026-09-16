import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calcularRolEmpleado,
  construirAsientoNomina,
  construirAsientoPagoNomina,
  estadoSiguientePermitido,
  parametrosVigentes,
  resumirPagos,
  validarNovedades,
} from '../services/nominaCalculos.js';

const parametros=[
  {codigo:'IESS_PERSONAL_PCT',valor:9.5,tipo:'PORCENTAJE',vigenciaDesde:'2026-01-01',vigenciaHasta:'2026-06-30'},
  {codigo:'IESS_PERSONAL_PCT',valor:10,tipo:'PORCENTAJE',vigenciaDesde:'2026-07-01',vigenciaHasta:null},
  {codigo:'IESS_PATRONAL_PCT',valor:12,tipo:'PORCENTAJE',vigenciaDesde:'2026-01-01',vigenciaHasta:null},
  {codigo:'SBU',valor:500,tipo:'MONTO',vigenciaDesde:'2026-01-01',vigenciaHasta:null},
  {codigo:'FACTOR_DECIMO_TERCERO',valor:12,tipo:'DIVISOR',vigenciaDesde:'2026-01-01',vigenciaHasta:null},
  {codigo:'FACTOR_DECIMO_CUARTO',valor:12,tipo:'DIVISOR',vigenciaDesde:'2026-01-01',vigenciaHasta:null},
  {codigo:'FACTOR_VACACIONES',valor:24,tipo:'DIVISOR',vigenciaDesde:'2026-01-01',vigenciaHasta:null},
  {codigo:'FACTOR_FONDO_RESERVA',valor:12,tipo:'DIVISOR',vigenciaDesde:'2026-01-01',vigenciaHasta:null},
  {codigo:'MESES_FONDO_RESERVA',valor:12,tipo:'ENTERO',vigenciaDesde:'2026-01-01',vigenciaHasta:null},
];

test('selecciona parametros por vigencia sin alterar el historico',()=>{
  assert.equal(parametrosVigentes(parametros,'2026-05').IESS_PERSONAL_PCT.valor,9.5);
  assert.equal(parametrosVigentes(parametros,'2026-08').IESS_PERSONAL_PCT.valor,10);
});

test('calcula empleado activo solo durante su parte del periodo y conserva snapshot',()=>{
  const r=calcularRolEmpleado({id:'e1',sueldoBase:600,fechaIngreso:'2026-05-16',fechaSalida:null,acumulaDecimoTercero:false,acumulaDecimoCuarto:false,fondoReservaMensual:false},'2026-05',parametros,[]);
  assert.equal(r.diasPagados,16);
  assert.equal(r.sueldo,309.68);
  assert.equal(r.parametrosSnapshot.IESS_PERSONAL_PCT.valor,9.5);
});

test('rubros y novedades afectan ingresos, descuentos y base IESS',()=>{
  const rubros=[{codigo:'BONO',tipo:'INGRESO',afectaIess:true,valor:100},{codigo:'MULTA',tipo:'DESCUENTO',afectaIess:false,valor:20}];
  const r=calcularRolEmpleado({id:'e1',sueldoBase:600,fechaIngreso:'2025-01-01'},'2026-05',parametros,rubros);
  assert.equal(r.otrosIngresos,100); assert.equal(r.otrasDeducciones,20); assert.equal(r.iessBase,700);
});

test('rechaza novedades negativas y duplicadas',()=>{
  assert.throws(()=>validarNovedades([{idempotenciaClave:'x',tipo:'BONO',valor:-1}]),/negativo/i);
  assert.throws(()=>validarNovedades([{idempotenciaClave:'x',tipo:'BONO',valor:1},{idempotenciaClave:'x',tipo:'BONO',valor:1}]),/duplicada/i);
});

test('flujo de estados no permite saltos',()=>{
  assert.equal(estadoSiguientePermitido('BORRADOR','CALCULADO'),true);
  assert.equal(estadoSiguientePermitido('CALCULADO','APROBADO'),false);
  assert.equal(estadoSiguientePermitido('APROBADO','CONTABILIZADO'),true);
  assert.equal(estadoSiguientePermitido('PAGADO','CALCULADO'),false);
});

test('asiento de nomina incluye provisiones y cuadra',()=>{
  const lineas=construirAsientoNomina([
    {codigo:'GASTO_SUELDOS',debe:1000,haber:0},{codigo:'GASTO_IESS',debe:120,haber:0},
    {codigo:'PROVISION_VACACIONES_GASTO',debe:50,haber:0},{codigo:'SUELDOS_POR_PAGAR',debe:0,haber:955},
    {codigo:'IESS_POR_PAGAR',debe:0,haber:165},{codigo:'PROVISION_VACACIONES_POR_PAGAR',debe:0,haber:50},
  ]);
  assert.equal(lineas.reduce((s,x)=>s+x.debe,0),lineas.reduce((s,x)=>s+x.haber,0));
  assert.ok(lineas.every(x=>x.debe>=0&&x.haber>=0));
});

test('pago parcial y total actualizan saldo sin excederlo',()=>{
  assert.deepEqual(resumirPagos(1000,[250,250]),{total:1000,pagado:500,pendiente:500,estado:'CONTABILIZADO'});
  assert.deepEqual(resumirPagos(1000,[1000]),{total:1000,pagado:1000,pendiente:0,estado:'PAGADO'});
  assert.throws(()=>resumirPagos(1000,[1001]),/excede/i);
  const l=construirAsientoPagoNomina(250,'SUELDOS_POR_PAGAR','BANCO');
  assert.equal(l[0].debe,250);assert.equal(l[1].haber,250);
});

test.skip('sandbox: contabilizacion concurrente y doble clic no duplican asiento',()=>{});
test.skip('sandbox: periodo contable cerrado rechaza el asiento y revierte toda la transaccion',()=>{});
test.skip('sandbox: reintento concurrente de pago no duplica pago, asiento ni movimiento bancario',()=>{});
test.skip('sandbox: aislamiento multiempresa y permisos se validan contra Supabase',()=>{});
test.skip('sandbox: reverso de nomina y pagos conserva trazabilidad',()=>{});
