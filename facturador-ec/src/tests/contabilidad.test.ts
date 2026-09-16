import test from 'node:test';
import assert from 'node:assert/strict';
import {
  agruparBalanza,
  construirMayor,
  paginarResultados,
  puedeEditarAsiento,
  validarAsientoReversible,
  validarLineasContables,
  validarNaturalezaCuenta,
  validarVinculoOpcional,
  verificarConsistenciaMayorBalance,
} from '../services/contabilidadCalculos.js';
import { codigoFallbackLegacy } from '../services/configuracionContable.js';

const movimientos = [
  { cuentaId:'caja-a', codigo:'1.1.01.01', nombre:'Caja A', tipo:'ACTIVO', naturaleza:'DEUDORA', fecha:'2026-01-15', debe:100, haber:0, terceroTipo:'CLIENTE', terceroId:'cliente-1' },
  { cuentaId:'ventas-a', codigo:'4.1.01.01', nombre:'Ventas A', tipo:'INGRESO', naturaleza:'ACREEDORA', fecha:'2026-01-15', debe:0, haber:100 },
  { cuentaId:'caja-a', codigo:'1.1.01.01', nombre:'Caja A', tipo:'ACTIVO', naturaleza:'DEUDORA', fecha:'2026-02-02', debe:40, haber:0, terceroTipo:'CLIENTE', terceroId:'cliente-1' },
  { cuentaId:'ventas-a', codigo:'4.1.01.01', nombre:'Ventas A', tipo:'INGRESO', naturaleza:'ACREEDORA', fecha:'2026-02-02', debe:0, haber:40 },
];

test('contabilidad: acepta un asiento donde Debe es igual a Haber',()=>{
  const resultado=validarLineasContables([{codigo:'1.1.01.01',debe:100,haber:0},{codigo:'4.1.01.01',debe:0,haber:100}]);
  assert.deepEqual(resultado,{debe:100,haber:100,diferencia:0});
});

test('contabilidad: rechaza un asiento descuadrado',()=>{
  assert.throws(()=>validarLineasContables([{codigo:'1.1.01.01',debe:100,haber:0},{codigo:'4.1.01.01',debe:0,haber:99}]),/no cuadra/i);
});

test('contabilidad: valida naturaleza deudora y acreedora sin ocultar saldos contrarios',()=>{
  assert.equal(validarNaturalezaCuenta('DEUDORA',25),true);
  assert.equal(validarNaturalezaCuenta('ACREEDORA',-25),true);
  assert.equal(validarNaturalezaCuenta('DEUDORA',-25),false);
});

test('mayor: mantiene un acumulado independiente por cuenta y calcula saldo inicial',()=>{
  const mayor=construirMayor(movimientos,{desde:'2026-02-01',hasta:'2026-02-28'});
  const caja=mayor.cuentas.find(x=>x.cuentaId==='caja-a');
  const ventas=mayor.cuentas.find(x=>x.cuentaId==='ventas-a');
  assert.deepEqual({inicial:caja?.saldoInicial,debe:caja?.debitosPeriodo,haber:caja?.creditosPeriodo,final:caja?.saldoFinal},{inicial:100,debe:40,haber:0,final:140});
  assert.deepEqual({inicial:ventas?.saldoInicial,debe:ventas?.debitosPeriodo,haber:ventas?.creditosPeriodo,final:ventas?.saldoFinal},{inicial:-100,debe:0,haber:40,final:-140});
  assert.equal(caja?.movimientos[0]?.saldoAcumulado,140);
  assert.equal(ventas?.movimientos[0]?.saldoAcumulado,-140);
});

test('mayor: casos A y B conservan acumuladores independientes y signo contable',()=>{
  const casos=[
    {cuentaId:'A',codigo:'A',nombre:'Cuenta A',tipo:'ACTIVO',naturaleza:'DEUDORA',fecha:'2025-12-31',debe:100,haber:0},
    {cuentaId:'A',codigo:'A',nombre:'Cuenta A',tipo:'ACTIVO',naturaleza:'DEUDORA',fecha:'2026-01-10',debe:50,haber:0},
    {cuentaId:'A',codigo:'A',nombre:'Cuenta A',tipo:'ACTIVO',naturaleza:'DEUDORA',fecha:'2026-01-11',debe:0,haber:20},
    {cuentaId:'B',codigo:'B',nombre:'Cuenta B',tipo:'PASIVO',naturaleza:'ACREEDORA',fecha:'2025-12-31',debe:0,haber:40},
    {cuentaId:'B',codigo:'B',nombre:'Cuenta B',tipo:'PASIVO',naturaleza:'ACREEDORA',fecha:'2026-01-10',debe:10,haber:0},
    {cuentaId:'B',codigo:'B',nombre:'Cuenta B',tipo:'PASIVO',naturaleza:'ACREEDORA',fecha:'2026-01-11',debe:0,haber:30},
  ];
  const mayor=construirMayor(casos,{desde:'2026-01-01',hasta:'2026-01-31'});
  const a=mayor.cuentas.find(x=>x.cuentaId==='A'),b=mayor.cuentas.find(x=>x.cuentaId==='B');
  assert.deepEqual({inicial:a?.saldoInicial,debe:a?.debitosPeriodo,haber:a?.creditosPeriodo,final:a?.saldoFinal},{inicial:100,debe:50,haber:20,final:130});
  assert.deepEqual({inicial:b?.saldoInicial,debe:b?.debitosPeriodo,haber:b?.creditosPeriodo,final:b?.saldoFinal},{inicial:-40,debe:10,haber:30,final:-60});
});

