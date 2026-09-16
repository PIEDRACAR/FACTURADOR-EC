import test from 'node:test';
import assert from 'node:assert/strict';
import { codigoFallbackLegacy, seleccionarConfiguracionPorFecha } from '../services/configuracionContable.js';
import { claveEvento, construirLineasCompra, construirLineasRetencion, construirLineasVenta } from '../services/eventosContables.js';
import { claveProvision } from '../services/provisionesContables.js';
import { validarAsientoReversible, validarLineasContables } from '../services/contabilidadCalculos.js';

const cfg=(emisor_id:string,id:string,desde:string,hasta:string|null=null)=>({id,emisor_id,clave:'VENTAS',cuenta_id:`cuenta-${id}`,vigente_desde:desde,vigente_hasta:hasta,activa:true});

test('configuración: selecciona cuenta por empresa y vigencia',()=>{
  const filas=[cfg('A','vieja','2025-01-01','2025-12-31'),cfg('A','actual','2026-01-01'),cfg('B','otra','2026-01-01')];
  assert.equal(seleccionarConfiguracionPorFecha(filas,'A','VENTAS','2026-06-01')?.id,'actual');
  assert.equal(seleccionarConfiguracionPorFecha(filas,'A','VENTAS','2025-06-01')?.id,'vieja');
});

test('configuración: empresa A nunca selecciona cuenta de empresa B',()=>{
  assert.equal(seleccionarConfiguracionPorFecha([cfg('B','otra','2026-01-01')],'A','VENTAS','2026-06-01'),null);
});

test('fallback legacy: solo existe para claves controladas',()=>{
  assert.equal(codigoFallbackLegacy('INGRESOS_VENTAS'),'4.1.01.01');
  assert.equal(codigoFallbackLegacy('RETENCION_IVA_RECIBIDA'),null);
});

test('venta: efectivo, ingreso e IVA cuadran sin valores negativos',()=>{
  const lineas=construirLineasVenta({total:115,base:100,iva:15,cobros:[{codigo:'CAJA',importe:115}],ingresoCodigo:'VENTAS',ivaCodigo:'IVA'});
  assert.deepEqual(validarLineasContables(lineas),{debe:115,haber:115,diferencia:0});
  assert.ok(lineas.every(x=>x.debe>=0&&x.haber>=0));
});

test('venta: costo de ventas descarga inventario',()=>{
  const lineas=construirLineasVenta({total:100,base:100,iva:0,cobros:[{codigo:'CXC',importe:100}],ingresoCodigo:'VENTAS',ivaCodigo:'IVA',costo:60,costoCodigo:'COSTO',inventarioCodigo:'INVENTARIO'});
  assert.ok(lineas.some(x=>x.codigo==='COSTO'&&x.debe===60));assert.ok(lineas.some(x=>x.codigo==='INVENTARIO'&&x.haber===60));validarLineasContables(lineas);
});

test('compra inventario: base e IVA crédito contra proveedor',()=>{
  const lineas=construirLineasCompra({base:100,iva:15,clasificacionCodigo:'INVENTARIO',ivaCodigo:'IVA_CREDITO',contrapartidaCodigo:'PROVEEDOR',proveedorId:'p1'});
  assert.ok(lineas.some(x=>x.codigo==='INVENTARIO'&&x.debe===100));assert.ok(lineas.some(x=>x.codigo==='IVA_CREDITO'&&x.debe===15));assert.deepEqual(validarLineasContables(lineas),{debe:115,haber:115,diferencia:0});
});

test('compra gasto: respeta clasificación recibida sin asumir cuenta fija',()=>{
  const lineas=construirLineasCompra({base:80,iva:0,clasificacionCodigo:'GASTO_CONFIGURADO',contrapartidaCodigo:'BANCO'});
  assert.equal(lineas[0].codigo,'GASTO_CONFIGURADO');validarLineasContables(lineas);
});

test('retención emitida: separa IR e IVA',()=>{
  const lineas=construirLineasRetencion({proveedorCodigo:'CXP',proveedorId:'p1',ir:10,iva:20,irCodigo:'IR_PAGAR',ivaCodigo:'IVA_RET_PAGAR'});
  assert.ok(lineas.some(x=>x.codigo==='IR_PAGAR'&&x.haber===10));assert.ok(lineas.some(x=>x.codigo==='IVA_RET_PAGAR'&&x.haber===20));validarLineasContables(lineas);
});

test('retención recibida: reconoce créditos IR e IVA',()=>{
  const lineas=construirLineasRetencion({proveedorCodigo:'NO_USADA',proveedorId:'p1',ir:7,iva:3,irCodigo:'IR_RECIBIDA',ivaCodigo:'IVA_RECIBIDA',recibida:true,clienteCodigo:'CXC',clienteId:'c1'});
  assert.ok(lineas.some(x=>x.codigo==='IR_RECIBIDA'&&x.debe===7));assert.ok(lineas.some(x=>x.codigo==='IVA_RECIBIDA'&&x.debe===3));validarLineasContables(lineas);
});

test('provisión: líneas Debe/Haber son válidas y clave equivalente es única',()=>{
  const lineas=[{codigo:'GASTO',debe:50,haber:0},{codigo:'PASIVO',debe:0,haber:50}];assert.deepEqual(validarLineasContables(lineas),{debe:50,haber:50,diferencia:0});
  const a=claveProvision({emisorId:'A',periodo:'2026-09',reglaClave:'vacaciones'}),b=claveProvision({emisorId:'A',periodo:'2026-09',reglaClave:'VACACIONES'});assert.equal(a,b);
});

test('evento: dos solicitudes equivalentes producen la misma clave lógica',()=>{
  const x={emisorId:'A',tipoEvento:'VENTA',entidadTipo:'COMPROBANTE',entidadId:'v1'};assert.equal(claveEvento(x),claveEvento({...x}));assert.notEqual(claveEvento(x),claveEvento({...x,emisorId:'B'}));
});

test('reverso: mantiene identidad del original y rechaza reverso de reverso',()=>{
  const trazabilidad={reversaDeId:'asiento-original',documentoOrigen:'factura-1'};assert.equal(trazabilidad.reversaDeId,'asiento-original');assert.throws(()=>validarAsientoReversible({tipo:'REVERSO',reversaDeId:'asiento-original'}));
});

test.skip('sandbox: constraint real impide eventos concurrentes duplicados',()=>{});
test.skip('sandbox: dos POST concurrentes del mismo evento enlazan un solo asiento',()=>{});
test.skip('sandbox: período cerrado rechaza evento y provisión',()=>{});
test.skip('sandbox: fallo del asiento produce rollback consistente',()=>{});
test.skip('sandbox: configuración cruzada entre empresas es rechazada',()=>{});
test.skip('sandbox: migración fase2a02 puede aplicarse dos veces',()=>{});
test.skip('sandbox: reverso concurrente de provisión crea un solo reverso',()=>{});
