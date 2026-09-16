import { supabase } from '../db/supabase.js';
import { fechaIsoEcuador } from '../utils/fechaEcuador.js';
import { validarAsientoReversible, validarLineasContables, validarVinculoOpcional } from './contabilidadCalculos.js';
import { capturarSnapshotConfiguracion, CUENTAS_BASE, resolverCuentaContable, resolverCuentas } from './configuracionContable.js';
import { contabilizarEvento, construirLineasCompra, construirLineasRetencion, construirLineasVenta } from './eventosContables.js';

export { CUENTAS_BASE } from './configuracionContable.js';

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
  [CUENTAS_BASE.GASTOS_VENTAS,'GASTOS DE VENTAS',4,'GASTO','DEUDORA'],[CUENTAS_BASE.PROPINAS_POR_PAGAR,'PROPINAS POR PAGAR',4,'PASIVO','ACREEDORA'],[CUENTAS_BASE.MEDIOS_ELECTRONICOS,'CUENTAS POR COBRAR MEDIOS ELECTRÓNICOS',4,'ACTIVO','DEUDORA'],[CUENTAS_BASE.GASTOS_FINANCIEROS,'GASTOS FINANCIEROS',4,'GASTO','DEUDORA'],[CUENTAS_BASE.DEPRECIACION,'DEPRECIACIÓN DEL EJERCICIO',4,'GASTO','DEUDORA'],
];
const money=(n:number)=>Math.round((Number(n)||0)*100)/100;
export function cuentaParaFormaPago(codigo:string):string {
  const c=String(codigo||'').trim();
  if(c==='01') return CUENTAS_BASE.CAJA;
  if(['16','17','18','19'].includes(c)) return CUENTAS_BASE.MEDIOS_ELECTRONICOS;
  return CUENTAS_BASE.BANCOS;
}

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
  validarVinculoOpcional(args.origenTipo,args.origenId,'origen contable');
  for(const linea of args.lineas)validarVinculoOpcional(linea.terceroTipo,linea.terceroId,'tercero contable');
  const lineas=args.lineas.map(x=>({codigo:x.codigo,descripcion:x.descripcion||args.concepto,debe:money(x.debe||0),haber:money(x.haber||0),tercero_tipo:x.terceroTipo||null,tercero_id:x.terceroId||null}));
  validarLineasContables(lineas);
  if(!args.origenTipo||!args.origenId)throw new Error('Los asientos automáticos requieren origen trazable.');
  const snapshot=await capturarSnapshotConfiguracion(args.emisorId,args.fecha,args.lineas.map(x=>x.codigo));
  const resultado=await contabilizarEvento({emisorId:args.emisorId,tipoEvento:args.tipo,entidadTipo:args.origenTipo,entidadId:args.origenId,fechaContable:args.fecha,tipoAsiento:args.tipo,concepto:args.concepto,referencia:args.referencia,lineas:args.lineas.map(x=>({codigo:x.codigo,descripcion:x.descripcion,debe:Number(x.debe||0),haber:Number(x.haber||0),terceroTipo:x.terceroTipo,terceroId:x.terceroId})),snapshot,createdBy:args.userId||undefined,origenTipo:args.origenTipo,origenId:args.origenId});
  return resultado.asientoId;
}

export async function reversarAsientoContable(asientoId:string,emisorId:string,fecha:string,motivo:string,userId?:string){
  if(!asientoId||!emisorId||!/^\d{4}-\d{2}-\d{2}$/.test(fecha)||!motivo.trim()) throw new Error('Asiento, empresa, fecha y motivo de reverso son obligatorios.');
  const {data:original,error}=await supabase.from('asientos_contables').select('id,emisor_id,estado,tipo,origen_tipo,origen_id,reversa_de_id').eq('id',asientoId).eq('emisor_id',emisorId).single();
  if(error||!original) throw new Error('Asiento contable no encontrado para la empresa activa.');
  validarAsientoReversible({tipo:original.tipo,reversaDeId:original.reversa_de_id});
  const {data,error:rpcError}=await supabase.rpc('reversar_asiento_contable_atomico',{p_emisor_id:emisorId,p_asiento_id:asientoId,p_fecha:fecha,p_motivo:motivo.trim(),p_user_id:userId||null});
  if(rpcError) throw new Error(rpcError.message);
  return {id:String(data),estado:'CONTABILIZADO',reversaDeId:asientoId};
}

