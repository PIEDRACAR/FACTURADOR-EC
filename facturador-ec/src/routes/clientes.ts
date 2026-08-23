import type { FastifyInstance } from 'fastify';
import { supabase } from '../db/supabase.js';

export async function registrarRutasClientes(app: FastifyInstance) {
  app.get<{ Querystring: { emisorId?: string } }>('/clientes', async (request, reply) => {
    const { emisorId } = request.query;
    if (!emisorId) return reply.status(400).send({ error: 'Falta el parámetro emisorId.' });

    const { data, error } = await supabase
      .from('clientes')
      .select('*')
      .eq('emisor_id', emisorId)
      .order('razon_social', { ascending: true });

    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(data);
  });

  app.post<{
    Body: {
      emisorId: string;
      tipoIdentificacion: string;
      identificacion: string;
      razonSocial: string;
      email?: string;
      telefono?: string;
      direccion?: string;
    };
  }>('/clientes', async (request, reply) => {
    const b = request.body;
    if (!b?.emisorId || !b?.tipoIdentificacion || !b?.identificacion || !b?.razonSocial) {
      return reply.status(400).send({ error: 'Faltan campos obligatorios: emisorId, tipoIdentificacion, identificacion, razonSocial.' });
    }

    const { data, error } = await supabase
      .from('clientes')
      .upsert(
        {
          emisor_id: b.emisorId,
          tipo_identificacion: b.tipoIdentificacion,
          identificacion: b.identificacion,
          razon_social: b.razonSocial,
          email: b.email ?? null,
          telefono: b.telefono ?? null,
          direccion: b.direccion ?? null,
        },
        { onConflict: 'emisor_id,tipo_identificacion,identificacion' }
      )
      .select('id')
      .single();

    if (error || !data) {
      return reply.status(500).send({ error: error?.message ?? 'No se pudo guardar el cliente.' });
    }
    return reply.status(201).send({ id: data.id });
  });

  app.patch<{
    Params: { id: string };
    Body: Partial<{ razonSocial: string; email: string; telefono: string; direccion: string }>;
  }>('/clientes/:id', async (request, reply) => {
    const b = request.body ?? {};
    const cambios: Record<string, unknown> = {};
    if (b.razonSocial !== undefined) cambios.razon_social = b.razonSocial;
    if (b.email !== undefined) cambios.email = b.email;
    if (b.telefono !== undefined) cambios.telefono = b.telefono;
    if (b.direccion !== undefined) cambios.direccion = b.direccion;

    if (Object.keys(cambios).length === 0) return reply.status(400).send({ error: 'No se envió ningún campo para actualizar.' });

    const { error } = await supabase.from('clientes').update(cambios).eq('id', request.params.id);
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({ ok: true });
  });
}
