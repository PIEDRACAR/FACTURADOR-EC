import { resolverCuentas } from './configuracionContable.js';
import { contabilizarEvento, marcarEventoReversado } from './eventosContables.js';
import { validarLineasContables } from './contabilidadCalculos.js';
const obtenerSupabase=async()=> (await import('../db/supabase.js')).supabase;

const money=(n:number)=>Math.round(Number(n)*100)/100;
const reglaSegura=(x:string)=>{const r=String(x||'').trim().toUpperCase();if(!/^[A-Z0-9_]{2,60}$/.test(r))throw new Error('reglaClave inválida.');return r;};
export function claveProvision(x:{emisorId:string;periodo:string;reglaClave:string;origenTipo?:string|null;origenId?:string|null;version?:number}){return `${x.emisorId}|${x.periodo}|${reglaSegura(x.reglaClave)}|${x.origenTipo||'GLOBAL'}|${x.origenId||'GLOBAL'}|${x.version||1}`;}
async function validarOrigenProvision(emisorId:string,tipo?:string|null,id?:string|null){
  const supabase=await obtenerSupabase();
  if(!tipo&&!id)return;if(!tipo||!id)throw new Error('Origen de provisión incompleto.');
  const tablas:Record<string,string>={COMPROBANTE:'comprobantes',DOCUMENTO_SRI:'documentos_sri_borrador',MOVIMIENTO_INVENTARIO:'movimientos_inventario',CUENTA_POR_COBRAR:'cuentas_por_cobrar',CUENTA_POR_PAGAR:'cuentas_por_pagar',EMPLEADO:'nomina_empleados'};
  const tabla=tablas[String(tipo).toUpperCase()];if(!tabla)throw new Error(`Origen de provisión no soportado: ${tipo}.`);
  const {data,error}=await supabase.from(tabla).select('id,emisor_id').eq('id',id).eq('emisor_id',emisorId).maybeSingle();if(error||!data)throw new Error('El origen de la provisión no pertenece a la empresa activa.');
}

export async function previsualizarProvision(x:{emisorId:string;periodo:string;tipoProvision:string;reglaClave:string;importe:number;origenTipo?:string|null;origenId?:string|null}){
  if(!x.emisorId||!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(x.periodo))throw new Error('Empresa y período YYYY-MM son obligatorios.');
  await validarOrigenProvision(x.emisorId,x.origenTipo,x.origenId);
  const importe=money(x.importe);if(importe<=0)throw new Error('El importe de provisión debe ser mayor que cero.');
  const regla=reglaSegura(x.reglaClave),fecha=`${x.periodo}-${new Date(Number(x.periodo.slice(0,4)),Number(x.periodo.slice(5,7)),0).getDate().toString().padStart(2,'0')}`;
  const claves=[`PROVISION_${regla}_DEBE`,`PROVISION_${regla}_HABER`];const cuentas=await resolverCuentas(x.emisorId,claves,fecha);
  const lineas=[{codigo:cuentas[claves[0]].codigo,descripcion:`Provisión ${x.tipoProvision}`,debe:importe,haber:0},{codigo:cuentas[claves[1]].codigo,descripcion:`Contrapartida provisión ${x.tipoProvision}`,debe:0,haber:importe}];validarLineasContables(lineas);
  return {periodo:x.periodo,fecha,tipoProvision:x.tipoProvision,reglaClave:regla,importe,lineas,cuentas:Object.values(cuentas).map(c=>c.snapshot),advertencias:[] as string[],snapshot:{regla,importe,cuentas:Object.values(cuentas).map(c=>c.snapshot)}};
}