export async function contabilizarVenta(comprobanteId:string,userId?:string){
  const {data:c,error:ce}=await supabase.from('comprobantes').select('id,emisor_id,cliente_id,estado,tipo,created_at,importe_total,subtotal_0,subtotal_5,subtotal_8,subtotal_15,total_iva,propina,secuencial,clave_acceso').eq('id',comprobanteId).single();
  if(ce||!c) throw new Error(`Comprobante no encontrado: ${ce?.message||''}`.trim());
  const tipoComprobante = String((c as any).tipo || 'factura').toLowerCase();
  const esTicket = tipoComprobante === 'ticket';
  if (esTicket) {
    if (String(c.estado||'').toLowerCase() !== 'registrado') throw new Error(`El ticket no está en estado registrable: ${c.estado}`);
  } else if(String(c.estado||'').toLowerCase()!=='autorizado') throw new Error(`Solo se contabilizan comprobantes autorizados. Estado actual: ${c.estado}`);
  await asegurarPlanBase(c.emisor_id);
  const {data:existente,error:ee}=await supabase.from('asientos_contables').select('id,estado').eq('emisor_id',c.emisor_id).eq('origen_tipo','COMPROBANTE_VENTA').eq('origen_id',c.id).maybeSingle();
  if(ee) throw new Error(`No se pudo consultar el asiento existente: ${ee.message}`);
  if(existente) return existente;

  // Impuestos: usar snapshot dinámico cuando exista; si una instalación histórica
  // no tiene la tabla, se conserva el cálculo legacy del comprobante.
  let baseLegacy=Number(c.subtotal_0||0)+Number(c.subtotal_5||0)+Number(c.subtotal_8||0)+Number(c.subtotal_15||0);
  let ivaLegacy=Number(c.total_iva||0);
  const impsQ=await supabase.from('comprobante_impuestos').select('base_imponible,valor').eq('comprobante_id',c.id);
  if(!impsQ.error && (impsQ.data||[]).length){
    baseLegacy=(impsQ.data||[]).reduce((s:any,x:any)=>s+Number(x.base_imponible||0),0);
    ivaLegacy=(impsQ.data||[]).reduce((s:any,x:any)=>s+Number(x.valor||0),0);
  }
  const base=money(baseLegacy), iva=money(ivaLegacy), total=money(Number(c.importe_total||0));
  if(total<=0) throw new Error('El comprobante tiene total cero.');
  const fechaRaw=String(c.created_at||'');
  const fecha=/^\d{4}-\d{2}-\d{2}/.test(fechaRaw)?fechaIsoEcuador(new Date(fechaRaw)):fechaIsoEcuador(new Date());
  const clavesVenta=await resolverCuentas(c.emisor_id,['CLIENTES_CXC','INGRESOS_VENTAS','IVA_VENTAS_POR_PAGAR','PROPINAS_POR_PAGAR'],fecha);

  // Si no hay formas de pago (o una instalación antigua no tiene la tabla),
  // se lleva el total a Clientes. Nunca inventamos un cobro en efectivo.
  const pagosQ=await supabase.from('comprobante_formas_pago').select('forma_pago_codigo,valor').eq('comprobante_id',c.id);
  const lineas:Array<any>=[]; let pagado=0;
  if(!pagosQ.error){
    for(const p of pagosQ.data||[]){
      const v=money(Number(p.valor||0)); if(v<=0)continue;
      pagado+=v;
      const codigo=String(p.forma_pago_codigo||'');
      const clavePago=codigo==='01'?'CAJA':['16','17','18','19'].includes(codigo)?'MEDIOS_ELECTRONICOS':'BANCOS';
      const cuentaPago=await resolverCuentaContable(c.emisor_id,clavePago,fecha);
      lineas.push({codigo:cuentaPago.codigo,descripcion:`Cobro de ${esTicket ? 'ticket' : 'factura'} (${codigo||'forma de pago'})`,debe:v,haber:0});
    }
  }
  if(pagado>total+0.01) throw new Error(`Las formas de pago superan el total de la factura: pagos ${pagado} / total ${total}.`);
  const porCobrar=money(total-pagado);
  if(porCobrar>0){
    if(!c.cliente_id) throw new Error('La factura tiene saldo pendiente pero no tiene cliente asociado para crear la cuenta por cobrar.');
    const {data:cli}=await supabase.from('clientes').select('id,emisor_id').eq('id',c.cliente_id).eq('emisor_id',c.emisor_id).maybeSingle();
    if(!cli) throw new Error('El cliente de la factura no pertenece a la empresa.');
    const existenteCxc=await supabase.from('cuentas_por_cobrar').select('id').eq('emisor_id',c.emisor_id).eq('comprobante_id',c.id).maybeSingle();
    if(existenteCxc.error) throw new Error(`No se pudo consultar la cuenta por cobrar de la factura: ${existenteCxc.error.message}`);
    if(!existenteCxc.data){
      const fechaVencimiento=fechaRaw.slice(0,10)||fechaIsoEcuador(new Date());
      const alta=await supabase.from('cuentas_por_cobrar').insert({emisor_id:c.emisor_id,cliente_id:c.cliente_id,comprobante_id:c.id,concepto:`Factura ${c.secuencial||c.id}`,fecha_emision:fechaVencimiento,fecha_vencimiento:fechaVencimiento,monto_total:porCobrar}).select('id').single();
      if(alta.error) throw new Error(`No se pudo crear automáticamente la cuenta por cobrar: ${alta.error.message}`);
    }
    lineas.push({codigo:clavesVenta.CLIENTES_CXC.codigo,descripcion:'Saldo pendiente de factura',debe:porCobrar,haber:0,terceroTipo:'CLIENTE',terceroId:c.cliente_id});
  }
  if(base>0) lineas.push({codigo:clavesVenta.INGRESOS_VENTAS.codigo,descripcion:'Ingreso por venta/servicio',debe:0,haber:base});
  if(iva>0) lineas.push({codigo:clavesVenta.IVA_VENTAS_POR_PAGAR.codigo,descripcion:'IVA generado según comprobante',debe:0,haber:iva});
  const propina=money(Number((c as any).propina||0));
  if(propina>0) lineas.push({codigo:clavesVenta.PROPINAS_POR_PAGAR.codigo,descripcion:'Propina cobrada pendiente de entrega',debe:0,haber:propina});

  // Costo de ventas: tolera esquemas antiguos donde la columna de costo no existe.
  const itemsQ=await supabase.from('comprobante_items').select('producto_id,cantidad,costo_unitario_momento').eq('comprobante_id',c.id);
  let costo=0;
  if(!itemsQ.error){ costo=money((itemsQ.data||[]).reduce((s:any,x:any)=>s+(x.producto_id?Number(x.cantidad||0)*Number(x.costo_unitario_momento||0):0),0)); }
  // Fallback para ventas antiguas: si los items no conservan el costo snapshot,
  // recuperamos el costo desde la salida de inventario asociada al comprobante.
  if(costo<=0){
    const movQ=await supabase.from('movimientos_inventario')
      .select('cantidad,costo_unitario')
      .eq('emisor_id',c.emisor_id)
      .eq('tipo','salida')
      .eq('referencia_tipo','comprobante')
      .eq('referencia_id',c.id);
    if(!movQ.error){
      costo=money((movQ.data||[]).reduce((s:any,x:any)=>s+Number(x.cantidad||0)*Number(x.costo_unitario||0),0));
    }
  }
  if(costo>0){
    const cuentasCosto=await resolverCuentas(c.emisor_id,['COSTO_VENTAS','INVENTARIO'],fecha);
    lineas.push({codigo:cuentasCosto.COSTO_VENTAS.codigo,descripcion:'Costo de ventas automático',debe:costo,haber:0});
    lineas.push({codigo:cuentasCosto.INVENTARIO.codigo,descripcion:'Salida de inventario por venta',debe:0,haber:costo});
  }
  const id=await asientoAtomico({emisorId:c.emisor_id,fecha,tipo:'VENTA',concepto:`${esTicket ? 'Ticket' : 'Factura'} ${c.secuencial||c.clave_acceso||c.id}`,referencia:c.clave_acceso || c.secuencial || c.id,origenTipo:'COMPROBANTE_VENTA',origenId:c.id,userId,lineas});
  return {id,estado:'CONTABILIZADO'};
}

