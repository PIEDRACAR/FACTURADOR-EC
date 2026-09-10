import { supabase } from '../db/supabase.js';

export const CUENTAS_BASE = {
  CAJA: '1.1.01.01',
  BANCOS: '1.1.01.02',
  CLIENTES: '1.1.03.01',
  IVA_COMPRAS: '1.1.05.01',
  INVENTARIO: '1.1.04.01',
  PROVEEDORES: '2.1.01.01',
  IVA_VENTAS: '2.1.02.01',
  IESS: '2.1.03.01',
  IMPUESTOS: '2.1.04.01',
  CAPITAL: '3.1.01.01',
  RESULTADOS: '3.2.01.01',
  VENTAS: '4.1.01.01',
  OTROS_INGRESOS: '4.2.01.01',
  COSTO_VENTAS: '5.1.01.01',
  GASTOS_ADMIN: '5.2.01.01',
  GASTOS_VENTAS: '5.2.02.01',
  GASTOS_FINANCIEROS: '5.2.03.01',
  DEPRECIACION: '5.2.04.01',
  DEPRECIACION_ACUM: '1.2.02.01',
} as const;

const PLAN_BASE: Array<[string,string,number,string,string]> = [
  ['1','ACTIVO',1,'ACTIVO','DEUDORA'],['1.1','ACTIVO CORRIENTE',2,'ACTIVO','DEUDORA'],['1.1.01','EFECTIVO Y EQUIVALENTES',3,'ACTIVO','DEUDORA'],
  [CUENTAS_BASE.CAJA,'CAJA',4,'ACTIVO','DEUDORA'],[CUENTAS_BASE.BANCOS,'BANCOS',4,'ACTIVO','DEUDORA'],[CUENTAS_BASE.CLIENTES,'CUENTAS POR COBRAR CLIENTES',4,'ACTIVO','DEUDORA'],
  [CUENTAS_BASE.INVENTARIO,'INVENTARIOS',4,'ACTIVO','DEUDORA'],[CUENTAS_BASE.IVA_COMPRAS,'IVA CRÉDITO TRIBUTARIO',4,'ACTIVO','DEUDORA'],
  ['1.2','ACTIVO NO CORRIENTE',2,'ACTIVO','DEUDORA'],['1.2.01','PROPIEDAD, PLANTA Y EQUIPO',3,'ACTIVO','DEUDORA'],[CUENTAS_BASE.DEPRECIACION_ACUM,'DEPRECIACIÓN ACUMULADA',4,'ACTIVO','ACREEDORA'],
  ['2','PASIVO',1,'PASIVO','ACREEDORA'],['2.1','PASIVO CORRIENTE',2,'PASIVO','ACREEDORA'],[CUENTAS_BASE.PROVEEDORES,'CUENTAS POR PAGAR PROVEEDORES',4,'PASIVO','ACREEDORA'],[CUENTAS_BASE.IVA_VENTAS,'IVA POR PAGAR',4,'PASIVO','ACREEDORA'],[CUENTAS_BASE.IESS,'IESS POR PAGAR',4,'PASIVO','ACREEDORA'],[CUENTAS_BASE.IMPUESTOS,'RETENCIONES E IMPUESTOS POR PAGAR',4,'PASIVO','ACREEDORA'],
  ['3','PATRIMONIO',1,'PATRIMONIO','ACREEDORA'],[CUENTAS_BASE.CAPITAL,'CAPITAL SOCIAL',4,'PATRIMONIO','ACREEDORA'],[CUENTAS_BASE.RESULTADOS,'RESULTADOS ACUMULADOS',4,'PATRIMONIO','ACREEDORA'],
  ['4','INGRESOS',1,'INGRESO','ACREEDORA'],[CUENTAS_BASE.VENTAS,'VENTAS / SERVICIOS',4,'INGRESO','ACREEDORA'],[CUENTAS_BASE.OTROS_INGRESOS,'OTROS INGRESOS',4,'INGRESO','ACREEDORA'],
  ['5','COSTOS Y GASTOS',1,'COSTO','DEUDORA'],[CUENTAS_BASE.COSTO_VENTAS,'COSTO DE VENTAS',4,'COSTO','DEUDORA'],[CUENTAS_BASE.GASTOS_ADMIN,'GASTOS ADMINISTRATIVOS',4,'GASTO','DEUDORA'],[CUENTAS_BASE.GASTOS_VENTAS,'GASTOS DE VENTAS',4,'GASTO','DEUDORA'],[CUENTAS_BASE.GASTOS_FINANCIEROS,'GASTOS FINANCIEROS',4,'GASTO','DEUDORA'],[CUENTAS_BASE.DEPRECIACION,'DEPRECIACIÓN DEL EJERCICIO',4,'GASTO','DEUDORA'],
];

export async function asegurarPlanBase(emisorId: string) {
  const rows = PLAN_BASE.map(([codigo,nombre,nivel,tipo,naturaleza]) => ({emisor_id:emisorId,codigo,nombre,nivel,tipo,naturaleza,acepta_movimientos:nivel>=4,activa:true}));
  const { error } = await supabase.from('plan_cuentas_contables').upsert(rows,{onConflict:'emisor_id,codigo',ignoreDuplicates:true});
  if (error) throw new Error(`No se pudo inicializar el plan contable: ${error.message}`);
}

async function cuenta(emisorId:string,codigo:string) {
  const {data,error}=await supabase.from('plan_cuentas_contables').select('id,codigo,nombre,naturaleza,tipo').eq('emisor_id',emisorId).eq('codigo',codigo).single();
  if(error||!data) throw new Error(`Cuenta contable ${codigo} no configurada.`);
  return data;
}

