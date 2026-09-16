import { supabase } from '../db/supabase.js';
import { resolverCuentaContable } from './configuracionContable.js';
import { contabilizarEvento } from './eventosContables.js';
import { validarLineasContables } from './contabilidadCalculos.js';

const money=(n:number)=>Math.round(Number(n)*100)/100;
import type { LineaTesoreria } from './tesoreriaCalculos.js';
export { construirTransferencia } from './tesoreriaCalculos.js';
async function crearAsiento(emisorId:string,fecha:string,tipo:string,concepto:string,origenTipo:string,origenId:string,lineas:LineaTesoreria[],userId?:string){
  validarLineasContables(lineas);
  const r=await contabilizarEvento({emisorId,tipoEvento:tipo,entidadTipo:origenTipo,entidadId:origenId,fechaContable:fecha,tipoAsiento:tipo,concepto,lineas,snapshot:{tesoreria:true},createdBy:userId,origenTipo,origenId});
  return r.asientoId;
}
export async function resolverCuentaTesoreria(emisorId:string,fecha:string,args:{cuentaBancariaId?:string;caja?:boolean}){
  if(args.cuentaBancariaId){
    const {data,error}=await supabase.from('cuentas_bancarias').select('id,emisor_id,cuenta_contable_id,plan_cuentas_contables!inner(id,codigo,acepta_movimientos,activa,emisor_id)').eq('id',args.cuentaBancariaId).eq('emisor_id',emisorId).eq('activa',true).single();
    if(error||!data) throw new Error('Cuenta bancaria no encontrada para la empresa activa.');
    const c:any=(data as any).plan_cuentas_contables;if(!c?.activa||!c?.acepta_movimientos||c.emisor_id!==emisorId)throw new Error('La cuenta contable bancaria no es válida.');
    return {codigo:String(c.codigo),cuentaBancariaId:data.id};
  }
  const c=await resolverCuentaContable(emisorId,'CAJA',fecha);return {codigo:c.codigo};
}
export async function contabilizarMovimientoCaja(movimientoId:string,emisorId:string,userId?:string){
  const {data:m,error}=await supabase.from('movimientos_caja').select('id,caja_id,tipo,concepto,monto,cuenta_contrapartida_id,created_at,asiento_id,cajas!inner(emisor_id)').eq('id',movimientoId).single();
  if(error||!m||(m as any).cajas?.emisor_id!==emisorId)throw new Error('Movimiento de caja no encontrado para la empresa activa.');
  if(m.asiento_id)return {asientoId:m.asiento_id,estado:'YA_CONTABILIZADO'};
  if(!m.cuenta_contrapartida_id)throw new Error('El movimiento requiere una cuenta de contrapartida explícita.');
  const {data:contra}=await supabase.from('plan_cuentas_contables').select('id,codigo,emisor_id,activa,acepta_movimientos').eq('id',m.cuenta_contrapartida_id).eq('emisor_id',emisorId).single();
  if(!contra||!contra.activa||!contra.acepta_movimientos)throw new Error('Contrapartida inválida para la empresa activa.');
  const fecha=String(m.created_at).slice(0,10), caja=await resolverCuentaTesoreria(emisorId,fecha,{caja:true}),v=money(m.monto);
  const ingreso=String(m.tipo).toLowerCase()==='ingreso';
  const lineas=ingreso?[{codigo:caja.codigo,debe:v,haber:0},{codigo:contra.codigo,debe:0,haber:v}]:[{codigo:contra.codigo,debe:v,haber:0},{codigo:caja.codigo,debe:0,haber:v}];
  const asientoId=await crearAsiento(emisorId,fecha,'MOVIMIENTO_CAJA',m.concepto,'MOVIMIENTO_CAJA',m.id,lineas,userId);
  await supabase.from('movimientos_caja').update({emisor_id:emisorId,estado_contable:'CONTABILIZADO',asiento_id:asientoId}).eq('id',m.id);
  return {asientoId,estado:'CONTABILIZADO'};
}
export async function contabilizarMovimientoBancario(movimientoId:string,emisorId:string,userId?:string){
 const {data:m,error}=await supabase.from('movimientos_bancarios').select('*').eq('id',movimientoId).eq('emisor_id',emisorId).single();
 if(error||!m)throw new Error('Movimiento bancario no encontrado para la empresa activa.');if(m.asiento_id)return {asientoId:m.asiento_id,estado:'YA_CONTABILIZADO'};
 if(!m.origen_tipo||!m.origen_id)throw new Error('El movimiento bancario requiere una contrapartida/origen contable explícito.');
 const banco=await resolverCuentaTesoreria(emisorId,m.fecha,{cuentaBancariaId:m.cuenta_bancaria_id});
 const {data:contra}=await supabase.from('plan_cuentas_contables').select('codigo,emisor_id,activa,acepta_movimientos').eq('id',m.origen_id).eq('emisor_id',emisorId).single();
 if(!contra||!contra.activa||!contra.acepta_movimientos)throw new Error('Contrapartida bancaria inválida.');
 const v=money(m.monto),ingreso=m.tipo==='INGRESO';
 const lineas=ingreso?[{codigo:banco.codigo,debe:v,haber:0},{codigo:contra.codigo,debe:0,haber:v}]:[{codigo:contra.codigo,debe:v,haber:0},{codigo:banco.codigo,debe:0,haber:v}];
 const asientoId=await crearAsiento(emisorId,m.fecha,'MOVIMIENTO_BANCARIO',m.concepto,'MOVIMIENTO_BANCARIO',m.id,lineas,userId);
 await supabase.from('movimientos_bancarios').update({estado_contable:'CONTABILIZADO',asiento_id:asientoId}).eq('id',m.id).eq('emisor_id',emisorId);
 return {asientoId,estado:'CONTABILIZADO'};
}