export async function contabilizarMovimientoInventario(movimientoId:string,userId?:string){
  const {data:m,error}=await supabase.from('movimientos_inventario').select('id,emisor_id,producto_id,tipo,cantidad,costo_unitario,referencia_tipo,referencia_id,proveedor_id,created_at').eq('id',movimientoId).single();
  if(error||!m) throw new Error('Movimiento de inventario no encontrado.');
  await asegurarPlanBase(m.emisor_id);
  const {data:ex}=await supabase.from('asientos_contables').select('id').eq('emisor_id',m.emisor_id).eq('origen_tipo','MOVIMIENTO_INVENTARIO').eq('origen_id',m.id).maybeSingle();
  if(ex)return {id:ex.id,estado:'YA_CONTABILIZADO'};
  const cantidad=Math.abs(Number(m.cantidad||0)), costo=Math.abs(Number(m.costo_unitario||0)), valor=money(cantidad*costo);
  if(valor<=0)return {id:null,estado:'SIN_IMPACTO_CONTABLE'};
  const tipo=String(m.tipo||'').toLowerCase();
  const fecha=fechaIsoEcuador(new Date(m.created_at||new Date()));
  const cfg=await resolverCuentas(m.emisor_id,['INVENTARIO','PROVEEDORES_CXP','CAJA','COSTO_VENTAS','OTROS_INGRESOS','PERDIDA_INVENTARIO'],fecha);
  if(tipo==='entrada'){
    const lineas:any[]=[{codigo:cfg.INVENTARIO.codigo,descripcion:'Entrada de inventario',debe:valor,haber:0}];
    if(m.proveedor_id){
      const {data:p}=await supabase.from('proveedores').select('id,emisor_id').eq('id',m.proveedor_id).eq('emisor_id',m.emisor_id).maybeSingle();
      if(!p)throw new Error('El proveedor del movimiento de inventario no pertenece a la empresa.');
      lineas.push({codigo:cfg.PROVEEDORES_CXP.codigo,descripcion:'Obligación por compra de inventario',debe:0,haber:valor,terceroTipo:'PROVEEDOR',terceroId:m.proveedor_id});
    }else{
      lineas.push({codigo:cfg.CAJA.codigo,descripcion:'Compra de inventario pagada al contado',debe:0,haber:valor});
    }
    const id=await asientoAtomico({emisorId:m.emisor_id,fecha,tipo:'INVENTARIO_ENTRADA',concepto:`Entrada de inventario ${m.id}`,referencia:m.referencia_id||m.referencia_tipo||m.id,origenTipo:'MOVIMIENTO_INVENTARIO',origenId:m.id,userId,lineas}); return {id,estado:'CONTABILIZADO'};
  }
  if(tipo==='salida'){
    const lineas=[{codigo:cfg.COSTO_VENTAS.codigo,descripcion:'Costo de salida de inventario',debe:valor,haber:0},{codigo:cfg.INVENTARIO.codigo,descripcion:'Salida de inventario',debe:0,haber:valor}];
    const id=await asientoAtomico({emisorId:m.emisor_id,fecha,tipo:'INVENTARIO_SALIDA',concepto:`Salida de inventario ${m.id}`,referencia:m.referencia_id||m.referencia_tipo||m.id,origenTipo:'MOVIMIENTO_INVENTARIO',origenId:m.id,userId,lineas}); return {id,estado:'CONTABILIZADO'};
  }
  if(tipo==='ajuste'){
    const delta=Number(m.cantidad||0);
    if(delta>0){const lineas=[{codigo:cfg.INVENTARIO.codigo,descripcion:'Ajuste positivo de inventario',debe:valor,haber:0},{codigo:cfg.OTROS_INGRESOS.codigo,descripcion:'Contrapartida ajuste positivo de inventario',debe:0,haber:valor}];const id=await asientoAtomico({emisorId:m.emisor_id,fecha,tipo:'AJUSTE_INVENTARIO',concepto:`Ajuste positivo de inventario ${m.id}`,referencia:m.referencia_id||m.id,origenTipo:'MOVIMIENTO_INVENTARIO',origenId:m.id,userId,lineas});return {id,estado:'CONTABILIZADO'};}
    if(delta<0){const lineas=[{codigo:cfg.PERDIDA_INVENTARIO.codigo,descripcion:'Pérdida por ajuste negativo de inventario',debe:valor,haber:0},{codigo:cfg.INVENTARIO.codigo,descripcion:'Disminución por ajuste de inventario',debe:0,haber:valor}];const id=await asientoAtomico({emisorId:m.emisor_id,fecha,tipo:'AJUSTE_INVENTARIO',concepto:`Ajuste negativo de inventario ${m.id}`,referencia:m.referencia_id||m.id,origenTipo:'MOVIMIENTO_INVENTARIO',origenId:m.id,userId,lineas});return {id,estado:'CONTABILIZADO'};}
  }
  return {id:null,estado:'SIN_IMPACTO_CONTABLE'};
}

export async function contabilizarCxP(cuentaId:string,userId?:string){
  const {data:c,error}=await supabase.from('cuentas_por_pagar').select('id,emisor_id,concepto,fecha_emision,monto_total,proveedor_id,numero_documento,movimiento_inventario_id,documento_sri_id').eq('id',cuentaId).single();
  if(error||!c) throw new Error('Cuenta por pagar no encontrada.');
  await asegurarPlanBase(c.emisor_id);
  const {data:prov}=await supabase.from('proveedores').select('id,emisor_id').eq('id',c.proveedor_id).eq('emisor_id',c.emisor_id).maybeSingle();
  if(!prov) throw new Error('El proveedor de la cuenta por pagar no pertenece a la empresa.');
  const {data:ex}=await supabase.from('asientos_contables').select('id').eq('emisor_id',c.emisor_id).eq('origen_tipo','CUENTA_POR_PAGAR').eq('origen_id',c.id).maybeSingle();
  if(ex)return {id:ex.id,estado:'YA_CONTABILIZADO'};
  if((c as any).documento_sri_id){
    const {data:docAsiento}=await supabase.from('asientos_contables').select('id').eq('emisor_id',c.emisor_id).eq('origen_tipo','DOCUMENTO_SRI').eq('origen_id',(c as any).documento_sri_id).maybeSingle();
    if(docAsiento) return {id:docAsiento.id,estado:'CONTABILIZADO_ORIGEN_DOCUMENTO'};
  }
  if((c as any).movimiento_inventario_id){
    const {data:movAsiento}=await supabase.from('asientos_contables').select('id').eq('emisor_id',c.emisor_id).eq('origen_tipo','MOVIMIENTO_INVENTARIO').eq('origen_id',(c as any).movimiento_inventario_id).maybeSingle();
    if(movAsiento) return {id:movAsiento.id,estado:'CONTABILIZADO_ORIGEN_INVENTARIO'};
  }
  const clasificacion=await resolverCuentaContable(c.emisor_id,'COMPRA_CLASIFICACION_DEFAULT',c.fecha_emision,false);
  const proveedor=await resolverCuentaContable(c.emisor_id,'PROVEEDORES_CXP',c.fecha_emision);
  const id=await asientoAtomico({emisorId:c.emisor_id,fecha:c.fecha_emision,tipo:'COMPRA',concepto:c.concepto,referencia:c.numero_documento,origenTipo:'CUENTA_POR_PAGAR',origenId:c.id,userId,lineas:construirLineasCompra({base:Number(c.monto_total),iva:0,clasificacionCodigo:clasificacion.codigo,contrapartidaCodigo:proveedor.codigo,proveedorId:c.proveedor_id})});
  return {id,estado:'CONTABILIZADO'};
}

