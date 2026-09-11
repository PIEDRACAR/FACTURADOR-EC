import { supabase } from '../db/supabase.js';
import { fechaIsoEcuador } from '../utils/fechaEcuador.js';

export const CUENTAS_BASE = {
  CAJA: '1.1.01.01', BANCOS: '1.1.01.02', CLIENTES: '1.1.03.01', IVA_COMPRAS: '1.1.05.01', INVENTARIO: '1.1.04.01',
  PROVEEDORES: '2.1.01.01', IVA_VENTAS: '2.1.02.01', IESS: '2.1.03.01', IMPUESTOS: '2.1.04.01', CAPITAL: '3.1.01.01',
  RESULTADOS: '3.2.01.01', VENTAS: '4.1.01.01', OTROS_INGRESOS: '4.2.01.01', COSTO_VENTAS: '5.1.01.01', GASTOS_ADMIN: '5.2.01.01',
  GASTOS_VENTAS: '5.2.02.01', GASTOS_FINANCIEROS: '5.2.03.01', DEPRECIACION: '5.2.04.01', DEPRECIACION_ACUM: '1.2.02.01'
} as const;

const PLAN_BASE: Array<[string,string,number,string,string]> = [
  ['1','ACTIVO',1,'ACTIVO','DEUDORA'],['1.1','ACTIVO CORRIENTE',2,'ACTIVO','DEUDORA'],['1.1.01','EFECTIVO Y EQUIVALENTES',3,'ACTIVO','DEUDORA'],
  [CUENTAS_BASE.CAJA,'CAJA',4,'ACTIVO','DEUDORA'],[CUENTAS_BASE.BANCOS,'BANCOS',4,'ACTIVO','DEUDORA'],[CUENTAS_BASE.CLIENTES,'CUENTAS POR COBRAR CLIENTES',4,'ACTIVO','DEUDORA'],
  [CUENTAS_BASE.INVENTARIO,'INVENTARIOS',4,'ACTIVO','DEUDORA'],[CUENTAS_BASE.IVA_COMPRAS,'IVA CRÉDITO TRIBUTARIO',4,'ACTIVO','DEUDORA'],
  ['1.2','ACTIVO NO CORRIENTE',2,'ACTIVO','DEUDORA'],['1.2.01','PROPIEDAD, PLANTA Y EQUIPO',3,'ACTIVO','DEUDORA'],[CUENTAS_BASE.DEPRECIACION_ACUM,'DEPRECIACIÓN ACUMULADA',4,'ACTIVO','ACREEDORA'],
  ['2','PASIVO',1,'PASIVO','ACREEDORA'],['2.1','PASIVO CORRIENTE',2,'PASIVO','ACREEDORA'],[CUENTAS_BASE.PROVEEDORES,'CUENTAS POR PAGAR PROVEEDORES',4,'PASIVO','ACREEDORA'],
  [CUENTAS_BASE.IVA_VENTAS,'IVA POR PAGAR',4,'PASIVO','ACREEDORA'],[CUENTAS_BASE.IESS,'IESS POR PAGAR',4,'PASIVO','ACREEDORA'],[CUENTAS_BASE.IMPUESTOS,'RETENCIONES E IMPUESTOS POR PAGAR',4,'PASIVO','ACREEDORA'],
  ['3','PATRIMONIO',1,'PATRIMONIO','ACREEDORA'],[CUENTAS_BASE.CAPITAL,'CAPITAL SOCIAL',4,'PATRIMONIO','ACREEDORA'],[CUENTAS_BASE.RESULTADOS,'RESULTADOS ACUMULADOS',4,'PATRIMONIO','ACREEDORA'],
  ['4','INGRESOS',1,'INGRESO','ACREEDORA'],[CUENTAS_BASE.VENTAS,'VENTAS / SERVICIOS',4,'INGRESO','ACREEDORA'],[CUENTAS_BASE.OTROS_INGRESOS,'OTROS INGRESOS',4,'INGRESO','ACREEDORA'],
  ['5','COSTOS Y GASTOS',1,'COSTO','DEUDORA'],[CUENTAS_BASE.COSTO_VENTAS,'COSTO DE VENTAS',4,'COSTO','DEUDORA'],[CUENTAS_BASE.GASTOS_ADMIN,'GASTOS ADMINISTRATIVOS',4,'GASTO','DEUDORA'],
  [CUENTAS_BASE.GASTOS_VENTAS,'GASTOS DE VENTAS',4,'GASTO','DEUDORA'],[CUENTAS_BASE.GASTOS_FINANCIEROS,'GASTOS FINANCIEROS',4,'GASTO','DEUDORA'],[CUENTAS_BASE.DEPRECIACION,'DEPRECIACIÓN DEL EJERCICIO',4,'GASTO','DEUDORA'],
];
const money=(n:number)=>Math.round((Number(n)||0)*100)/100;

