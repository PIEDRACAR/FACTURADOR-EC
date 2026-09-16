import test from 'node:test';
import assert from 'node:assert/strict';
import { calcularCentrosCosto, calcularEstadoResultados, calcularEstadoSituacion, calcularFlujoEfectivo, presentarSaldo, variacion } from '../services/estadosFinancieros.js';

test('situación incorpora resultado corriente y cuadra 1000 = 400 + 600',()=>{
  const cuentas=[{codigo:'1',nombre:'Activo',tipo:'ACTIVO',saldo:1000},{codigo:'2',nombre:'Pasivo',tipo:'PASIVO',saldo:-400},{codigo:'3',nombre:'Patrimonio',tipo:'PATRIMONIO',saldo:-500}];
  const r=calcularEstadoSituacion(cuentas,100);assert.equal(r.activos,1000);assert.equal(r.pasivos,400);assert.equal(r.patrimonio,600);assert.equal(r.cuadra,true);assert.equal(r.diferencia,0);
});
test('cuenta correctora conserva signo y no usa Math.abs',()=>{
  assert.equal(presentarSaldo({codigo:'1.9',nombre:'Depreciación acumulada',tipo:'ACTIVO',saldo:-125}),-125);
});
test('resultados: ingresos 1000, costo 400, gastos 250, resultado 350',()=>{
  const r=calcularEstadoResultados([{codigo:'4',nombre:'Ingresos',tipo:'INGRESO',saldo:-1000},{codigo:'5.1',nombre:'Costo',tipo:'COSTO',saldo:400},{codigo:'5.2',nombre:'Gasto',tipo:'GASTO',saldo:250}]);
  assert.deepEqual({ingresos:r.ingresos,costos:r.costos,gastos:r.gastos,resultado:r.resultado},{ingresos:1000,costos:400,gastos:250,resultado:350});
});
test('comparativo A=100 B=80 produce variación 20 y 25%',()=>assert.deepEqual(variacion(100,80),{valorA:100,valorB:80,variacion:20,variacionPorcentual:25}));
test('comparativo con base cero devuelve porcentaje null y nunca Infinity',()=>assert.deepEqual(variacion(100,0),{valorA:100,valorB:0,variacion:100,variacionPorcentual:null}));
test('flujo directo reconcilia inicial 100 +50 -20 +10 = 140',()=>{
  const r=calcularFlujoEfectivo(100,[{actividad:'OPERACION',monto:50},{actividad:'INVERSION',monto:-20},{actividad:'FINANCIAMIENTO',monto:10}],140);
  assert.equal(r.efectivoFinal,140);assert.equal(r.reconcilia,true);assert.equal(r.variacionNeta,40);
});
test('centros A y B permanecen independientes y SIN ASIGNAR no se descarta',()=>{
  const r=calcularCentrosCosto([
    {codigo:'4',nombre:'Venta A',tipo:'INGRESO',saldo:-100,centroCostoId:'A',centroNombre:'Centro A'},
    {codigo:'5',nombre:'Gasto B',tipo:'GASTO',saldo:30,centroCostoId:'B',centroNombre:'Centro B'},
    {codigo:'5',nombre:'Gasto libre',tipo:'GASTO',saldo:10,centroCostoId:null}
  ]);
  assert.equal(r.length,3);assert.ok(r.some(x=>x.centro==='Centro A'&&x.resultado===100));assert.ok(r.some(x=>x.centro==='Centro B'&&x.resultado===-30));assert.ok(r.some(x=>x.centro==='SIN ASIGNAR'&&x.resultado===-10));
});
test('cuadre usa tolerancia monetaria explícita',()=>assert.equal(calcularEstadoSituacion([{codigo:'1',nombre:'A',tipo:'ACTIVO',saldo:100.004},{codigo:'2',nombre:'P',tipo:'PASIVO',saldo:-100}],0,.01).cuadra,true));
test.skip('sandbox: reconciliación sobre gran volumen',()=>{});
test.skip('sandbox: centro de costo multiempresa',()=>{});
test.skip('sandbox: estados contra datos reales',()=>{});
test.skip('sandbox: migración de reportería aplicada dos veces',()=>{});
test.skip('sandbox: exportación masiva de estados financieros',()=>{});