export async function contabilizarPagoCxP(cuentaId:string,pagoId:string,userId?:string){
  const {data:c}=await supabase.from('cuentas_por_pagar').select('id,emisor_id,proveedor_id,concepto').eq('id',cuentaId).single();
  if(!c) throw new Error('Cuenta por pagar no encontrada.');
  const {data:p}=await supabase.from('pagos_cuentas_por_pagar').select('id,cuenta_id,monto,forma_pago_codigo,created_at').eq('id',pagoId).eq('cuenta_id',cuentaId).single();
  if(!p) throw new Error('El pago no pertenece a la cuenta por pagar indicada.'); await asegurarPlanBase(c.emisor_id);
  const codigo=String(p.forma_pago_codigo||'20'),fecha=fechaIsoEcuador(new Date(p.created_at));const clavePago=codigo==='01'?'CAJA':['16','17','18','19'].includes(codigo)?'MEDIOS_ELECTRONICOS':'BANCOS';const cfg=await resolverCuentas(c.emisor_id,['PROVEEDORES_CXP',clavePago],fecha);
  const id=await asientoAtomico({emisorId:c.emisor_id,fecha,tipo:'PAGO_PROVEEDOR',concepto:`Pago: ${c.concepto}`,origenTipo:'PAGO_CXP',origenId:p.id,userId,lineas:[{codigo:cfg.PROVEEDORES_CXP.codigo,debe:Number(p.monto),haber:0,terceroTipo:'PROVEEDOR',terceroId:c.proveedor_id},{codigo:cfg[clavePago].codigo,debe:0,haber:Number(p.monto)}]});return {id};
}

export async function contabilizarCxC(cuentaId:string,userId?:string){
  const {data:c,error}=await supabase.from('cuentas_por_cobrar').select('id,emisor_id,concepto,fecha_emision,monto_total,cliente_id,comprobante_id,documento_sri_id').eq('id',cuentaId).single();
  if(error||!c) throw new Error('Cuenta por cobrar no encontrada.');
  await asegurarPlanBase(c.emisor_id);
  const {data:cli}=await supabase.from('clientes').select('id,emisor_id').eq('id',c.cliente_id).eq('emisor_id',c.emisor_id).maybeSingle();
  if(!cli) throw new Error('El cliente de la cuenta por cobrar no pertenece a la empresa.');
  const {data:ex}=await supabase.from('asientos_contables').select('id').eq('emisor_id',c.emisor_id).eq('origen_tipo','CUENTA_POR_COBRAR').eq('origen_id',c.id).maybeSingle();
  if(ex)return {id:ex.id,estado:'YA_CONTABILIZADO'};
  if(c.comprobante_id){
    const {data:ventaAsiento}=await supabase.from('asientos_contables').select('id').eq('emisor_id',c.emisor_id).eq('origen_tipo','COMPROBANTE_VENTA').eq('origen_id',c.comprobante_id).maybeSingle();
    if(ventaAsiento) return {id:ventaAsiento.id,estado:'CONTABILIZADO_ORIGEN_COMPROBANTE'};
  }
  if((c as any).documento_sri_id){
    const {data:docAsiento}=await supabase.from('asientos_contables').select('id').eq('emisor_id',c.emisor_id).eq('origen_tipo','DOCUMENTO_SRI').eq('origen_id',(c as any).documento_sri_id).maybeSingle();
    if(docAsiento) return {id:docAsiento.id,estado:'CONTABILIZADO_ORIGEN_DOCUMENTO'};
  }
  if((c as any).movimiento_inventario_id){
    const {data:movAsiento}=await supabase.from('asientos_contables').select('id').eq('emisor_id',c.emisor_id).eq('origen_tipo','MOVIMIENTO_INVENTARIO').eq('origen_id',(c as any).movimiento_inventario_id).maybeSingle();
    if(movAsiento) return {id:movAsiento.id,estado:'CONTABILIZADO_ORIGEN_INVENTARIO'};
  }
  const cfg=await resolverCuentas(c.emisor_id,['CLIENTES_CXC','INGRESOS_VENTAS'],c.fecha_emision);
  const id=await asientoAtomico({emisorId:c.emisor_id,fecha:c.fecha_emision,tipo:'CUENTA_POR_COBRAR',concepto:c.concepto,origenTipo:'CUENTA_POR_COBRAR',origenId:c.id,userId,lineas:[{codigo:cfg.CLIENTES_CXC.codigo,descripcion:c.concepto,debe:Number(c.monto_total),haber:0,terceroTipo:'CLIENTE',terceroId:c.cliente_id},{codigo:cfg.INGRESOS_VENTAS.codigo,descripcion:'Ingreso pendiente de cobro',debe:0,haber:Number(c.monto_total)}]});
  return {id,estado:'CONTABILIZADO'};
}
export async function contabilizarCobroCxC(cuentaId:string,pagoId:string,userId?:string){
  const {data:c}=await supabase.from('cuentas_por_cobrar').select('id,emisor_id,cliente_id,concepto').eq('id',cuentaId).single();
  if(!c) throw new Error('Cuenta por cobrar no encontrada.');
  const {data:p}=await supabase.from('pagos_cuentas_por_cobrar').select('id,cuenta_id,monto,forma_pago_codigo,created_at').eq('id',pagoId).eq('cuenta_id',cuentaId).single();
  if(!p) throw new Error('El cobro no pertenece a la cuenta por cobrar indicada.'); await asegurarPlanBase(c.emisor_id);
  const codigo=String(p.forma_pago_codigo||'01'),fecha=fechaIsoEcuador(new Date(p.created_at));const claveCobro=codigo==='01'?'CAJA':['16','17','18','19'].includes(codigo)?'MEDIOS_ELECTRONICOS':'BANCOS';const cfg=await resolverCuentas(c.emisor_id,['CLIENTES_CXC',claveCobro],fecha);
  const id=await asientoAtomico({emisorId:c.emisor_id,fecha,tipo:'COBRO_CLIENTE',concepto:`Cobro: ${c.concepto}`,origenTipo:'PAGO_CXC',origenId:p.id,userId,lineas:[{codigo:cfg[claveCobro].codigo,descripcion:'Ingreso de cobro',debe:Number(p.monto),haber:0},{codigo:cfg.CLIENTES_CXC.codigo,descripcion:'Aplicación de cobro',debe:0,haber:Number(p.monto),terceroTipo:'CLIENTE',terceroId:c.cliente_id}]});return {id};
}