function money(n:number){ return Math.round((Number(n)||0)*100)/100; }

export async function contabilizarVenta(comprobanteId:string, userId?:string) {
  const {data:c,error:ce}=await supabase.from('comprobantes').select('id,emisor_id,estado,created_at,importe_total,subtotal_0,subtotal_5,subtotal_8,subtotal_15,total_iva,secuencial,clave_acceso').eq('id',comprobanteId).single();
  if(ce||!c) throw new Error('Comprobante no encontrado.');
  if(c.estado!=='autorizado') throw new Error('Solo se contabilizan comprobantes autorizados.');
  await asegurarPlanBase(c.emisor_id);
  const {data:existente}=await supabase.from('asientos_contables').select('id,estado').eq('emisor_id',c.emisor_id).eq('origen_tipo','COMPROBANTE_VENTA').eq('origen_id',c.id).maybeSingle();
  if(existente) return existente;

  const {data:imps}=await supabase.from('comprobante_impuestos').select('tarifa,base_imponible,valor,codigo_porcentaje').eq('comprobante_id',c.id);
  const base = money((imps??[]).reduce((s,x)=>s+Number(x.base_imponible||0),0) || Number(c.subtotal_0||0)+Number(c.subtotal_5||0)+Number(c.subtotal_8||0)+Number(c.subtotal_15||0));
  const iva = money((imps??[]).reduce((s,x)=>s+Number(x.valor||0),0) || Number(c.total_iva||0));
  const total = money(Number(c.importe_total||0));
  if(total<=0) throw new Error('El comprobante tiene total cero; no se generó asiento.');

  const cuentas = await Promise.all([cuenta(c.emisor_id,CUENTAS_BASE.CLIENTES),cuenta(c.emisor_id,CUENTAS_BASE.VENTAS),cuenta(c.emisor_id,CUENTAS_BASE.IVA_VENTAS)]);
  const lineas:any[]=[];
  const {data:pagos}=await supabase.from('comprobante_formas_pago').select('forma_pago_codigo,valor').eq('comprobante_id',c.id);
  if((pagos??[]).length){
    for(const p of pagos??[]){
      const codigo = String(p.forma_pago_codigo||'');
      const cuentaCodigo = codigo === '01' ? CUENTAS_BASE.CAJA : CUENTAS_BASE.BANCOS;
      if(cuentaCodigo){ const ac=await cuenta(c.emisor_id,cuentaCodigo); lineas.push({cuenta_id:ac.id,descripcion:'Cobro de factura',debe:money(Number(p.valor)),haber:0}); }
      else { lineas.push({cuenta_id:cuentas[0].id,descripcion:'Cuenta por cobrar',debe:money(Number(p.valor)),haber:0}); }
    }
  } else lineas.push({cuenta_id:cuentas[0].id,descripcion:'Cuenta por cobrar',debe:total,haber:0});
  if(base>0) lineas.push({cuenta_id:cuentas[1].id,descripcion:'Ingreso por venta/servicio',debe:0,haber:base});
  if(iva>0) lineas.push({cuenta_id:cuentas[2].id,descripcion:'IVA generado',debe:0,haber:iva});
  const debe=money(lineas.reduce((s,l)=>s+l.debe,0)); const haber=money(lineas.reduce((s,l)=>s+l.haber,0));
  if(Math.abs(debe-haber)>0.01) throw new Error(`Asiento no cuadra: Debe ${debe} / Haber ${haber}.`);
  const {data:a,error:ae}=await supabase.from('asientos_contables').insert({emisor_id:c.emisor_id,fecha:String(c.created_at).slice(0,10),tipo:'VENTA',concepto:`Factura ${c.secuencial||c.clave_acceso||c.id}`,referencia:c.clave_acceso,origen_tipo:'COMPROBANTE_VENTA',origen_id:c.id,estado:'CONTABILIZADO',total_debe:debe,total_haber:haber,diferencia:money(debe-haber),created_by:userId||null}).select('id,fecha,tipo,concepto,total_debe,total_haber').single();
  if(ae||!a) throw new Error(ae?.message||'No se pudo crear el asiento.');
  const {error:le}=await supabase.from('asiento_lineas_contables').insert(lineas.map(x=>({...x,asiento_id:a.id})));
  if(le){await supabase.from('asientos_contables').delete().eq('id',a.id);throw new Error(le.message);}
  return a;
}

export async function obtenerBalanza(emisorId:string,desde?:string,hasta?:string){
  await asegurarPlanBase(emisorId);
  let q=supabase.from('asiento_lineas_contables').select('debe,haber,plan_cuentas_contables!inner(id,codigo,nombre,tipo,naturaleza),asientos_contables!inner(emisor_id,fecha,estado)').eq('asientos_contables.emisor_id',emisorId).eq('asientos_contables.estado','CONTABILIZADO');
  if(desde) q=q.gte('asientos_contables.fecha',desde); if(hasta) q=q.lte('asientos_contables.fecha',hasta);
  const {data,error}=await q; if(error) throw new Error(error.message);
  const map=new Map<string,any>(); for(const r of data??[]){const c:any=r.plan_cuentas_contables;const x=map.get(c.id)||{id:c.id,codigo:c.codigo,nombre:c.nombre,tipo:c.tipo,naturaleza:c.naturaleza,debe:0,haber:0};x.debe+=Number(r.debe||0);x.haber+=Number(r.haber||0);map.set(c.id,x);} 
  return Array.from(map.values()).map(x=>({...x,debe:money(x.debe),haber:money(x.haber),saldo:money(x.debe-x.haber)})).sort((a,b)=>a.codigo.localeCompare(b.codigo));
}
