import type { FastifyInstance } from 'fastify';
import { supabase } from '../db/supabase.js';

const TIPOS = new Set(['nota_credito','nota_debito','liquidacion_compra','guia_remision','retencion']);
export async function registrarRutasDocumentos(app: FastifyInstance) {
  app.get<{ Querystring:{emisorId?:string;tipo?:string} }>('/documentos', async (request, reply) => {
    const { emisorId, tipo } = request.query;
    if (!emisorId) return reply.status(400).send({error:'Falta emisorId.'});
    let q=supabase.from('documentos_sri_borrador').select('*').eq('emisor_id',emisorId).order('created_at',{ascending:false}).limit(100);
    if (tipo && TIPOS.has(tipo)) q=q.eq('tipo',tipo);
    const {data,error}=await q;
    if(error) return reply.status(500).send({error:error.message});
    return reply.send(data??[]);
  });
  app.post<{Body:{emisorId?:string;tipo?:string;clienteId?:string;comprobanteSustentoId?:string;datos?:Record<string,unknown>;estado?:string}}>('/documentos', async (request,reply)=>{
    const b=request.body??{};
    if(!b.emisorId||!b.tipo||!TIPOS.has(b.tipo)) return reply.status(400).send({error:'Tipo de comprobante no válido.'});
    const {data,error}=await supabase.from('documentos_sri_borrador').insert({emisor_id:b.emisorId,tipo:b.tipo,cliente_id:b.clienteId||null,comprobante_sustento_id:b.comprobanteSustentoId||null,datos:b.datos??{},estado:b.estado??'borrador'}).select('id').single();
    if(error||!data) return reply.status(500).send({error:error?.message??'No se pudo guardar el documento.'});
    return reply.status(201).send({ok:true,id:data.id,mensaje:'Documento guardado. Completa la información y procede a emitir desde el módulo.'});
  });
  app.patch<{Params:{id:string};Body:{estado?:string;datos?:Record<string,unknown>}}>('/documentos/:id',async(request,reply)=>{
    const cambios:Record<string,unknown>={}; if(request.body?.estado)cambios.estado=request.body.estado; if(request.body?.datos)cambios.datos=request.body.datos;
    const {error}=await supabase.from('documentos_sri_borrador').update(cambios).eq('id',request.params.id); if(error)return reply.status(500).send({error:error.message}); return reply.send({ok:true});
  });
}