export async function obtenerBalanza(emisorId:string,desde?:string,hasta?:string){
  await asegurarPlanBase(emisorId);
  const aq=supabase.from('asientos_contables').select('id,fecha,estado').eq('emisor_id',emisorId).eq('estado','CONTABILIZADO').order('fecha',{ascending:true});
  if(desde)aq.gte('fecha',desde);if(hasta)aq.lte('fecha',hasta);
  const {data:asientos,error:ae}=await aq.limit(10000);if(ae)throw new Error(ae.message);const ids=(asientos||[]).map(a=>a.id);if(!ids.length)return [];
  const {data:lineas,error:le}=await supabase.from('asiento_lineas_contables').select('cuenta_id,debe,haber').in('asiento_id',ids);if(le)throw new Error(le.message);
  const cids=[...new Set((lineas||[]).map(x=>x.cuenta_id).filter(Boolean))];let cuentas:any[]=[]; let ce:any=null; if(cids.length){const r=await supabase.from('plan_cuentas_contables').select('id,codigo,nombre,tipo,naturaleza').in('id',cids); cuentas=r.data||[]; ce=r.error||null;} if(ce)throw new Error(ce.message);
  const cm=new Map((cuentas||[]).map(c=>[c.id,c]));const map=new Map<string,any>();for(const r of lineas||[]){const c:any=cm.get(r.cuenta_id);if(!c)continue;const x=map.get(c.id)||{id:c.id,codigo:c.codigo,nombre:c.nombre,tipo:c.tipo,naturaleza:c.naturaleza,debe:0,haber:0,saldo:0};x.debe+=Number(r.debe||0);x.haber+=Number(r.haber||0);map.set(c.id,x);}return Array.from(map.values()).map(x=>({...x,debe:money(x.debe),haber:money(x.haber),saldo:money(x.debe-x.haber)})).sort((a,b)=>a.codigo.localeCompare(b.codigo));
}

/** Contabiliza un documento SRI complementario sin duplicar el asiento. */
export async function contabilizarDocumentoSri(documentoId:string,userId?:string){
  const {data:doc,error}=await supabase.from('documentos_sri_borrador').select('id,emisor_id,tipo,estado,secuencial,clave_acceso,created_at,datos,cliente_id,comprobante_sustento_id').eq('id',documentoId).single();
  if(error||!doc) throw new Error('Documento SRI no encontrado.');
  if(String(doc.estado).toLowerCase()!=='autorizado') throw new Error('Solo se contabilizan documentos SRI autorizados.');
  if(doc.tipo==='guia_remision') return {estado:'SIN_IMPACTO_CONTABLE',id:null};
  await asegurarPlanBase(doc.emisor_id);
  const {data:existente}=await supabase.from('asientos_contables').select('id').eq('emisor_id',doc.emisor_id).eq('origen_tipo','DOCUMENTO_SRI').eq('origen_id',doc.id).maybeSingle();
  if(existente) return {estado:'YA_CONTABILIZADO',id:existente.id};
  const d:any=doc.datos||{};
  const fecha=String(d.fechaEmision||d.fecha||doc.created_at||'').slice(0,10)||fechaIsoEcuador(new Date());
  let total=money(Number(d.importeTotal??d.valorTotal??d.valorModificacion??0));
  let base=money(Number(d.totalSinImpuestos??d.subtotalSinImpuestos??0));
  let iva=money(Number(d.totalIva??d.iva??0));
  if(base<=0 && total>0){ base=money(Math.max(0,total-iva)); }
  if((doc.tipo==='nota_credito'||doc.tipo==='nota_debito') && base<=0 && total>0){
    const imp=Array.isArray(d.impuestos)?d.impuestos:[];
    const ivaImp=money(imp.reduce((s:number,x:any)=>s+Number(x.valor??x.valorImpuesto??x.valorIva??0),0));
    iva=ivaImp||iva; base=money(Math.max(0,total-iva));
  }
  if(total<=0 && doc.tipo==='retencion') return {estado:'PENDIENTE_VINCULO',id:null,motivo:'Retención sin valores contabilizables.'};
  if(base+iva>0 && Math.abs(money(base+iva)-total)>0.02) { iva=money(Math.max(0,total-base)); }
  const baseSegura=money(Math.max(0,Math.min(base,total))); const ivaSegura=money(Math.max(0,total-baseSegura));
  let lineas:any[]=[];
  if(doc.tipo==='nota_credito'){
    const cfg=await resolverCuentas(doc.emisor_id,['INGRESOS_VENTAS','IVA_VENTAS_POR_PAGAR','CLIENTES_CXC'],fecha);
    lineas=[...(baseSegura?[{codigo:cfg.INGRESOS_VENTAS.codigo,descripcion:'Reversión de venta por nota de crédito',debe:baseSegura,haber:0}]:[]),...(ivaSegura?[{codigo:cfg.IVA_VENTAS_POR_PAGAR.codigo,descripcion:'Reversión del IVA por nota de crédito',debe:ivaSegura,haber:0}]:[]),{codigo:cfg.CLIENTES_CXC.codigo,descripcion:'Disminución de cuenta por cobrar por nota de crédito',debe:0,haber:total,terceroTipo:'CLIENTE',terceroId:doc.cliente_id||undefined}];
    const id=await asientoAtomico({emisorId:doc.emisor_id,fecha,tipo:'NOTA_CREDITO',concepto:`Nota de crédito ${doc.secuencial||doc.id}`,referencia:doc.clave_acceso||String(doc.comprobante_sustento_id||doc.id),origenTipo:'DOCUMENTO_SRI',origenId:doc.id,userId,lineas}); return {estado:'CONTABILIZADO',id};
  }
  if(doc.tipo==='nota_debito'){
    const cfg=await resolverCuentas(doc.emisor_id,['INGRESOS_VENTAS','IVA_VENTAS_POR_PAGAR','CLIENTES_CXC'],fecha);
    lineas=[{codigo:cfg.CLIENTES_CXC.codigo,descripcion:'Incremento de cuenta por cobrar por nota de débito',debe:total,haber:0,terceroTipo:'CLIENTE',terceroId:doc.cliente_id||undefined},...(baseSegura?[{codigo:cfg.INGRESOS_VENTAS.codigo,descripcion:'Ingreso adicional por nota de débito',debe:0,haber:baseSegura}]:[]),...(ivaSegura?[{codigo:cfg.IVA_VENTAS_POR_PAGAR.codigo,descripcion:'IVA adicional por nota de débito',debe:0,haber:ivaSegura}]:[])];
    const id=await asientoAtomico({emisorId:doc.emisor_id,fecha,tipo:'NOTA_DEBITO',concepto:`Nota de débito ${doc.secuencial||doc.id}`,referencia:doc.clave_acceso||String(doc.id),origenTipo:'DOCUMENTO_SRI',origenId:doc.id,userId,lineas}); return {estado:'CONTABILIZADO',id};
  }
  if(doc.tipo==='liquidacion_compra'){
    let proveedorId:any=null; const dProv=String(d.identificacionProveedor||'').trim();
    if(dProv){const q=await supabase.from('proveedores').select('id,emisor_id').eq('emisor_id',doc.emisor_id).eq('identificacion',dProv).maybeSingle(); proveedorId=q.data?.id||null;}
    if(!proveedorId)return {estado:'PENDIENTE_VINCULO',id:null,motivo:'Liquidación sin proveedor empresarial vinculado.'};
    const clasificacion=await resolverCuentaContable(doc.emisor_id,'COMPRA_CLASIFICACION_DEFAULT',fecha,false),cfg=await resolverCuentas(doc.emisor_id,['IVA_COMPRAS_CREDITO','PROVEEDORES_CXP'],fecha);
    lineas=construirLineasCompra({base:baseSegura,iva:ivaSegura,clasificacionCodigo:clasificacion.codigo,ivaCodigo:cfg.IVA_COMPRAS_CREDITO.codigo,contrapartidaCodigo:cfg.PROVEEDORES_CXP.codigo,proveedorId});
    const id=await asientoAtomico({emisorId:doc.emisor_id,fecha,tipo:'LIQUIDACION_COMPRA',concepto:`Liquidación de compra ${doc.secuencial||doc.id}`,referencia:doc.clave_acceso||String(doc.id),origenTipo:'DOCUMENTO_SRI',origenId:doc.id,userId,lineas}); return {estado:'CONTABILIZADO',id};
  }
  if(doc.tipo==='retencion'){
    const numSustento=String(d.numDocSustento||d.numDocModificado||'').trim(); let cxp:any=null;
    if(numSustento){const q=await supabase.from('cuentas_por_pagar').select('id,emisor_id,proveedor_id,monto_total').eq('emisor_id',doc.emisor_id).eq('numero_documento',numSustento).order('created_at',{ascending:false}).limit(1).maybeSingle(); cxp=q.data||null;}
    const retDetalles=Array.isArray(d.docsSustento)?d.docsSustento.flatMap((x:any)=>Array.isArray(x.retenciones)?x.retenciones:[]):Array.isArray(d.impuestos)?d.impuestos:Array.isArray(d.retenciones)?d.retenciones:[];
    const ir=money(retDetalles.filter((x:any)=>String(x.codigo||x.tipo||'1')!=='2').reduce((s:number,x:any)=>s+Number(x.valorRetenido??x.valor??0),0));
    const ivaRet=money(retDetalles.filter((x:any)=>String(x.codigo||x.tipo||'')==='2').reduce((s:number,x:any)=>s+Number(x.valorRetenido??x.valor??0),0));const totalRet=money(ir+ivaRet||Number(d.valorRetenidoTotal||0));
    if(!cxp||totalRet<=0) return {estado:'PENDIENTE_VINCULO',id:null,motivo:'La retención queda pendiente hasta vincularla con la cuenta por pagar de su sustento.'};
    if(ir+ivaRet<=0)return {estado:'PENDIENTE_VINCULO',id:null,motivo:'La retención no identifica por separado valores de IR e IVA.'};
    const cfg=await resolverCuentas(doc.emisor_id,['PROVEEDORES_CXP',...(ir>0?['RETENCION_IR_POR_PAGAR']:[]),...(ivaRet>0?['RETENCION_IVA_POR_PAGAR']:[])],fecha);
    lineas=construirLineasRetencion({proveedorCodigo:cfg.PROVEEDORES_CXP.codigo,proveedorId:cxp.proveedor_id,ir,iva:ivaRet,irCodigo:cfg.RETENCION_IR_POR_PAGAR?.codigo,ivaCodigo:cfg.RETENCION_IVA_POR_PAGAR?.codigo});
    const id=await asientoAtomico({emisorId:doc.emisor_id,fecha,tipo:'RETENCION',concepto:`Retención ${doc.secuencial||doc.id}`,referencia:doc.clave_acceso||String(doc.id),origenTipo:'DOCUMENTO_SRI',origenId:doc.id,userId,lineas}); return {estado:'CONTABILIZADO',id};
  }
  return {estado:'SIN_IMPACTO_CONTABLE',id:null};
}

