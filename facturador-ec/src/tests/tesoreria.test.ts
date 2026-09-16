import test from 'node:test';
import assert from 'node:assert/strict';
import { construirTransferencia } from '../services/tesoreriaCalculos.js';

test('transferencia caja a banco genera un solo hecho balanceado',()=>{
 const l=construirTransferencia({codigo:'1.1.01.01'},{codigo:'1.1.01.02'},125);
 assert.deepEqual(l.map(x=>[x.codigo,x.debe,x.haber]),[['1.1.01.02',125,0],['1.1.01.01',0,125]]);
});
test('transferencia banco a banco conserva debe = haber',()=>{
 const l=construirTransferencia({codigo:'BANCO-A'},{codigo:'BANCO-B'},10.235);
 assert.equal(l.reduce((s,x)=>s+x.debe,0),10.24);assert.equal(l.reduce((s,x)=>s+x.haber,0),10.24);
});
test('transferencia rechaza monto no positivo y misma cuenta',()=>{
 assert.throws(()=>construirTransferencia({codigo:'A'},{codigo:'B'},0));
 assert.throws(()=>construirTransferencia({codigo:'A'},{codigo:'A'},1));
});
test('SKIP sandbox — idempotencia concurrente de pagos', {skip:'requiere PostgreSQL/Supabase sandbox'},()=>{});
test('SKIP sandbox — periodo cerrado y rollback real', {skip:'requiere PostgreSQL/Supabase sandbox'},()=>{});
test('SKIP sandbox — aislamiento multiempresa real', {skip:'requiere PostgreSQL/Supabase sandbox'},()=>{});
