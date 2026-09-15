import type { FastifyInstance } from 'fastify';
import { supabase } from '../db/supabase.js';

export async function registrarRutasCaja(app: FastifyInstance) {
  app.get<{ Querystring: { emisorId?: string } }>('/caja/actual', async (req, reply) => {
    const { emisorId } = req.query; if (!emisorId) return reply.status(400).send({ error: 'Falta emisorId.' });
    const { data: caja, error } = await supabase.from('cajas').select('*').eq('emisor_id', emisorId).eq('estado','abierta').maybeSingle();
    if (error) return reply.status(500).send({ error: error.message });
    if (!caja) return reply.send({ abierta: false });
    const { data: pagos } = await supabase.from('comprobantes').select('id, importe_total, created_at, comprobante_formas_pago(forma_pago_codigo,valor)').eq('emisor_id',emisorId).eq('estado','autorizado').gte('created_at',caja.fecha_apertura);
    const { data: movs } = await supabase.from('movimientos_caja').select('*').eq('caja_id',caja.id).order('created_at',{ascending:false});
    let ingresos=0, efectivo=Number(caja.monto_inicial), tarjetas=0, transferencias=0;
    for (const c of pagos ?? []) for (const p of (c as any).comprobante_formas_pago ?? []) { const v=Number(p.valor); ingresos+=v; if(p.forma_pago_codigo==='01') efectivo+=v; else if(['19','20','21','22','23'].includes(p.forma_pago_codigo)) transferencias+=v; else tarjetas+=v; }
    for (const m of movs ?? []) { const v=Number(m.monto); if(m.forma_pago==='01') efectivo += m.tipo==='ingreso'?v:-v; }
    const totalIngresos = ingresos + (movs??[]).filter(m=>m.tipo==='ingreso').reduce((a,m)=>a+Number(m.monto),0);
    const totalEgresos = (movs??[]).filter(m=>m.tipo==='egreso').reduce((a,m)=>a+Number(m.monto),0);
    return reply.send({ abierta:true, caja, ingresos:totalIngresos, egresos:totalEgresos, efectivoEsperado:Math.round(efectivo*100)/100, totalTarjetas:tarjetas, totalTransferencias:transferencias, movimientos:movs??[] });
  });

  app.post<{ Body:{ emisorId:string; montoInicial?:number; nota?:string } }>('/caja/abrir', async (req,reply)=>{
    const b=req.body; if(!b?.emisorId) return reply.status(400).send({error:'Falta emisorId.'});
    const {data: abierta}=await supabase.from('cajas').select('id').eq('emisor_id',b.emisorId).eq('estado','abierta').maybeSingle();
    if(abierta) return reply.status(409).send({error:'Ya existe una caja abierta para este negocio.'});
    const {data,error}=await supabase.from('cajas').insert({emisor_id:b.emisorId,monto_inicial:b.montoInicial??0,nota:b.nota??null}).select('*').single();
    if(error) return reply.status(500).send({error:error.message}); return reply.status(201).send(data);
  });

  app.post<{ Body:{ cajaId:string; tipo:'ingreso'|'egreso'; concepto:string; monto:number; formaPago?:string } }>('/caja/movimiento', async(req,reply)=>{
    const b=req.body; if(!b?.cajaId||!b.concepto||!b.monto||b.monto<=0) return reply.status(400).send({error:'Caja, concepto y monto válido son obligatorios.'});
    const {data:caja}=await supabase.from('cajas').select('id').eq('id',b.cajaId).eq('estado','abierta').maybeSingle(); if(!caja)return reply.status(409).send({error:'La caja no está abierta.'});
    const {data,error}=await supabase.from('movimientos_caja').insert({caja_id:b.cajaId,tipo:b.tipo,concepto:b.concepto,monto:b.monto,forma_pago:b.formaPago??'01'}).select('*').single();
    if(error)return reply.status(500).send({error:error.message}); return reply.status(201).send(data);
  });

  app.post<{ Body:{ cajaId:string; efectivoDeclarado:number } }>('/caja/cerrar', async(req,reply)=>{
    const b=req.body; if(!b?.cajaId || b.efectivoDeclarado===undefined)return reply.status(400).send({error:'Caja y efectivo declarado son obligatorios.'});
    const {data,error}=await supabase.rpc('cerrar_caja',{p_caja_id:b.cajaId,p_efectivo_declarado:b.efectivoDeclarado});
    if(error)return reply.status(500).send({error:error.message}); return reply.send(data?.[0]??{});
  });

  app.get<{Querystring:{emisorId?:string}}>('/caja/historial',async(req,reply)=>{ if(!req.query.emisorId)return reply.status(400).send({error:'Falta emisorId.'}); const {data,error}=await supabase.from('cajas').select('*').eq('emisor_id',req.query.emisorId).order('fecha_apertura',{ascending:false}).limit(100); if(error)return reply.status(500).send({error:error.message}); return reply.send(data); });
}
