import type { FastifyInstance } from 'fastify';
import { supabase } from '../db/supabase.js';
import { contabilizarCxP, contabilizarPagoCxP, contabilizarCxC, contabilizarCobroCxC } from '../services/motorContable.js';

export async function registrarRutasCuentas(app: FastifyInstance) {
  app.get<{Querystring:{emisorId?:string;estado?:string}}>('/cuentas-por-pagar/listado', async (request,reply)=>{
    const {emisorId,estado}=request.query;if(!emisorId)return reply.status(400).send({error:'Falta el parámetro emisorId.'});
    let q=supabase.from('cuentas_por_pagar').select('*, proveedores(razon_social)').eq('emisor_id',emisorId).order('fecha_vencimiento',{ascending:true});if(estado)q=q.eq('estado',estado);const {data,error}=await q;if(error)return reply.status(500).send({error:error.message});return reply.send(data||[]);
  });
  app.post<{Body:{emisorId:string;proveedorId:string;numeroDocumento?:string;concepto:string;fechaVencimiento:string;montoTotal:number}}>('/cuentas-por-pagar',async(request,reply)=>{
    const b=request.body;if(!b?.emisorId||!b?.proveedorId||!b?.concepto||!b?.fechaVencimiento||!b?.montoTotal)return reply.status(400).send({error:'Faltan campos obligatorios.'});if(b.montoTotal<=0)return reply.status(400).send({error:'El monto debe ser mayor a 0.'});
    const {data,error}=await supabase.from('cuentas_por_pagar').insert({emisor_id:b.emisorId,proveedor_id:b.proveedorId,numero_documento:b.numeroDocumento??null,concepto:b.concepto,fecha_vencimiento:b.fechaVencimiento,monto_total:b.montoTotal}).select('id').single();
    if(error||!data)return reply.status(500).send({error:error?.message??'No se pudo crear la cuenta.'});try{await contabilizarCxP(data.id,request.usuarioSesion?.userId);return reply.status(201).send({id:data.id,contabilidad:'contabilizado'});}catch(e){return reply.status(201).send({id:data.id,contabilidad:'pendiente',advertencia:e instanceof Error?e.message:String(e)});}
  });
  app.post<{Params:{id:string};Body:{monto:number;formaPagoCodigo?:string;nota?:string}}>('/cuentas-por-pagar/:id/pagos',async(request,reply)=>{
    const {monto,formaPagoCodigo,nota}=request.body??{};if(!monto||monto<=0)return reply.status(400).send({error:'Indica un monto de pago válido.'});
    const {data,error}=await supabase.rpc('registrar_pago_cuenta_por_pagar',{p_cuenta_id:request.params.id,p_monto:monto,p_forma_pago_codigo:formaPagoCodigo??'20',p_nota:nota??null});if(error||!data?.[0])return reply.status(500).send({error:error?.message??'No se pudo registrar el pago.'});
    const {data:pago}=await supabase.from('pagos_cuentas_por_pagar').select('id').eq('cuenta_id',request.params.id).order('created_at',{ascending:false}).limit(1).maybeSingle();let contabilidad='contabilizado',advertencia='';if(pago){try{await contabilizarPagoCxP(request.params.id,pago.id,request.usuarioSesion?.userId);}catch(e){contabilidad='pendiente';advertencia=e instanceof Error?e.message:String(e);}}
    return reply.status(201).send({montoPagado:data[0].monto_pagado_resultante,saldo:data[0].saldo_resultante,estado:data[0].estado_resultante,contabilidad,advertencia});
  });

  app.get<{Querystring:{emisorId?:string;estado?:string}}>('/cuentas-por-cobrar/listado',async(request,reply)=>{
    const {emisorId,estado}=request.query;if(!emisorId)return reply.status(400).send({error:'Falta el parámetro emisorId.'});let q=supabase.from('cuentas_por_cobrar').select('*, clientes(razon_social)').eq('emisor_id',emisorId).order('fecha_vencimiento',{ascending:true});if(estado)q=q.eq('estado',estado);const {data,error}=await q;if(error)return reply.status(500).send({error:error.message});return reply.send(data||[]);
  });
  app.post<{Body:{emisorId:string;clienteId:string;comprobanteId?:string;concepto:string;fechaVencimiento:string;montoTotal:number}}>('/cuentas-por-cobrar',async(request,reply)=>{
    const b=request.body;if(!b?.emisorId||!b?.clienteId||!b?.concepto||!b?.fechaVencimiento||!b?.montoTotal)return reply.status(400).send({error:'Faltan campos obligatorios.'});if(b.montoTotal<=0)return reply.status(400).send({error:'El monto debe ser mayor a 0.'});
    const {data,error}=await supabase.from('cuentas_por_cobrar').insert({emisor_id:b.emisorId,cliente_id:b.clienteId,comprobante_id:b.comprobanteId??null,concepto:b.concepto,fecha_vencimiento:b.fechaVencimiento,monto_total:b.montoTotal}).select('id').single();if(error||!data)return reply.status(500).send({error:error?.message??'No se pudo crear la cuenta.'});try{await contabilizarCxC(data.id,request.usuarioSesion?.userId);return reply.status(201).send({id:data.id,contabilidad:'contabilizado'});}catch(e){return reply.status(201).send({id:data.id,contabilidad:'pendiente',advertencia:e instanceof Error?e.message:String(e)});
  }});
  app.post<{Params:{id:string};Body:{monto:number;formaPagoCodigo?:string;nota?:string}}>('/cuentas-por-cobrar/:id/pagos',async(request,reply)=>{
    const {monto,formaPagoCodigo,nota}=request.body??{};if(!monto||monto<=0)return reply.status(400).send({error:'Indica un monto de cobro válido.'});const {data,error}=await supabase.rpc('registrar_pago_cuenta_por_cobrar',{p_cuenta_id:request.params.id,p_monto:monto,p_forma_pago_codigo:formaPagoCodigo??'01',p_nota:nota??null});if(error||!data?.[0])return reply.status(500).send({error:error?.message??'No se pudo registrar el cobro.'});
    const {data:pago}=await supabase.from('pagos_cuentas_por_cobrar').select('id').eq('cuenta_id',request.params.id).order('created_at',{ascending:false}).limit(1).maybeSingle();let contabilidad='contabilizado',advertencia='';if(pago){try{await contabilizarCobroCxC(request.params.id,pago.id,request.usuarioSesion?.userId);}catch(e){contabilidad='pendiente';advertencia=e instanceof Error?e.message:String(e);}}return reply.status(201).send({montoCobrado:data[0].monto_cobrado_resultante,saldo:data[0].saldo_resultante,estado:data[0].estado_resultante,contabilidad,advertencia});
  });
}