export async function contabilizarNominaPeriodo(periodoId:string,userId?:string){
  const {data:per,error}=await supabase.from('nomina_periodos').select('*').eq('id',periodoId).single();
  if(error||!per) throw new Error('Período de nómina no encontrado.');
  if(!['CALCULADO','CONTABILIZADO'].includes(String(per.estado))) throw new Error('La nómina debe estar CALCULADA antes de contabilizarse.');
  const {data:ex}=await supabase.from('asientos_contables').select('id').eq('emisor_id',per.emisor_id).eq('origen_tipo','NOMINA_PERIODO').eq('origen_id',per.id).maybeSingle();
  if(ex){await supabase.from('nomina_periodos').update({estado:'CONTABILIZADO',asiento_id:ex.id,updated_at:new Date().toISOString()}).eq('id',per.id);return {id:ex.id,estado:'YA_CONTABILIZADO'};}
  const {data:det,error:de}=await supabase.from('nomina_detalles').select('*').eq('periodo_id',per.id); if(de)throw new Error(de.message); if(!det?.length)throw new Error('La nómina no tiene detalles calculados.');
  const sum=(k:string)=>money((det||[]).reduce((s:any,x:any)=>s+Number(x[k]||0),0));
  const t={sueldo:sum('sueldo'),iessPatronal:sum('iess_patronal'),decimoTercero:sum('decimo_tercero'),decimoCuarto:sum('decimo_cuarto'),vacaciones:sum('vacaciones'),fondoReserva:sum('fondo_reserva'),beneficiosAcumulados:sum('beneficios_acumulados'),netoPagar:sum('neto_pagar'),iessPersonal:sum('iess_personal')};
  const beneficios=t.beneficiosAcumulados||money(t.decimoTercero+t.decimoCuarto+t.vacaciones+t.fondoReserva);
  const lineas=[{codigo:'5.2.05.01',descripcion:'Sueldos y salarios',debe:t.sueldo,haber:0},{codigo:'5.2.05.02',descripcion:'Aporte patronal IESS',debe:t.iessPatronal,haber:0},{codigo:'5.2.05.03',descripcion:'Décimo tercero',debe:t.decimoTercero,haber:0},{codigo:'5.2.05.04',descripcion:'Décimo cuarto',debe:t.decimoCuarto,haber:0},{codigo:'5.2.05.05',descripcion:'Vacaciones',debe:t.vacaciones,haber:0},{codigo:'5.2.05.06',descripcion:'Fondos de reserva',debe:t.fondoReserva,haber:0},{codigo:'2.1.03.02',descripcion:'Sueldos por pagar',debe:0,haber:t.netoPagar},{codigo:'2.1.03.03',descripcion:'IESS aporte personal por pagar',debe:0,haber:t.iessPersonal},{codigo:'2.1.03.04',descripcion:'IESS aporte patronal por pagar',debe:0,haber:t.iessPatronal},{codigo:'2.1.03.05',descripcion:'Beneficios sociales por pagar',debe:0,haber:beneficios}];
  const fecha=new Date(Number(String(per.periodo).slice(0,4)),Number(String(per.periodo).slice(5,7)),0).toISOString().slice(0,10);
  const id=await asientoAtomico({emisorId:per.emisor_id,fecha,tipo:'NOMINA',concepto:`Nómina ${per.periodo}`,referencia:per.periodo,origenTipo:'NOMINA_PERIODO',origenId:per.id,userId,lineas});
  await supabase.from('nomina_detalles').update({asiento_id:id}).eq('periodo_id',per.id); await supabase.from('nomina_periodos').update({estado:'CONTABILIZADO',asiento_id:id,updated_at:new Date().toISOString()}).eq('id',per.id); return {id,estado:'CONTABILIZADO'};
}

