import { validarLineasContables, validarVinculoOpcional } from './contabilidadCalculos.js';
const obtenerSupabase=async()=> (await import('../db/supabase.js')).supabase;

export type LineaEvento={codigo:string;descripcion?:string;debe:number;haber:number;terceroTipo?:string;terceroId?:string};
export type EventoClave={emisorId:string;tipoEvento:string;entidadTipo:string;entidadId:string;versionEvento?:number};
export function claveEvento(x:EventoClave){return `${x.emisorId}|${x.tipoEvento}|${x.entidadTipo}|${x.entidadId}|${x.versionEvento||1}`;}

export async function obtenerORegistrarEvento(x:EventoClave&{fechaContable:string;snapshot?:unknown;createdBy?:string}){
  const supabase=await obtenerSupabase();
  if(!x.emisorId||!x.tipoEvento||!x.entidadTipo||!x.entidadId)throw new Error('Evento contable incompleto.');
  const version=x.versionEvento||1;
  const buscar=()=>supabase.from('eventos_contabilizacion').select('*').eq('emisor_id',x.emisorId).eq('tipo_evento',x.tipoEvento).eq('entidad_tipo',x.entidadTipo).eq('entidad_id',x.entidadId).eq('version_evento',version).maybeSingle();
  const previo=await buscar();if(previo.error)throw new Error(previo.error.message);if(previo.data)return previo.data;
  const alta=await supabase.from('eventos_contabilizacion').insert({emisor_id:x.emisorId,tipo_evento:x.tipoEvento,entidad_tipo:x.entidadTipo,entidad_id:x.entidadId,version_evento:version,fecha_contable:x.fechaContable,estado:'PENDIENTE',configuracion_snapshot:x.snapshot||{},created_by:x.createdBy||null}).select('*').single();
  if(!alta.error)return alta.data;
  if(alta.error.code==='23505'){const existente=await buscar();if(existente.data)return existente.data;}
  throw new Error(alta.error.message);
}

export async function contabilizarEvento(x:EventoClave&{fechaContable:string;tipoAsiento:string;concepto:string;referencia?:string|null;lineas:LineaEvento[];snapshot?:unknown;createdBy?:string;origenTipo?:string;origenId?:string}){
  const supabase=await obtenerSupabase();
  validarVinculoOpcional(x.origenTipo||x.entidadTipo,x.origenId||x.entidadId,'origen contable');
  for(const l of x.lineas)validarVinculoOpcional(l.terceroTipo,l.terceroId,'tercero contable');
  validarLineasContables(x.lineas);
  const snapshot=x.snapshot||{cuentas:[...new Set(x.lineas.map(l=>l.codigo))],fechaContable:x.fechaContable};
  const evento=await obtenerORegistrarEvento({...x,snapshot});
  if(evento.estado==='CONTABILIZADO'&&evento.asiento_id)return {eventoId:evento.id,asientoId:evento.asiento_id,estado:'YA_CONTABILIZADO'};
  await supabase.from('eventos_contabilizacion').update({estado:'CONTABILIZANDO',error:null,updated_at:new Date().toISOString()}).eq('id',evento.id).eq('emisor_id',x.emisorId);
  const lineas=x.lineas.map(l=>({codigo:l.codigo,descripcion:l.descripcion||x.concepto,debe:l.debe,haber:l.haber,tercero_tipo:l.terceroTipo||null,tercero_id:l.terceroId||null}));
  const origenTipo=x.origenTipo||x.entidadTipo,origenId=x.origenId||x.entidadId;
  const rpc=await supabase.rpc('crear_asiento_contable_atomico',{p_emisor_id:x.emisorId,p_fecha:x.fechaContable,p_tipo:x.tipoAsiento,p_concepto:x.concepto,p_referencia:x.referencia||null,p_origen_tipo:origenTipo,p_origen_id:origenId,p_created_by:x.createdBy||null,p_lineas:lineas});
  if(rpc.error){await supabase.from('eventos_contabilizacion').update({estado:'ERROR',error:rpc.error.message,updated_at:new Date().toISOString()}).eq('id',evento.id).eq('emisor_id',x.emisorId);throw new Error(rpc.error.message);}
  const asientoId=String(rpc.data);const enlace=await supabase.from('eventos_contabilizacion').update({estado:'CONTABILIZADO',asiento_id:asientoId,error:null,configuracion_snapshot:snapshot,updated_at:new Date().toISOString()}).eq('id',evento.id).eq('emisor_id',x.emisorId);
  if(enlace.error)throw new Error(`Asiento creado pero no se pudo enlazar el evento: ${enlace.error.message}`);
  return {eventoId:evento.id,asientoId,estado:'CONTABILIZADO'};
}

