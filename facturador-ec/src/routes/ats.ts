import type { FastifyInstance } from 'fastify';
import { supabase } from '../db/supabase.js';
import { generarAts } from '../services/ats.js';
import { comprobarCaracteristica } from '../services/saas.js';

function validarRuc(ruc: string) { return /^\d{13}$/.test(ruc) && ruc.endsWith('001'); }

export async function registrarRutasAts(app: FastifyInstance) {
  app.get<{ Querystring: { emisorId?: string; anio?: string; mes?: string } }>('/ats/resumen', async (request, reply) => {
    const emisorId = request.query.emisorId;
    if (!emisorId) return reply.status(400).send({ error: 'Falta emisorId.' });
    const feature = await comprobarCaracteristica(emisorId, 'ats');
    if (!feature.ok) return reply.status(402).send({ error: feature.mensaje, plan: feature.plan?.nombre });
    const anio = Number(request.query.anio);
    const mes = Number(request.query.mes);
    if (!Number.isInteger(anio) || !Number.isInteger(mes)) return reply.status(400).send({ error: 'Indica año y mes.' });
    const [emisor, ests, compras, retenciones, generacion] = await Promise.all([
      supabase.from('emisores').select('ruc,razon_social').eq('id',emisorId).single(),
      supabase.from('establecimientos_emisor').select('id,codigo,nombre_comercial,direccion').eq('emisor_id',emisorId).eq('activo',true).order('codigo'),
      supabase.from('ats_compras').select('id,id_prov,razon_social_prov,tipo_comprobante,secuencial,fecha_emision,base_iva_0,base_iva_diferente_0,monto_iva,valor_ret_renta').eq('emisor_id',emisorId).gte('fecha_emision',`${anio}-${String(mes).padStart(2,'0')}-01`).lt('fecha_emision',`${mes===12?anio+1:anio}-${String(mes===12?1:mes+1).padStart(2,'0')}-01`).order('fecha_emision'),
      supabase.from('ats_retenciones').select('id,id_sujeto,secuencial,fecha_emision,valor_ret_iva,valor_ret_renta').eq('emisor_id',emisorId).gte('fecha_emision',`${anio}-${String(mes).padStart(2,'0')}-01`).lt('fecha_emision',`${mes===12?anio+1:anio}-${String(mes===12?1:mes+1).padStart(2,'0')}-01`).order('fecha_emision'),
      supabase.from('ats_generaciones').select('id,estado,total_ventas,total_compras,advertencias,created_at').eq('emisor_id',emisorId).eq('anio',anio).eq('mes',mes).maybeSingle(),
    ]);
    return reply.send({ emisor: emisor.data, establecimientos: ests.data ?? [], compras: compras.data ?? [], retenciones: retenciones.data ?? [], generacion: generacion.data ?? null });
  });

  app.post<{ Body: { emisorId?: string; codSustento?: string; tipoIdProv?: string; idProv?: string; razonSocialProv?: string; tipoComprobante?: string; parteRel?: string; establecimiento?: string; puntoEmision?: string; secuencial?: string; autorizacion?: string; fechaEmision?: string; baseNoObjeto?: number; baseIva0?: number; baseIvaDiferente0?: number; baseExenta?: number; montoIva?: number; montoIce?: number; valorRetIva?: number; valorRetRenta?: number; formaPago?: string } }>('/ats/compras', async (request, reply) => {
    const b = request.body ?? {};
    if (!b.emisorId || !b.idProv || !b.secuencial || !b.fechaEmision) return reply.status(400).send({ error: 'Emisor, proveedor, secuencial y fecha son obligatorios.' });
    const feature = await comprobarCaracteristica(b.emisorId, 'ats');
    if (!feature.ok) return reply.status(402).send({ error: feature.mensaje });
    const idProv = String(b.idProv).trim();
    if (idProv.length < 3 || idProv.length > 13) return reply.status(400).send({ error: 'La identificación del proveedor debe tener entre 3 y 13 caracteres.' });
    const bases = Number(b.baseNoObjeto||0)+Number(b.baseIva0||0)+Number(b.baseIvaDiferente0||0)+Number(b.baseExenta||0);
    if (bases <= 0) return reply.status(400).send({ error: 'Debe existir al menos una base imponible mayor a cero.' });
    const { data, error } = await supabase.from('ats_compras').insert({ emisor_id:b.emisorId,cod_sustento:String(b.codSustento||'01'),tipo_id_prov:String(b.tipoIdProv|| (idProv.length===13?'04':'05')),id_prov:idProv,razon_social_prov:String(b.razonSocialProv||'').trim()||null,tipo_comprobante:String(b.tipoComprobante||'01'),parte_rel:String(b.parteRel||'NO'),establecimiento:String(b.establecimiento||'001'),punto_emision:String(b.puntoEmision||'001'),secuencial:String(b.secuencial),autorizacion:String(b.autorizacion||'').trim()||null,fecha_emision:String(b.fechaEmision),base_no_objeto:Number(b.baseNoObjeto||0),base_iva_0:Number(b.baseIva0||0),base_iva_diferente_0:Number(b.baseIvaDiferente0||0),base_exenta:Number(b.baseExenta||0),monto_iva:Number(b.montoIva||0),monto_ice:Number(b.montoIce||0),valor_ret_iva:Number(b.valorRetIva||0),valor_ret_renta:Number(b.valorRetRenta||0),forma_pago:String(b.formaPago||'').trim()||null});
    if (error) return reply.status(500).send({ error: error.message });
    return reply.status(201).send(data);
  });

  app.delete<{ Params: { id: string } }>('/ats/compras/:id', async (request, reply) => {
    const { error } = await supabase.from('ats_compras').delete().eq('id',request.params.id);
    if (error) return reply.status(500).send({ error:error.message });
    return reply.send({ ok:true });
  });

  app.post<{ Body: { emisorId?: string; anio?: number; mes?: number } }>('/ats/generar', async (request, reply) => {
    const { emisorId, anio, mes } = request.body ?? {};
    if (!emisorId || !anio || !mes) return reply.status(400).send({ error:'Emisor, año y mes son obligatorios.' });
    try { return reply.send(await generarAts(emisorId, Number(anio), Number(mes))); }
    catch (e) { return reply.status(400).send({ error:e instanceof Error?e.message:String(e) }); }
  });

  app.get<{ Params: { id: string } }>('/ats/generaciones/:id/xml', async (request, reply) => {
    const { data, error } = await supabase.from('ats_generaciones').select('xml,emisor_id,anio,mes').eq('id',request.params.id).single();
    if (error || !data) return reply.status(404).send({ error:'Generación ATS no encontrada.' });
    const { data: emisor } = await supabase.from('emisores').select('ruc').eq('id',data.emisor_id).single();
    const nombre = `ATS_${emisor?.ruc||'CONTSERTRIB'}_${data.anio}_${String(data.mes).padStart(2,'0')}.xml`;
    return reply.header('Content-Disposition',`attachment; filename="${nombre}"`).type('application/xml; charset=utf-8').send(data.xml);
  });
}