export async function asegurarPlanBase(emisorId:string){
  const {data:existentes,error:ee}=await supabase.from('plan_cuentas_contables').select('id,codigo').eq('emisor_id',emisorId);
  if(ee) throw new Error(`No se pudo consultar el plan contable: ${ee.message}`);
  const existentesSet=new Set((existentes||[]).map((x:any)=>x.codigo));
  const faltantes=PLAN_BASE.filter(([codigo])=>!existentesSet.has(codigo)).map(([codigo,nombre,nivel,tipo,naturaleza])=>({emisor_id:emisorId,codigo,nombre,nivel,tipo,naturaleza,acepta_movimientos:nivel>=4,activa:true}));
  if(faltantes.length){const {error}=await supabase.from('plan_cuentas_contables').insert(faltantes);if(error)throw new Error(`No se pudo inicializar el plan contable: ${error.message}`);}
}
async function cuenta(emisorId:string,codigo:string){
  const {data,error}=await supabase.from('plan_cuentas_contables').select('id,codigo,nombre,naturaleza,tipo').eq('emisor_id',emisorId).eq('codigo',codigo).single();
  if(error||!data) throw new Error(`Cuenta contable ${codigo} no configurada.`); return data;
}

async function asientoAtomico(args:{emisorId:string;fecha:string;tipo:string;concepto:string;referencia?:string|null;origenTipo?:string|null;origenId?:string|null;userId?:string|null;lineas:Array<{codigo:string;descripcion?:string;debe?:number;haber?:number;terceroTipo?:string;terceroId?:string}>}){
  const lineas=args.lineas.map(x=>({codigo:x.codigo,descripcion:x.descripcion||args.concepto,debe:money(x.debe||0),haber:money(x.haber||0),tercero_tipo:x.terceroTipo||null,tercero_id:x.terceroId||null}));
  const debe=money(lineas.reduce((s,x)=>s+x.debe,0)), haber=money(lineas.reduce((s,x)=>s+x.haber,0));
  if(debe<=0||Math.abs(debe-haber)>0.01) throw new Error(`Asiento no cuadra: Debe ${debe} / Haber ${haber}.`);
  const {data,error}=await supabase.rpc('crear_asiento_contable_atomico',{p_emisor_id:args.emisorId,p_fecha:args.fecha,p_tipo:args.tipo,p_concepto:args.concepto,p_referencia:args.referencia||null,p_origen_tipo:args.origenTipo||null,p_origen_id:args.origenId||null,p_created_by:args.userId||null,p_lineas:lineas});
  if(error) throw new Error(error.message); return data as string;
}

