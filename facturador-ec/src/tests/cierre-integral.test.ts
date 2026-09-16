import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root=process.cwd();
const txt=(p:string)=>readFileSync(join(root,p),'utf8');

test('migraciones fase2a están numeradas 01 a 05 y el centro de costo nace antes de ser ampliado',()=>{
  const m4=txt('sql/migracion_fase2a_04_nomina_contabilizacion_pagos.sql');
  const m5=txt('sql/migracion_fase2a_05_reporteria_centros_costos.sql');
  assert.match(m4,/create table if not exists centros_costo/i);
  assert.match(m5,/alter table public\.centros_costo add column if not exists padre_id/i);
  assert.match(m5,/add column if not exists vigente_desde/i);
});
test('migraciones del bloque A-F no contienen SQL destructivo global',()=>{
  for(const f of ['01_nucleo_contable_canonico','02_configuracion_eventos_provisiones','03_caja_bancos_pagos','04_nomina_contabilizacion_pagos','05_reporteria_centros_costos']){
    const s=txt(`sql/migracion_fase2a_${f}.sql`);
    assert.doesNotMatch(s,/\bdrop\s+(table|schema|database)\b/i);
    assert.doesNotMatch(s,/\btruncate\b/i);
  }
});
test('rutas de reportería y UI no permiten emisorId suministrado por el cliente',()=>{
  const r=txt('src/routes/reporteria.ts'),ui=txt('public/contabilidad-ui.js');
  assert.match(r,/usuarioSesion\?\.emisorId/);
  assert.doesNotMatch(r,/query\?\.emisorId|body\?\.emisorId/);
  assert.doesNotMatch(ui,/emisorId/);
});
test('workspace contable contiene las áreas funcionales A-E',()=>{
  const h=txt('public/contabilidad.html');
  for(const id of ['diario','mayor','balanza','nomina','compras','ventas','tesoreria','cxcxp','inventario','reporteria'])assert.match(h,new RegExp(`id="${id}"`));
});
test('reportería profesional ofrece situación, resultados, flujo, centros y comparativo',()=>{
  const r=txt('src/routes/reporteria.ts');
  for(const x of ['situacion-financiera','resultados','flujo-efectivo','centros-costo','comparativo'])assert.match(r,new RegExp(x));
});
test('importación contable directa permanece cerrada y exige preview/confirm',()=>{
  const r=txt('src/routes/contabilidad.ts');
  assert.match(r,/importar-excel\/previsualizar/);assert.match(r,/importar-excel\/confirmar/);assert.match(r,/status\(410\)/);
});
test.skip('sandbox: aplicar migraciones 01→05 desde base compatible limpia',()=>{});
test.skip('sandbox: reaplicar migraciones 01→05 sin cambios ni duplicados',()=>{});
test.skip('sandbox: validar RLS y aislamiento multiempresa en todos los módulos',()=>{});
test.skip('sandbox: smoke end-to-end compra→CxP→pago→asientos→estados',()=>{});
test.skip('sandbox: smoke end-to-end venta→CxC→cobro→asientos→estados',()=>{});
test.skip('sandbox: smoke nómina→aprobación→contabilización→pago→estados',()=>{});
test.skip('sandbox: cierre y reapertura de período con reversos concurrentes',()=>{});
test.skip('sandbox: exportaciones PDF/Excel masivas y consistentes',()=>{});
