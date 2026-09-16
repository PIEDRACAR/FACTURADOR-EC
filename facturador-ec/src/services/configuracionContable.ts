const obtenerSupabase=async()=> (await import('../db/supabase.js')).supabase;

export const CUENTAS_BASE = {
  CAJA:'1.1.01.01', BANCOS:'1.1.01.02', MEDIOS_ELECTRONICOS:'1.1.01.03', CLIENTES:'1.1.03.01',
  INVENTARIO:'1.1.04.01', IVA_COMPRAS:'1.1.05.01', PROVEEDORES:'2.1.01.01', IVA_VENTAS:'2.1.02.01',
  IESS:'2.1.03.01', IMPUESTOS:'2.1.04.01', PROPINAS_POR_PAGAR:'2.1.05.01', CAPITAL:'3.1.01.01',
  RESULTADOS:'3.2.01.01', VENTAS:'4.1.01.01', OTROS_INGRESOS:'4.2.01.01', COSTO_VENTAS:'5.1.01.01',
  GASTOS_ADMIN:'5.2.01.01', GASTOS_VENTAS:'5.2.02.01', GASTOS_FINANCIEROS:'5.2.03.01',
  DEPRECIACION:'5.2.04.01', DEPRECIACION_ACUM:'1.2.02.01',
} as const;

export const FALLBACKS_LEGACY:Readonly<Record<string,string>>={
  CAJA:CUENTAS_BASE.CAJA,BANCOS:CUENTAS_BASE.BANCOS,MEDIOS_ELECTRONICOS:CUENTAS_BASE.MEDIOS_ELECTRONICOS,
  CLIENTES_CXC:CUENTAS_BASE.CLIENTES,INVENTARIO:CUENTAS_BASE.INVENTARIO,IVA_COMPRAS_CREDITO:CUENTAS_BASE.IVA_COMPRAS,
  PROVEEDORES_CXP:CUENTAS_BASE.PROVEEDORES,IVA_VENTAS_POR_PAGAR:CUENTAS_BASE.IVA_VENTAS,
  INGRESOS_VENTAS:CUENTAS_BASE.VENTAS,COSTO_VENTAS:CUENTAS_BASE.COSTO_VENTAS,
  GASTO_ADMINISTRATIVO:CUENTAS_BASE.GASTOS_ADMIN,OTROS_INGRESOS:CUENTAS_BASE.OTROS_INGRESOS,
  PERDIDA_INVENTARIO:CUENTAS_BASE.GASTOS_ADMIN,PROPINAS_POR_PAGAR:CUENTAS_BASE.PROPINAS_POR_PAGAR,
};

export type CuentaConfigurada={id:string;codigo:string;nombre:string;clave:string;fuente:'CONFIGURACION'|'FALLBACK_LEGACY';snapshot:Record<string,unknown>};
export type ConfiguracionCandidata={id:string;emisor_id:string;clave:string;cuenta_id:string;vigente_desde:string;vigente_hasta?:string|null;activa:boolean;metadatos?:unknown;cuenta?:any};

export function seleccionarConfiguracionPorFecha(candidatas:ConfiguracionCandidata[],emisorId:string,clave:string,fecha:string){
  const validas=candidatas.filter(x=>x.emisor_id===emisorId&&x.clave===clave&&x.activa&&x.vigente_desde<=fecha&&(!x.vigente_hasta||x.vigente_hasta>=fecha));
  if(validas.length>1)throw new Error(`Configuración contable ambigua para ${clave} en ${fecha}.`);
  return validas[0]||null;
}

export function codigoFallbackLegacy(clave:string){return FALLBACKS_LEGACY[clave]||null;}

export async function resolverCuentaContable(emisorId:string,clave:string,fecha:string,permitirFallback=true):Promise<CuentaConfigurada>{
  const supabase=await obtenerSupabase();
  if(!emisorId||!clave||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(fecha))throw new Error('Empresa, clave y fecha contable válidas son obligatorias.');
  const {data,error}=await supabase.from('configuracion_cuentas_contables').select('id,emisor_id,clave,cuenta_id,vigente_desde,vigente_hasta,activa,metadatos').eq('emisor_id',emisorId).eq('clave',clave).eq('activa',true).lte('vigente_desde',fecha).or(`vigente_hasta.is.null,vigente_hasta.gte.${fecha}`).limit(2);
  if(error)throw new Error(`No se pudo resolver la configuración ${clave}: ${error.message}`);
  const elegida=seleccionarConfiguracionPorFecha((data||[]) as ConfiguracionCandidata[],emisorId,clave,fecha);
  const fallback=permitirFallback?codigoFallbackLegacy(clave):null;
  if(!elegida&&!fallback)throw new Error(`Falta configurar la cuenta contable ${clave} para ${fecha}.`);
  let consulta=supabase.from('plan_cuentas_contables').select('id,emisor_id,codigo,nombre,tipo,naturaleza,activa,acepta_movimientos').eq('emisor_id',emisorId).eq('activa',true).eq('acepta_movimientos',true);
  consulta=elegida?consulta.eq('id',elegida.cuenta_id):consulta.eq('codigo',fallback!);
  const {data:cuenta,error:ce}=await consulta.maybeSingle();
  if(ce||!cuenta)throw new Error(`La cuenta para ${clave} no existe, no pertenece a la empresa o no acepta movimientos.`);
  const fuente=elegida?'CONFIGURACION':'FALLBACK_LEGACY';
  return {id:cuenta.id,codigo:cuenta.codigo,nombre:cuenta.nombre,clave,fuente,snapshot:{configuracionId:elegida?.id||null,clave,cuentaId:cuenta.id,codigo:cuenta.codigo,fecha,fuente,metadatos:elegida?.metadatos||{}}};
}

export async function resolverCuentas(emisorId:string,claves:string[],fecha:string){
  const pares=await Promise.all([...new Set(claves)].map(async clave=>[clave,await resolverCuentaContable(emisorId,clave,fecha)] as const));
  return Object.fromEntries(pares) as Record<string,CuentaConfigurada>;
}

export async function capturarSnapshotConfiguracion(emisorId:string,fecha:string,codigos:string[]){
  const supabase=await obtenerSupabase(),unicos=[...new Set(codigos)];
  const plan=await supabase.from('plan_cuentas_contables').select('id,codigo,nombre').eq('emisor_id',emisorId).in('codigo',unicos);if(plan.error)throw new Error(plan.error.message);
  const ids=(plan.data||[]).map(x=>x.id);let configuraciones:any[]=[];
  if(ids.length){const r=await supabase.from('configuracion_cuentas_contables').select('id,clave,cuenta_id,vigente_desde,vigente_hasta,metadatos').eq('emisor_id',emisorId).eq('activa',true).in('cuenta_id',ids).lte('vigente_desde',fecha).or(`vigente_hasta.is.null,vigente_hasta.gte.${fecha}`);if(r.error)throw new Error(r.error.message);configuraciones=r.data||[];}
  return {fecha,cuentas:(plan.data||[]).map(c=>{const cfg=configuraciones.find(x=>x.cuenta_id===c.id);const clavesLegacy=Object.entries(FALLBACKS_LEGACY).filter(([,codigo])=>codigo===c.codigo).map(([clave])=>clave);return {cuentaId:c.id,codigo:c.codigo,nombre:c.nombre,configuracionId:cfg?.id||null,clave:cfg?.clave||null,fuente:cfg?'CONFIGURACION':clavesLegacy.length?'FALLBACK_LEGACY':'CUENTA_EXPLICITA',clavesLegacy,metadatos:cfg?.metadatos||{}};})};
}