export async function sincronizarTodoContabilidad(emisorId:string,userId?:string){
  await asegurarPlanBase(emisorId); const r:any={ventas:{procesadas:0,ya:0,fallidas:0,errores:[]},tickets:{procesadas:0,ya:0,fallidas:0,errores:[]},inventario:{procesadas:0,ya:0,fallidas:0,errores:[]},sri:{procesadas:0,ya:0,pendientes:0,sinImpacto:0,fallidas:0,errores:[]},cxp:{procesadas:0,ya:0,fallidas:0,errores:[]},cxc:{procesadas:0,ya:0,fallidas:0,errores:[]},pagosCxp:{procesadas:0,fallidas:0,errores:[]},cobrosCxc:{procesadas:0,fallidas:0,errores:[]},nomina:{procesadas:0,ya:0,fallidas:0,errores:[]}};
  const {data:comps,error:ec}=await supabase.from('comprobantes').select('id,tipo,estado').eq('emisor_id',emisorId).in('estado',['autorizado','AUTORIZADO','registrado']).order('created_at',{ascending:true}).limit(10000); if(ec)throw new Error(ec.message);
  for(const c of comps||[]){const t=String(c.tipo||'').toLowerCase();if(!['factura','ticket'].includes(t))continue;const z=t==='ticket'?r.tickets:r.ventas;try{const ex=await supabase.from('asientos_contables').select('id').eq('emisor_id',emisorId).eq('origen_tipo','COMPROBANTE_VENTA').eq('origen_id',c.id).maybeSingle();if(ex.error)throw new Error(ex.error.message);if(ex.data){z.ya++;continue;}await contabilizarVenta(c.id,userId);z.procesadas++;}catch(e){z.fallidas++;z.errores.push(`${c.id}: ${e instanceof Error?e.message:String(e)}`);}}
  const {data:movs,error:em}=await supabase.from('movimientos_inventario').select('id,tipo,referencia_tipo').eq('emisor_id',emisorId).in('tipo',['entrada','ajuste','salida']).order('created_at',{ascending:true}).limit(10000);if(em)throw new Error(em.message);for(const m of movs||[]){if(String(m.tipo).toLowerCase()==='salida'&&String(m.referencia_tipo||'').toLowerCase()==='comprobante')continue;try{const z=await contabilizarMovimientoInventario(m.id,userId);if(z.estado==='YA_CONTABILIZADO')r.inventario.ya++;else if(z.estado==='CONTABILIZADO')r.inventario.procesadas++;}catch(e){r.inventario.fallidas++;r.inventario.errores.push(`${m.id}: ${e instanceof Error?e.message:String(e)}`)}}
  const {data:docs,error:ed}=await supabase.from('documentos_sri_borrador').select('id,tipo,estado').eq('emisor_id',emisorId).eq('estado','autorizado').order('created_at',{ascending:true}).limit(10000); if(ed)throw new Error(ed.message); for(const d of docs||[]){try{const x=await contabilizarDocumentoSri(d.id,userId);if(x.estado==='YA_CONTABILIZADO')r.sri.ya++;else if(x.estado==='CONTABILIZADO')r.sri.procesadas++;else if(x.estado==='PENDIENTE_VINCULO')r.sri.pendientes++;else r.sri.sinImpacto++;}catch(e){r.sri.fallidas++;r.sri.errores.push(`${d.id}: ${e instanceof Error?e.message:String(e)}`);}}
  const {data:cxps,error:ecp}=await supabase.from('cuentas_por_pagar').select('id').eq('emisor_id',emisorId).limit(10000);if(ecp)throw new Error(ecp.message);for(const x of cxps||[]){try{const z=await contabilizarCxP(x.id,userId);if(['YA_CONTABILIZADO','CONTABILIZADO_ORIGEN_DOCUMENTO'].includes(z.estado))r.cxp.ya++;else r.cxp.procesadas++;}catch(e){r.cxp.fallidas++;r.cxp.errores.push(`${x.id}: ${e instanceof Error?e.message:String(e)}`);}}
  const {data:cxc,error:ecr}=await supabase.from('cuentas_por_cobrar').select('id').eq('emisor_id',emisorId).limit(10000);if(ecr)throw new Error(ecr.message);for(const x of cxc||[]){try{const z=await contabilizarCxC(x.id,userId);if(['YA_CONTABILIZADO','CONTABILIZADO_ORIGEN_COMPROBANTE','CONTABILIZADO_ORIGEN_DOCUMENTO'].includes(z.estado))r.cxc.ya++;else r.cxc.procesadas++;}catch(e){r.cxc.fallidas++;r.cxc.errores.push(`${x.id}: ${e instanceof Error?e.message:String(e)}`);}}
  const cxpIds=(cxps||[]).map((x:any)=>x.id), cxcIds=(cxc||[]).map((x:any)=>x.id);
  if(cxpIds.length){const {data:pp,error:ep}=await supabase.from('pagos_cuentas_por_pagar').select('id,cuenta_id').in('cuenta_id',cxpIds);if(ep)throw new Error(ep.message);for(const p of pp||[]){try{const ex=await supabase.from('asientos_contables').select('id').eq('emisor_id',emisorId).eq('origen_tipo','PAGO_CXP').eq('origen_id',p.id).maybeSingle();if(ex.data)continue;await contabilizarPagoCxP(p.cuenta_id,p.id,userId);r.pagosCxp.procesadas++;}catch(e){r.pagosCxp.fallidas++;r.pagosCxp.errores.push(`${p.id}: ${e instanceof Error?e.message:String(e)}`);}}}
  if(cxcIds.length){const {data:pc,error:epc}=await supabase.from('pagos_cuentas_por_cobrar').select('id,cuenta_id').in('cuenta_id',cxcIds);if(epc)throw new Error(epc.message);for(const p of pc||[]){try{const ex=await supabase.from('asientos_contables').select('id').eq('emisor_id',emisorId).eq('origen_tipo','PAGO_CXC').eq('origen_id',p.id).maybeSingle();if(ex.data)continue;await contabilizarCobroCxC(p.cuenta_id,p.id,userId);r.cobrosCxc.procesadas++;}catch(e){r.cobrosCxc.fallidas++;r.cobrosCxc.errores.push(`${p.id}: ${e instanceof Error?e.message:String(e)}`);}}}
  const {data:periodos,error:en}=await supabase.from('nomina_periodos').select('id,estado,periodo').eq('emisor_id',emisorId).in('estado',['CALCULADO','CONTABILIZADO']).order('periodo');if(en)throw new Error(en.message);for(const p of periodos||[]){try{const ex=await supabase.from('asientos_contables').select('id').eq('emisor_id',emisorId).eq('origen_tipo','NOMINA_PERIODO').eq('origen_id',p.id).maybeSingle();if(ex.data){r.nomina.ya++;continue;}const z=await contabilizarNominaPeriodo(p.id,userId);if(z.estado==='YA_CONTABILIZADO')r.nomina.ya++;else r.nomina.procesadas++;}catch(e){r.nomina.fallidas++;r.nomina.errores.push(`${p.periodo}: ${e instanceof Error?e.message:String(e)}`);}}
  r.totalFallidas=Object.values(r).filter((x:any)=>x&&typeof x==='object'&&'fallidas' in x).reduce((s:number,x:any)=>s+Number(x.fallidas||0),0); return r;
}