export async function marcarEventoReversado(emisorId:string,asientoId:string,reversoId:string){
  const supabase=await obtenerSupabase();
  const {error}=await supabase.from('eventos_contabilizacion').update({estado:'REVERSADO',error:null,updated_at:new Date().toISOString()}).eq('emisor_id',emisorId).eq('asiento_id',asientoId);
  if(error)throw new Error(error.message);
  return {asientoId,reversoId};
}

export function construirLineasVenta(c:{total:number;base:number;iva:number;cobros:Array<{codigo:string;importe:number}>;cxcCodigo?:string;ingresoCodigo:string;ivaCodigo:string;costo?:number;costoCodigo?:string;inventarioCodigo?:string}){
  const lineas:LineaEvento[]=[];for(const p of c.cobros)if(p.importe>0)lineas.push({codigo:p.codigo,debe:p.importe,haber:0,descripcion:'Cobro de venta'});
  const cobrado=c.cobros.reduce((s,p)=>s+p.importe,0),pendiente=Math.round((c.total-cobrado)*100)/100;
  if(pendiente>0){if(!c.cxcCodigo)throw new Error('La venta pendiente requiere cuenta por cobrar.');lineas.push({codigo:c.cxcCodigo,debe:pendiente,haber:0,descripcion:'Cuenta por cobrar'});}
  if(c.base>0)lineas.push({codigo:c.ingresoCodigo,debe:0,haber:c.base,descripcion:'Ingreso por venta'});if(c.iva>0)lineas.push({codigo:c.ivaCodigo,debe:0,haber:c.iva,descripcion:'IVA generado'});
  if((c.costo||0)>0){if(!c.costoCodigo||!c.inventarioCodigo)throw new Error('Costo de venta sin cuentas configuradas.');lineas.push({codigo:c.costoCodigo!,debe:c.costo!,haber:0,descripcion:'Costo de ventas'},{codigo:c.inventarioCodigo!,debe:0,haber:c.costo!,descripcion:'Salida de inventario'});}
  validarLineasContables(lineas);return lineas;
}

export function construirLineasCompra(c:{base:number;iva:number;clasificacionCodigo:string;contrapartidaCodigo:string;proveedorId?:string;ivaCodigo?:string}){
  const total=Math.round((c.base+c.iva)*100)/100;const lineas:LineaEvento[]=[];
  if(c.base>0)lineas.push({codigo:c.clasificacionCodigo,debe:c.base,haber:0,descripcion:'Base de compra'});
  if(c.iva>0){if(!c.ivaCodigo)throw new Error('IVA crédito sin cuenta configurada.');lineas.push({codigo:c.ivaCodigo,debe:c.iva,haber:0,descripcion:'IVA crédito tributario'});}
  lineas.push({codigo:c.contrapartidaCodigo,debe:0,haber:total,descripcion:'Contrapartida de compra',terceroTipo:c.proveedorId?'PROVEEDOR':undefined,terceroId:c.proveedorId});validarLineasContables(lineas);return lineas;
}

export function construirLineasRetencion(c:{proveedorCodigo:string;proveedorId:string;ir:number;iva:number;irCodigo?:string;ivaCodigo?:string;recibida?:boolean;clienteCodigo?:string;clienteId?:string}){
  const total=Math.round((c.ir+c.iva)*100)/100;if(total<=0)throw new Error('Retención sin importe.');const lineas:LineaEvento[]=[];
  if(c.recibida){if(!c.clienteCodigo||!c.clienteId)throw new Error('Retención recibida sin cliente.');if(c.ir>0){if(!c.irCodigo)throw new Error('Falta cuenta de retención IR recibida.');lineas.push({codigo:c.irCodigo,debe:c.ir,haber:0,descripcion:'Retención IR recibida'});}if(c.iva>0){if(!c.ivaCodigo)throw new Error('Falta cuenta de retención IVA recibida.');lineas.push({codigo:c.ivaCodigo,debe:c.iva,haber:0,descripcion:'Retención IVA recibida'});}lineas.push({codigo:c.clienteCodigo,debe:0,haber:total,descripcion:'Aplicación a cliente',terceroTipo:'CLIENTE',terceroId:c.clienteId});}
  else{lineas.push({codigo:c.proveedorCodigo,debe:total,haber:0,descripcion:'Aplicación a proveedor',terceroTipo:'PROVEEDOR',terceroId:c.proveedorId});if(c.ir>0){if(!c.irCodigo)throw new Error('Falta cuenta de retención IR por pagar.');lineas.push({codigo:c.irCodigo,debe:0,haber:c.ir,descripcion:'Retención IR por pagar'});}if(c.iva>0){if(!c.ivaCodigo)throw new Error('Falta cuenta de retención IVA por pagar.');lineas.push({codigo:c.ivaCodigo,debe:0,haber:c.iva,descripcion:'Retención IVA por pagar'});}}
  validarLineasContables(lineas);return lineas;
}