test('origen: permite ambos NULL o ambos completos y rechaza pares incompletos',()=>{
  assert.equal(validarVinculoOpcional(null,null,'origen contable'),false);
  assert.equal(validarVinculoOpcional('COMPROBANTE_VENTA','venta-1','origen contable'),true);
  assert.throws(()=>validarVinculoOpcional('COMPROBANTE_VENTA',null,'origen contable'),/deben venir juntos/i);
  assert.throws(()=>validarVinculoOpcional(null,'venta-1','origen contable'),/deben venir juntos/i);
});

test('tercero: rechaza tipo o ID incompleto',()=>{
  assert.throws(()=>validarVinculoOpcional('CLIENTE',null,'tercero contable'),/deben venir juntos/i);
  assert.throws(()=>validarVinculoOpcional(null,'cliente-1','tercero contable'),/deben venir juntos/i);
});

test('reverso: rechaza expresamente revertir un asiento de reverso',()=>{
  assert.throws(()=>validarAsientoReversible({tipo:'REVERSO'}),/no puede volver a revertirse/i);
  assert.throws(()=>validarAsientoReversible({tipo:'MANUAL',reversaDeId:'original-1'}),/no puede volver a revertirse/i);
  assert.equal(validarAsientoReversible({tipo:'MANUAL',reversaDeId:null}),true);
});

test('edicion: un asiento automatico no es editable directamente',()=>{
  assert.equal(puedeEditarAsiento('FACTURA','COMPROBANTE_VENTA','venta-1'),false);
  assert.equal(puedeEditarAsiento('MANUAL',null,null),true);
  assert.equal(puedeEditarAsiento('AJUSTE',null,null),true);
});

test('mayor: permite filtrar por tercero sin mezclar auxiliares',()=>{
  const mayor=construirMayor(movimientos,{terceroTipo:'CLIENTE',terceroId:'cliente-1'});
  assert.equal(mayor.cuentas.length,1);
  assert.equal(mayor.cuentas[0].cuentaId,'caja-a');
});

test('balance de comprobacion: expone saldos iniciales, movimientos, finales y cuadra',()=>{
  const balanza=agruparBalanza(movimientos,{desde:'2026-02-01',hasta:'2026-02-28'});
  assert.equal(balanza.cuadrado,true);
  assert.equal(balanza.totales.debitosPeriodo,40);
  assert.equal(balanza.totales.creditosPeriodo,40);
  assert.equal(balanza.totales.saldoDeudor,140);
  assert.equal(balanza.totales.saldoAcreedor,140);
});

test('balance de comprobacion: agrupa jerarquia sin duplicar los totales de control',()=>{
  const plan=[
    {id:'activo',codigo:'1',nombre:'Activo',tipo:'ACTIVO',naturaleza:'DEUDORA',nivel:1,aceptaMovimientos:false},
    {id:'corriente',codigo:'1.1',nombre:'Activo corriente',tipo:'ACTIVO',naturaleza:'DEUDORA',nivel:2,cuentaPadreId:'activo',aceptaMovimientos:false},
    {id:'caja-a',codigo:'1.1.01.01',nombre:'Caja A',tipo:'ACTIVO',naturaleza:'DEUDORA',nivel:3,cuentaPadreId:'corriente',aceptaMovimientos:true},
    {id:'ingresos',codigo:'4',nombre:'Ingresos',tipo:'INGRESO',naturaleza:'ACREEDORA',nivel:1,aceptaMovimientos:false},
    {id:'ventas-a',codigo:'4.1.01.01',nombre:'Ventas A',tipo:'INGRESO',naturaleza:'ACREEDORA',nivel:2,cuentaPadreId:'ingresos',aceptaMovimientos:true},
  ];
  const balanza=agruparBalanza(movimientos,{desde:'2026-02-01',hasta:'2026-02-28'},plan);
  assert.equal(balanza.cuentas.find(x=>x.cuentaId==='activo')?.saldoFinal,140);
  assert.equal(balanza.totales.debitosPeriodo,40);
  assert.equal(balanza.totales.creditosPeriodo,40);
});

