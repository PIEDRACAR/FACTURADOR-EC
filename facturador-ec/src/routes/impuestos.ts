import type { FastifyInstance } from 'fastify';
import { supabase } from '../db/supabase.js';

export async function registrarRutasImpuestos(app: FastifyInstance) {
  app.get<{ Querystring: { emisorId?: string } }>('/impuestos/configuracion', async (request, reply) => {
    const emisorId = String(request.query.emisorId ?? '').trim();
    if (!emisorId) return reply.status(400).send({ error: 'Falta emisorId.' });
    const { data, error } = await supabase
      .from('configuracion_iva')
      .select('emisor_id,tarifa_general,codigo_general,tarifa_reducida,codigo_reducida,tarifa_turismo,codigo_turismo,activo,updated_at')
      .eq('emisor_id', emisorId)
      .maybeSingle();
    if (error) return reply.status(500).send({ error: error.message });
    if (data) return reply.send(data);
    return reply.send({ emisor_id: emisorId, tarifa_general: 15, codigo_general: '4', tarifa_reducida: 5, codigo_reducida: '5', tarifa_turismo: 8, codigo_turismo: '8', activo: true });
  });
}