export async function contabilizarProvision(x:{emisorId:string;periodo:string;tipoProvision:string;reglaClave:string;importe:number;origenTipo?:string|null;origenId?:string|null;createdBy?:string}){
  const supabase=await obtenerSupabase();
  const vista=await previsualizarProvision(x);const version=1;
  const periodo=await supabase.from('periodos_contables').select('estado').eq('emisor_id',x.emisorId).eq('periodo',x.periodo).maybeSingle();if(periodo.error)throw new Error(periodo.error.message);if(String(periodo.data?.estado||'ABIERTO').toUpperCase()==='CERRADO')throw new Error(`El período ${x.periodo} está cerrado.`);
  const buscar=()=>{let q=supabase.from('provisiones_contables').select('*').eq('emisor_id',x.emisorId).eq('periodo',x.periodo).eq('regla_clave',vista.reglaClave).eq('version_provision',version);q=x.origenId?q.eq('origen_tipo',x.origenTipo||'').eq('origen_id',x.origenId):q.is('origen_tipo',null).is('origen_id',null);return q.maybeSingle();};
  const previa=await buscar();if(previa.error)throw new Error(previa.error.message);let provision=previa.data;
  if(provision?.estado==='CONTABILIZADO'&&provision.asiento_id)return {provision,estado:'YA_CONTABILIZADO'};
  if(!provision){const alta=await supabase.from('provisiones_contables').insert({emisor_id:x.emisorId,periodo:x.periodo,tipo_provision:x.tipoProvision,origen_tipo:x.origenId?x.origenTipo:null,origen_id:x.origenId||null,regla_clave:vista.reglaClave,version_provision:version,importe:vista.importe,estado:'PENDIENTE',snapshot:vista.snapshot,created_by:x.createdBy||null}).select('*').single();if(alta.error){if(alta.error.code==='23505'){provision=(await buscar()).data;}else throw new Error(alta.error.message);}else provision=alta.data;}
  if(!provision)throw new Error('No se pudo registrar la provisión idempotente.');
  try{const evento=await contabilizarEvento({emisorId:x.emisorId,tipoEvento:'PROVISION_CONTABLE',entidadTipo:'PROVISION_CONTABLE',entidadId:provision.id,fechaContable:vista.fecha,tipoAsiento:'PROVISION',concepto:`Provisión ${x.tipoProvision} ${x.periodo}`,referencia:`${vista.reglaClave}:${x.periodo}`,lineas:vista.lineas,snapshot:vista.snapshot,createdBy:x.createdBy,origenTipo:'PROVISION_CONTABLE',origenId:provision.id});const up=await supabase.from('provisiones_contables').update({estado:'CONTABILIZADO',asiento_id:evento.asientoId,error:null,snapshot:vista.snapshot,updated_at:new Date().toISOString()}).eq('id',provision.id).eq('emisor_id',x.emisorId).select('*').single();if(up.error)throw new Error(up.error.message);return {provision:up.data,evento,estado:evento.estado};}catch(e){await supabase.from('provisiones_contables').update({estado:'ERROR',error:e instanceof Error?e.message:String(e),updated_at:new Date().toISOString()}).eq('id',provision.id).eq('emisor_id',x.emisorId);throw e;}
}

export async function listarProvisiones(emisorId:string,periodo?:string){const supabase=await obtenerSupabase();let q=supabase.from('provisiones_contables').select('*').eq('emisor_id',emisorId).order('created_at',{ascending:false});if(periodo)q=q.eq('periodo',periodo);const {data,error}=await q;if(error)throw new Error(error.message);return data||[];}

export async function reversarProvision(x:{emisorId:string;provisionId:string;fecha:string;motivo:string;userId?:string}){
  const supabase=await obtenerSupabase();
  const {data:p,error}=await supabase.from('provisiones_contables').select('*').eq('id',x.provisionId).eq('emisor_id',x.emisorId).single();if(error||!p)throw new Error('Provisión no encontrada para la empresa activa.');if(!p.asiento_id)throw new Error('La provisión no tiene asiento contabilizado.');if(p.reverso_asiento_id)return {id:p.reverso_asiento_id,estado:'YA_REVERSADO'};
  const {reversarAsientoContable}=await import('./motorContable.js');const reverso=await reversarAsientoContable(p.asiento_id,x.emisorId,x.fecha,x.motivo,x.userId);const up=await supabase.from('provisiones_contables').update({estado:'REVERSADO',reverso_asiento_id:reverso.id,updated_at:new Date().toISOString()}).eq('id',p.id).eq('emisor_id',x.emisorId);if(up.error)throw new Error(up.error.message);await marcarEventoReversado(x.emisorId,p.asiento_id,reverso.id);return reverso;
}