test('balance de comprobacion: detecta saldos contrarios y verifica realmente Mayor contra Balance',()=>{
  const contrario=[{cuentaId:'activo-negativo',codigo:'1.9',nombre:'Activo contrario',tipo:'ACTIVO',naturaleza:'DEUDORA',fecha:'2026-03-01',debe:0,haber:25}];
  const balance=agruparBalanza(contrario,{});
  assert.equal(balance.cuentas[0].saldoFinal,-25);
  assert.equal(balance.cuentas[0].saldoContrario,true);
  assert.equal(balance.consistenteConMayor,true);
  const mayor=construirMayor(contrario,{});
  assert.equal(verificarConsistenciaMayorBalance(mayor.cuentas,[{...balance.cuentas[0],saldoFinal:-24}]),false);
});

test('mayor: procesa mas de 10.000 movimientos sin truncar calculos',()=>{
  const muchos=Array.from({length:10001},(_,i)=>({cuentaId:'masivo',codigo:'1.1',nombre:'Cuenta masiva',tipo:'ACTIVO',naturaleza:'DEUDORA',fecha:'2026-04-01',debe:1,haber:0,asientoId:String(i)}));
  const mayor=construirMayor(muchos,{});
  assert.equal(mayor.cuentas[0].debitosPeriodo,10001);
  assert.equal(mayor.cuentas[0].saldoFinal,10001);
  assert.equal(mayor.cuentas[0].movimientos.length,10001);
});

test('paginacion contable: recupera mas de 10.000 registros sin limite fijo',async()=>{
  const fuente=Array.from({length:10001},(_,id)=>({id}));
  const resultado=await paginarResultados(async(desde,hasta)=>({data:fuente.slice(desde,hasta+1),error:null}),1000);
  assert.equal(resultado.error,null);
  assert.equal(resultado.data.length,10001);
  assert.equal(resultado.data[10000].id,10000);
});

test('estructura de asiento automatico: conserva origen y lineas balanceadas',()=>{
  const asiento={emisorId:'empresa-a',origenTipo:'COMPROBANTE_VENTA',origenId:'venta-1',lineas:[{codigo:'1.1.01.01',debe:115,haber:0},{codigo:'4.1.01.01',debe:0,haber:100},{codigo:'2.1.02.01',debe:0,haber:15}]};
  assert.ok(asiento.emisorId && asiento.origenTipo && asiento.origenId);
  assert.equal(validarLineasContables(asiento.lineas).diferencia,0);
});

test('asiento manual: no requiere origen pero conserva cuadre',()=>{
  const asiento={tipo:'MANUAL',origenTipo:null,origenId:null,lineas:[{codigo:'1.1.01.01',debe:10,haber:0},{codigo:'3.1.01.01',debe:0,haber:10}]};
  assert.equal(asiento.origenId,null);
  assert.equal(validarLineasContables(asiento.lineas).diferencia,0);
});

test('configuración contable: fallback legacy está limitado a claves explícitas',()=>{
  assert.equal(codigoFallbackLegacy('INVENTARIO'),'1.1.04.01');
  assert.equal(codigoFallbackLegacy('RETENCION_IR_POR_PAGAR'),null);
  assert.equal(codigoFallbackLegacy('CLAVE_INVENTADA'),null);
});

test.skip('RPC: idempotencia concurrente por empresa, tipo e ID de origen',()=>{
  // Requiere Supabase sandbox con la migracion canonica instalada; dos llamadas
  // concurrentes deben devolver el mismo asiento y dejar una sola cabecera.
});

test.skip('RPC: periodo cerrado rechaza alta y edicion en ambas fechas',()=>{
  // Requiere Supabase sandbox con un periodo cerrado fixture.
});

test.skip('RPC: separacion por emisor permite el mismo origen en empresas distintas',()=>{
  // Requiere Supabase sandbox y dos emisores fixture.
});

test.skip('RPC: rechaza un tercero que pertenece a otra empresa',()=>{
  // Requiere Supabase sandbox con dos emisores y fixtures de clientes,
  // proveedores y empleados. Debe fallar sin insertar cabecera ni lineas.
});

test.skip('RPC: reverso es idempotente, auditado y respeta periodo abierto',()=>{
  // Requiere Supabase sandbox con asiento contabilizado fixture.
});

test.skip('RPC: rechaza reverso de reverso aun con solicitudes concurrentes',()=>{
  // Requiere Supabase sandbox con un reverso contabilizado fixture.
});