export async function contabilizarVenta(comprobanteId:string,userId?:string){
  const {data:c,error:ce}=await supabase.from('comprobantes').select('id,emisor_id,estado,created_at,importe_total,subtotal_0,subtotal_5,subtotal_8,subtotal_15,total_iva,secuencial,clave_acceso').eq('id',comprobanteId).single();
  if(ce||!c) throw new Error('Comprobante no encontrado.'); if(String(c.estado||'').toLowerCase()!=='autorizado') throw new Error(`Solo se contabilizan comprobantes autorizados. Estado actual: ${c.estado}`);
  await asegurarPlanBase(c.emisor_id);
  const {data:existente}=await supabase.from('asientos_contables').select('id,estado').eq('emisor_id',c.emisor_id).eq('origen_tipo','COMPROBANTE_VENTA').eq('origen_id',c.id).maybeSingle();
  if(existente) return existente;
  const {data:imps}=await supabase.from('comprobante_impuestos').select('base_imponible,valor').eq('comprobante_id',c.id);
  const base=money((imps||[]).reduce((s,x)=>s+Number(x.base_imponible||0),0)||Number(c.subtotal_0||0)+Number(c.subtotal_5||0)+Number(c.subtotal_8||0)+Number(c.subtotal_15||0));
  const iva=money((imps||[]).reduce((s,x)=>s+Number(x.valor||0),0)||Number(c.total_iva||0));
  const total=money(c.importe_total); if(total<=0) throw new Error('El comprobante tiene total cero.');
  const {data:pagos}=await supabase.from('comprobante_formas_pago').select('forma_pago_codigo,valor').eq('comprobante_id',c.id);
  const lineas:Array<any>=[]; let pagado=0;
  for(const p of pagos||[]){const v=money(p.valor);if(v<=0)continue;pagado+=v;const codigo=String(p.forma_pago_codigo||'');lineas.push({codigo:codigo==='01'?CUENTAS_BASE.CAJA:CUENTAS_BASE.BANCOS,descripcion:'Cobro de factura',debe:v,haber:0});}
  const porCobrar=money(total-pagado); if(porCobrar>0) lineas.push({codigo:CUENTAS_BASE.CLIENTES,descripcion:'Saldo pendiente de factura',debe:porCobrar,haber:0});
  if(base>0) lineas.push({codigo:CUENTAS_BASE.VENTAS,descripcion:'Ingreso por venta/servicio',debe:0,haber:base});
  if(iva>0) lineas.push({codigo:CUENTAS_BASE.IVA_VENTAS,descripcion:'IVA generado según comprobante',debe:0,haber:iva});
  const {data:items}=await supabase.from('comprobante_items').select('producto_id,cantidad,costo_unitario_momento').eq('comprobante_id',c.id);
  const costo=money((items||[]).reduce((s,x)=>s+(x.producto_id?Number(x.cantidad||0)*Number(x.costo_unitario_momento||0):0),0));
  if(costo>0){lineas.push({codigo:CUENTAS_BASE.COSTO_VENTAS,descripcion:'Costo de ventas automático',debe:costo,haber:0});lineas.push({codigo:CUENTAS_BASE.INVENTARIO,descripcion:'Salida de inventario por venta',debe:0,haber:costo});}
  const id=await asientoAtomico({emisorId:c.emisor_id,fecha:fechaIsoEcuador(new Date(c.created_at)),tipo:'VENTA',concepto:`Factura ${c.secuencial||c.clave_acceso||c.id}`,referencia:c.clave_acceso,origenTipo:'COMPROBANTE_VENTA',origenId:c.id,userId,lineas});
  return {id,estado:'CONTABILIZADO'};
}

export async function contabilizarCxP(cuentaId:string,userId?:string){
  const {data:c,error}=await supabase.from('cuentas_por_pagar').select('id,emisor_id,concepto,fecha_emision,monto_total,proveedor_id,numero_documento').eq('id',cuentaId).single();
  if(error||!c) throw new Error('Cuenta por pagar no encontrada.'); await asegurarPlanBase(c.emisor_id);
  const {data:ex}=await supabase.from('asientos_contables').select('id').eq('origen_tipo','CUENTA_POR_PAGAR').eq('origen_id',c.id).maybeSingle(); if(ex)return ex;
  const id=await asientoAtomico({emisorId:c.emisor_id,fecha:c.fecha_emision,tipo:'COMPRA',concepto:c.concepto,referencia:c.numero_documento,origenTipo:'CUENTA_POR_PAGAR',origenId:c.id,userId,lineas:[{codigo:CUENTAS_BASE.GASTOS_ADMIN,descripcion:c.concepto,debe:Number(c.monto_total),haber:0},{codigo:CUENTAS_BASE.PROVEEDORES,descripcion:'Obligación con proveedor',debe:0,haber:Number(c.monto_total),terceroTipo:'PROVEEDOR',terceroId:c.proveedor_id}]}); return {id};
}

export async function contabilizarPagoCxP(cuentaId:string,pagoId:string,userId?:string){
  const {data:p}=await supabase.from('pagos_cuentas_por_pagar').select('id,monto,forma_pago_codigo,created_at').eq('id',pagoId).single();
  const {data:c}=await supabase.from('cuentas_por_pagar').select('emisor_id,proveedor_id,concepto').eq('id',cuentaId).single(); if(!p||!c)throw new Error('Pago o cuenta no encontrados.'); await asegurarPlanBase(c.emisor_id);
  const codigo=String(p.forma_pago_codigo||'20'); const cuentaBanco=codigo==='01'?CUENTAS_BASE.CAJA:CUENTAS_BASE.BANCOS;
  const id=await asientoAtomico({emisorId:c.emisor_id,fecha:fechaIsoEcuador(new Date(p.created_at)),tipo:'PAGO_PROVEEDOR',concepto:`Pago: ${c.concepto}`,origenTipo:'PAGO_CXP',origenId:p.id,userId,lineas:[{codigo:CUENTAS_BASE.PROVEEDORES,debe:Number(p.monto),haber:0,terceroTipo:'PROVEEDOR',terceroId:c.proveedor_id},{codigo:cuentaBanco,debe:0,haber:Number(p.monto)}]});return {id};
}