export async function auditarContabilidadEmisor(emisorId:string){
  const out:any={emisorId,ok:true,pendientes:{ventas:0,tickets:0,inventario:0,sri:0,cxp:0,cxc:0,nomina:0},asientosDescuadrados:0,recomendaciones:[]};
  const {data:comps}=await supabase.from('comprobantes').select('id,tipo,estado').eq('emisor_id',emisorId).in('estado',['autorizado','AUTORIZADO','registrado']).limit(10000);for(const c of comps||[]){const t=String(c.tipo||'').toLowerCase();if(!['factura','ticket'].includes(t))continue;const {data:ex}=await supabase.from('asientos_contables').select('id').eq('emisor_id',emisorId).eq('origen_tipo','COMPROBANTE_VENTA').eq('origen_id',c.id).maybeSingle();if(!ex)out.pendientes[t==='ticket'?'tickets':'ventas']++;}
  const {data:movs}=await supabase.from('movimientos_inventario').select('id,tipo,referencia_tipo').eq('emisor_id',emisorId).in('tipo',['entrada','ajuste','salida']).limit(10000);for(const m of movs||[]){if(String(m.tipo).toLowerCase()==='salida'&&String(m.referencia_tipo||'').toLowerCase()==='comprobante')continue;const {data:ex}=await supabase.from('asientos_contables').select('id').eq('emisor_id',emisorId).eq('origen_tipo','MOVIMIENTO_INVENTARIO').eq('origen_id',m.id).maybeSingle();if(!ex)out.pendientes.inventario=(out.pendientes.inventario||0)+1;}
  const {data:docs}=await supabase.from('documentos_sri_borrador').select('id,tipo,estado').eq('emisor_id',emisorId).eq('estado','autorizado').limit(10000);for(const d of docs||[]){if(d.tipo==='guia_remision')continue;const {data:ex}=await supabase.from('asientos_contables').select('id').eq('emisor_id',emisorId).eq('origen_tipo','DOCUMENTO_SRI').eq('origen_id',d.id).maybeSingle();if(!ex)out.pendientes.sri++;}
  const {data:cxps}=await supabase.from('cuentas_por_pagar').select('id,movimiento_inventario_id,documento_sri_id').eq('emisor_id',emisorId).limit(10000);for(const c of cxps||[]){const {data:ex}=await supabase.from('asientos_contables').select('id').eq('emisor_id',emisorId).eq('origen_tipo','CUENTA_POR_PAGAR').eq('origen_id',c.id).maybeSingle();if(ex)continue;let okOrigen=false;if(c.movimiento_inventario_id){const m=await supabase.from('asientos_contables').select('id').eq('emisor_id',emisorId).eq('origen_tipo','MOVIMIENTO_INVENTARIO').eq('origen_id',c.movimiento_inventario_id).maybeSingle();okOrigen=!!m.data;}if(!okOrigen&&c.documento_sri_id){const d=await supabase.from('asientos_contables').select('id').eq('emisor_id',emisorId).eq('origen_tipo','DOCUMENTO_SRI').eq('origen_id',c.documento_sri_id).maybeSingle();okOrigen=!!d.data;}if(!okOrigen)out.pendientes.cxp++;}
  const {data:cxc}=await supabase.from('cuentas_por_cobrar').select('id,comprobante_id').eq('emisor_id',emisorId).limit(10000);for(const c of cxc||[]){if(c.comprobante_id){const {data:v}=await supabase.from('asientos_contables').select('id').eq('emisor_id',emisorId).eq('origen_tipo','COMPROBANTE_VENTA').eq('origen_id',c.comprobante_id).maybeSingle();if(v)continue;}const {data:ex}=await supabase.from('asientos_contables').select('id').eq('emisor_id',emisorId).eq('origen_tipo','CUENTA_POR_COBRAR').eq('origen_id',c.id).maybeSingle();if(!ex)out.pendientes.cxc++;}
  const {data:nom}=await supabase.from('nomina_periodos').select('id,estado').eq('emisor_id',emisorId).eq('estado','CALCULADO').limit(10000);for(const p of nom||[]){const {data:ex}=await supabase.from('asientos_contables').select('id').eq('emisor_id',emisorId).eq('origen_tipo','NOMINA_PERIODO').eq('origen_id',p.id).maybeSingle();if(!ex)out.pendientes.nomina++;}
  const {data:bad}=await supabase.from('asientos_contables').select('id,diferencia,fecha,concepto').eq('emisor_id',emisorId).neq('diferencia',0).limit(1000);out.asientosDescuadrados=(bad||[]).length;const totalPend=Object.values(out.pendientes).reduce((s:number,x:any)=>s+Number(x||0),0);out.ok=totalPend===0&&out.asientosDescuadrados===0;if(out.pendientes.inventario)out.recomendaciones.push('Revisar movimientos de inventario que todavía no tienen asiento contable.');if(out.pendientes.cxp)out.recomendaciones.push('Revisar compras y CxP pendientes de contabilización.');if(out.pendientes.sri)out.recomendaciones.push('Sincronizar documentos SRI autorizados.');if(out.pendientes.nomina)out.recomendaciones.push('Calcular/contabilizar nóminas pendientes.');return out;
}
