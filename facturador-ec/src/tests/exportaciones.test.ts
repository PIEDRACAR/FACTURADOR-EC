import test from 'node:test';
import assert from 'node:assert/strict';
import { filtrosContables, rangoPagina, metadatosExportacion, sanitizarCelda, validarImportManual, agruparAsientosImportados, aplicarFiltrosFilas } from '../services/exportacionesContables.js';

test('filtros de pantalla se conservan en exportación',()=>{
  const f=filtrosContables({desde:'2026-01-01',hasta:'2026-01-31',estado:'CONTABILIZADO',cuenta:'1.1.01',page:'2',pageSize:'100'});
  const m=metadatosExportacion(f,321,new Date('2026-02-01T00:00:00Z'));
  assert.equal(m.filtros.desde,'2026-01-01');assert.equal(m.filtros.cuenta,'1.1.01');assert.equal(m.total,321);assert.equal(m.moneda,'USD');
});
test('paginación es explícita y pageSize está acotado',()=>{
  const f=filtrosContables({page:3,pageSize:99999});assert.equal(f.pageSize,500);assert.deepEqual(rangoPagina(f),{from:1000,to:1499});
});
test('exportación no depende de la página visible',()=>{
  const m=metadatosExportacion(filtrosContables({page:1,pageSize:50}),1200);assert.equal(m.total,1200);assert.notEqual(m.total,m.filtros.pageSize);
});
test('PDF y Excel pueden compartir los mismos filtros y totales',()=>{
  const f=filtrosContables({periodo:'2026-08'}),a=metadatosExportacion(f,88),b=metadatosExportacion(f,88);
  assert.deepEqual(a.filtros,b.filtros);assert.equal(a.total,b.total);
});
test('preview de importación valida sin persistir y agrupa asiento balanceado',()=>{
  const v=validarImportManual([{fecha:'2026-08-31',concepto:'Ajuste',codigo:'1.1',debe:10,haber:0,tipo:'AJUSTE'},{fecha:'2026-08-31',concepto:'Ajuste',codigo:'2.1',debe:0,haber:10,tipo:'AJUSTE'}]);
  assert.equal(v.errores.length,0);const g=agruparAsientosImportados(v.validas);assert.equal(g.length,1);assert.equal(g[0].valido,true);
});
test('import inválido devuelve errores por fila y bloquea asientos automáticos',()=>{
  const v=validarImportManual([{fecha:'mal',concepto:'x',codigo:'1',debe:1,haber:0,tipo:'VENTA'}]);assert.ok(v.errores.some(e=>e.campo==='fecha'));assert.ok(v.errores.some(e=>e.campo==='tipo'));
});
test('import no permite cambiar empresa desde Excel',()=>{
  const v=validarImportManual([{emisor_id:'otra',fecha:'2026-01-01',concepto:'x',codigo:'1',debe:1,haber:0,tipo:'MANUAL'}]);assert.ok(v.errores.some(e=>e.campo==='emisor_id'));
});
test('sanitización neutraliza fórmulas de hoja de cálculo y controles',()=>{
  assert.equal(sanitizarCelda('=HYPERLINK("x")'),'\'=HYPERLINK("x")');assert.equal(sanitizarCelda('hola\u0000'),'hola');
});
test.skip('sandbox: importación transaccional real no persiste parcialmente',()=>{});
test.skip('sandbox: exportación de más de 100k líneas',()=>{});
test.skip('sandbox: aislamiento real multiempresa de import/export',()=>{});

test('export aplica búsqueda y estado sobre el conjunto completo',()=>{const f=filtrosContables({busqueda:'venta',estado:'CONTABILIZADO'});const rows=aplicarFiltrosFilas([{concepto:'Venta 001',estado:'CONTABILIZADO'},{concepto:'Compra',estado:'CONTABILIZADO'}],f);assert.equal(rows.length,1);});