export async function contabilizarCxC(cuentaId:string,userId?:string){
  const {data:c,error}=await supabase.from('cuentas_por_cobrar').select('id,emisor_id,concepto,fecha_emision,monto_total,cliente_id,comprobante_id').eq('id',cuentaId).single();
  if(error||!c) throw new Error('Cuenta por cobrar no encontrada.'); await asegurarPlanBase(c.emisor_id);
  const {data:ex}=await supabase.from('asientos_contables').select('id').eq('origen_tipo','CUENTA_POR_COBRAR').eq('origen_id',c.id).maybeSingle(); if(ex)return ex;
  const id=await asientoAtomico({emisorId:c.emisor_id,fecha:c.fecha_emision,tipo:'CUENTA_POR_COBRAR',concepto:c.concepto,origenTipo:'CUENTA_POR_COBRAR',origenId:c.id,userId,lineas:[{codigo:CUENTAS_BASE.CLIENTES,descripcion:c.concepto,debe:Number(c.monto_total),haber:0,terceroTipo:'CLIENTE',terceroId:c.cliente_id},{codigo:CUENTAS_BASE.VENTAS,descripcion:'Ingreso pendiente de cobro',debe:0,haber:Number(c.monto_total)}]}); return {id};
}
export async function contabilizarCobroCxC(cuentaId:string,pagoId:string,userId?:string){
  const {data:p}=await supabase.from('pagos_cuentas_por_cobrar').select('id,monto,forma_pago_codigo,created_at').eq('id',pagoId).single();
  const {data:c}=await supabase.from('cuentas_por_cobrar').select('emisor_id,cliente_id,concepto').eq('id',cuentaId).single(); if(!p||!c)throw new Error('Cobro o cuenta no encontrados.'); await asegurarPlanBase(c.emisor_id);
  const codigo=String(p.forma_pago_codigo||'01'); const cuentaBanco=codigo==='01'?CUENTAS_BASE.CAJA:CUENTAS_BASE.BANCOS;
  const id=await asientoAtomico({emisorId:c.emisor_id,fecha:fechaIsoEcuador(new Date(p.created_at)),tipo:'COBRO_CLIENTE',concepto:`Cobro: ${c.concepto}`,origenTipo:'PAGO_CXC',origenId:p.id,userId,lineas:[{codigo:cuentaBanco,descripcion:'Ingreso de cobro',debe:Number(p.monto),haber:0},{codigo:CUENTAS_BASE.CLIENTES,descripcion:'Aplicación de cobro',debe:0,haber:Number(p.monto),terceroTipo:'CLIENTE',terceroId:c.cliente_id}]});return {id};
}

export async function obtenerBalanza(emisorId:string,desde?:string,hasta?:string){
  await asegurarPlanBase(emisorId);
  const aq=supabase.from('asientos_contables').select('id,fecha,estado').eq('emisor_id',emisorId).eq('estado','CONTABILIZADO').order('fecha',{ascending:true});
  if(desde)aq.gte('fecha',desde);if(hasta)aq.lte('fecha',hasta);
  const {data:asientos,error:ae}=await aq.limit(10000);if(ae)throw new Error(ae.message);const ids=(asientos||[]).map(a=>a.id);if(!ids.length)return [];
  const {data:lineas,error:le}=await supabase.from('asiento_lineas_contables').select('cuenta_id,debe,haber').in('asiento_id',ids);if(le)throw new Error(le.message);
  const cids=[...new Set((lineas||[]).map(x=>x.cuenta_id).filter(Boolean))];const {data:cuentas,error:ce}=cids.length?await supabase.from('plan_cuentas_contables').select('id,codigo,nombre,tipo,naturaleza').in('id',cids):{data:[],error:null};if(ce)throw new Error(ce.message);
  const cm=new Map((cuentas||[]).map(c=>[c.id,c]));const map=new Map<string,any>();for(const r of lineas||[]){const c:any=cm.get(r.cuenta_id);if(!c)continue;const x=map.get(c.id)||{id:c.id,codigo:c.codigo,nombre:c.nombre,tipo:c.tipo,naturaleza:c.naturaleza,debe:0,haber:0,saldo:0};x.debe+=Number(r.debe||0);x.haber+=Number(r.haber||0);map.set(c.id,x);}return Array.from(map.values()).map(x=>({...x,debe:money(x.debe),haber:money(x.haber),saldo:money(x.debe-x.haber)})).sort((a,b)=>a.codigo.localeCompare(b.codigo));
}
