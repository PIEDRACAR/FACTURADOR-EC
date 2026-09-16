import { supabase } from '../db/supabase.js';
import { calcularCentrosCosto, calcularEstadoResultados, calcularEstadoSituacion, calcularFlujoEfectivo, presentarSaldo, variacion, type SaldoCuenta, type MovimientoFlujo } from './estadosFinancieros.js';

const money=(n:number)=>Math.round((Number(n)||0)*100)/100;
async function paginas<T>(fn:(a:number,b:number)=>PromiseLike<{data:T[]|null,error:any}>,tam=1000){
  const out:T[]=[];for(let a=0;;a+=tam){const r=await fn(a,a+tam-1);if(r.error)throw new Error(r.error.message);const lote=r.data||[];out.push(...lote);if(lote.length<tam)break;}return out;
}
async function plan(emisorId:string){
  const r=await supabase.from('plan_cuentas_contables').select('id,codigo,nombre,tipo,naturaleza').eq('emisor_id',emisorId).eq('activa',true).order('codigo');
  if(r.error)throw new Error(r.error.message);return r.data||[];
}
async function lineas(emisorId:string,desde?:string,hasta?:string,incluirAnteriores=false){
  let aq=supabase.from('asientos_contables').select('id,fecha,numero_asiento,concepto').eq('emisor_id',emisorId).eq('estado','CONTABILIZADO').order('fecha').order('id');
  if(desde&&!incluirAnteriores)aq=aq.gte('fecha',desde);if(hasta)aq=aq.lte('fecha',hasta);
  const asientos=await paginas<any>((a,b)=>aq.range(a,b) as any);const ids=asientos.map(a=>a.id);if(!ids.length)return [];
  const am=new Map(asientos.map(a=>[a.id,a])),out:any[]=[];
  for(let i=0;i<ids.length;i+=200){
    const lote=ids.slice(i,i+200);
    let r:any=await supabase.from('asiento_lineas_contables').select('id,asiento_id,cuenta_id,debe,haber,tercero_tipo,tercero_id,centro_costo_id').in('asiento_id',lote).order('id');
    if(r.error)r=await supabase.from('asiento_lineas_contables').select('id,asiento_id,cuenta_id,debe,haber,tercero_tipo,tercero_id').in('asiento_id',lote).order('id');
    if(r.error)throw new Error(r.error.message);out.push(...(r.data||[]).map((x:any)=>({...x,asiento:am.get(x.asiento_id)})));
  }
  return out;
}
async function saldos(emisorId:string,desde?:string,hasta?:string,incluirAnteriores=false){
  const [cuentas,ls]=await Promise.all([plan(emisorId),lineas(emisorId,desde,hasta,incluirAnteriores)]);
  const cm=new Map(cuentas.map((c:any)=>[c.id,c])),centrosIds=[...new Set(ls.map((x:any)=>x.centro_costo_id).filter(Boolean))];
  let centros:any[]=[];if(centrosIds.length){const r=await supabase.from('centros_costo').select('id,nombre,padre_id').eq('emisor_id',emisorId).in('id',centrosIds);if(!r.error)centros=r.data||[];}
  const ccm=new Map(centros.map(c=>[c.id,c])),m=new Map<string,SaldoCuenta>();
  for(const l of ls){const c:any=cm.get(l.cuenta_id);if(!c)continue;const centro=l.centro_costo_id||null,key=`${c.id}|${centro||''}`;const cur=m.get(key)||{id:c.id,codigo:c.codigo,nombre:c.nombre,tipo:c.tipo,saldo:0,centroCostoId:centro,centroNombre:centro?ccm.get(centro)?.nombre||'SIN ASIGNAR':'SIN ASIGNAR'};cur.saldo=money(cur.saldo+Number(l.debe||0)-Number(l.haber||0));m.set(key,cur);}
  return [...m.values()];
}
async function mapeosEstado(emisorId:string,tipo:'SITUACION'|'RESULTADOS'|'PATRIMONIO',fecha?:string){
  let q=supabase.from('mapeos_estados_financieros').select('estado_tipo,rubro_codigo,rubro_nombre,cuenta_id,patron_codigo,orden,signo_presentacion,padre_rubro').eq('emisor_id',emisorId).eq('estado_tipo',tipo).eq('activo',true).order('orden');
  if(fecha)q=q.lte('vigente_desde',fecha).or(`vigente_hasta.is.null,vigente_hasta.gte.${fecha}`);
  const r=await q;if(r.error)return [];return r.data||[];
}
function rubrosMapeados(cuentas:SaldoCuenta[],mapas:any[]){
  return mapas.map(m=>{const cs=cuentas.filter(c=>m.cuenta_id?c.id===m.cuenta_id:String(c.codigo).startsWith(String(m.patron_codigo||'').replace('*','')));return {codigo:m.rubro_codigo,rubro:m.rubro_nombre,padre:m.padre_rubro||null,orden:m.orden,valor:money(cs.reduce((sum,c)=>sum+presentarSaldo(c)*Number(m.signo_presentacion||1),0)),cuentas:cs.map(c=>c.codigo)};});
}
export async function obtenerEstadoResultados(emisorId:string,desde?:string,hasta?:string){
  const cuentas=await saldos(emisorId,desde,hasta),resumen=calcularEstadoResultados(cuentas),mapas=await mapeosEstado(emisorId,'RESULTADOS',hasta);
  const detalle=cuentas.filter(c=>['INGRESO','COSTO','GASTO'].includes(c.tipo)).map(c=>({...c,valor:presentarSaldo(c)}));
  return {tipo:'RESULTADOS',desde,hasta,moneda:'USD',...resumen,detalle,rubros:rubrosMapeados(cuentas,mapas),configuracionPresentacion:mapas.length?'CONFIGURADA':'TIPOS_CONTABLES_BASE',advertencia:mapas.length?null:'Configure mapeos de RESULTADOS para separar margen, resultado financiero, otros resultados e impuestos sin heurísticas.'};
}
export async function obtenerEstadoSituacion(emisorId:string,hasta?:string){
  const cuentas=await saldos(emisorId,undefined,hasta,true),fecha=hasta||new Date().toISOString().slice(0,10),desdeEjercicio=`${fecha.slice(0,4)}-01-01`,cuentasResultado=await saldos(emisorId,desdeEjercicio,hasta),er=calcularEstadoResultados(cuentasResultado),mapas=await mapeosEstado(emisorId,'SITUACION',fecha);
  const situacion=calcularEstadoSituacion(cuentas,er.resultado);
  return {tipo:'SITUACION',hasta,moneda:'USD',...situacion,detalle:cuentas.filter(c=>['ACTIVO','PASIVO','PATRIMONIO'].includes(c.tipo)).map(c=>({...c,valor:presentarSaldo(c)})),rubros:rubrosMapeados(cuentas,mapas),configuracionPresentacion:mapas.length?'CONFIGURADA':'TIPOS_CONTABLES_BASE'};
}
export async function obtenerComparativo(emisorId:string,desdeA:string,hastaA:string,desdeB:string,hastaB:string,tipo='resultados'){
  if(tipo==='situacion'){const [a,b]=await Promise.all([obtenerEstadoSituacion(emisorId,hastaA),obtenerEstadoSituacion(emisorId,hastaB)]);return {tipo,periodoA:{desde:desdeA,hasta:hastaA},periodoB:{desde:desdeB,hasta:hastaB},activos:variacion(a.activos,b.activos),pasivos:variacion(a.pasivos,b.pasivos),patrimonio:variacion(a.patrimonio,b.patrimonio)};}
  const [a,b]=await Promise.all([obtenerEstadoResultados(emisorId,desdeA,hastaA),obtenerEstadoResultados(emisorId,desdeB,hastaB)]);
  return {tipo,periodoA:{desde:desdeA,hasta:hastaA},periodoB:{desde:desdeB,hasta:hastaB},ingresos:variacion(a.ingresos,b.ingresos),costos:variacion(a.costos,b.costos),gastos:variacion(a.gastos,b.gastos),resultado:variacion(a.resultado,b.resultado)};
}
export async function obtenerAnalisisCentroCosto(emisorId:string,desde?:string,hasta?:string){
  return {tipo:'CENTROS_COSTO',desde,hasta,moneda:'USD',centros:calcularCentrosCosto(await saldos(emisorId,desde,hasta))};
}
export async function obtenerFlujoEfectivo(emisorId:string,desde:string,hasta:string){
  const mapasR=await supabase.from('mapeos_flujo_efectivo').select('cuenta_id,patron_codigo,actividad,rubro,es_efectivo_equivalente,signo_presentacion').eq('emisor_id',emisorId).eq('activo',true).lte('vigente_desde',hasta).or(`vigente_hasta.is.null,vigente_hasta.gte.${desde}`);
  if(mapasR.error)throw new Error(mapasR.error.message);const mapas:any[]=mapasR.data||[];
  if(!mapas.length)return {tipo:'FLUJO_EFECTIVO',desde,hasta,configurado:false,error:'Configure mapeos de flujo de efectivo antes de presentar este estado.'};
  const cuentas=await plan(emisorId),cm=new Map(cuentas.map((c:any)=>[c.id,c]));
  const match=(cuentaId:string,m:any)=>m.cuenta_id===cuentaId||(!m.cuenta_id&&m.patron_codigo&&String((cm.get(cuentaId) as any)?.codigo||'').startsWith(String(m.patron_codigo).replace('*','')));
  const efectivoIds=new Set(cuentas.filter((c:any)=>mapas.some(m=>m.es_efectivo_equivalente&&match(c.id,m))).map((c:any)=>c.id));
  if(!efectivoIds.size)return {tipo:'FLUJO_EFECTIVO',desde,hasta,configurado:false,error:'No existen cuentas configuradas como efectivo/equivalentes.'};
  const antes=await lineas(emisorId,undefined,desde,true),periodo=await lineas(emisorId,desde,hasta);
  const inicial=money(antes.filter((l:any)=>efectivoIds.has(l.cuenta_id)&&String(l.asiento?.fecha)<desde).reduce((s:number,l:any)=>s+Number(l.debe||0)-Number(l.haber||0),0));
  const porAsiento=new Map<string,any[]>();for(const l of periodo){const a=porAsiento.get(l.asiento_id)||[];a.push(l);porAsiento.set(l.asiento_id,a);}
  const movimientos:MovimientoFlujo[]=[];const noMapeados:any[]=[];
  for(const [asientoId,ls] of porAsiento){const cash=money(ls.filter(l=>efectivoIds.has(l.cuenta_id)).reduce((s,l)=>s+Number(l.debe||0)-Number(l.haber||0),0));if(Math.abs(cash)<.005)continue;
    const contras=ls.filter(l=>!efectivoIds.has(l.cuenta_id));const mapa=mapas.find(m=>!m.es_efectivo_equivalente&&contras.some(l=>match(l.cuenta_id,m)));
    if(!mapa){noMapeados.push({asientoId,monto:cash});continue;}movimientos.push({monto:money(cash*Number(mapa.signo_presentacion||1)),actividad:mapa.actividad,rubro:mapa.rubro});
  }
  const finalBalance=money(inicial+periodo.filter((l:any)=>efectivoIds.has(l.cuenta_id)).reduce((s:number,l:any)=>s+Number(l.debe||0)-Number(l.haber||0),0));
  return {tipo:'FLUJO_EFECTIVO',desde,hasta,configurado:true,...calcularFlujoEfectivo(inicial,movimientos,finalBalance),movimientos,noMapeados};
}
export async function obtenerCambiosPatrimonio(emisorId:string,desde:string,hasta:string){
  const cuentas=await saldos(emisorId,desde,hasta);const patrimonio=cuentas.filter(c=>c.tipo==='PATRIMONIO').map(c=>({...c,variacion:presentarSaldo(c)}));const er=calcularEstadoResultados(cuentas);
  return {tipo:'CAMBIOS_PATRIMONIO',desde,hasta,moneda:'USD',patrimonio,resultadoPeriodo:er.resultado,totalCambios:money(patrimonio.reduce((s,c)=>s+c.variacion,0)+er.resultado),nota:'Presentación basada en movimientos patrimoniales contabilizados y resultado del período; no inventa rubros sin fuente contable.'};
}
