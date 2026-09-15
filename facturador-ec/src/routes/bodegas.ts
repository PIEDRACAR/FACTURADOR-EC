import type { FastifyInstance } from 'fastify';
import { supabase } from '../db/supabase.js';

const clean = (v: unknown) => String(v ?? '').trim();

export async function registrarRutasBodegas(app: FastifyInstance) {
  app.get<{ Querystring: { emisorId?: string } }>('/inventario/bodegas', async (request, reply) => {
    const emisorId = clean(request.query.emisorId);
    if (!emisorId) return reply.status(400).send({ error: 'Falta emisorId.' });
    const { data, error } = await supabase.from('bodegas').select('id,codigo,nombre,direccion,responsable,telefono,activa,es_principal,created_at,updated_at').eq('emisor_id', emisorId).order('es_principal', { ascending: false }).order('nombre');
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({ bodegas: data ?? [] });
  });

  app.post<{ Body: { emisorId?: string; codigo?: string; nombre?: string; direccion?: string; responsable?: string; telefono?: string; esPrincipal?: boolean } }>('/inventario/bodegas', async (request, reply) => {
    const b = request.body ?? {};
    const emisorId = clean(b.emisorId), codigo = clean(b.codigo).toUpperCase(), nombre = clean(b.nombre);
    if (!emisorId || !codigo || !nombre) return reply.status(400).send({ error: 'Emisor, código y nombre son obligatorios.' });
    const { data, error } = await supabase.from('bodegas').insert({ emisor_id: emisorId, codigo, nombre, direccion: clean(b.direccion) || null, responsable: clean(b.responsable) || null, telefono: clean(b.telefono) || null, es_principal: Boolean(b.esPrincipal) }).select().single();
    if (error) return reply.status(400).send({ error: error.message });
    await supabase.from('ubicaciones_bodega').insert({ emisor_id: emisorId, bodega_id: data.id, codigo: 'GENERAL', nombre: 'Ubicación general', tipo: 'ALMACEN' });
    return reply.status(201).send({ bodega: data });
  });

  app.patch<{ Params: { id: string }; Body: { emisorId?: string; nombre?: string; direccion?: string; responsable?: string; telefono?: string; activa?: boolean } }>('/inventario/bodegas/:id', async (request, reply) => {
    const b = request.body ?? {}, emisorId = clean(b.emisorId);
    if (!emisorId) return reply.status(400).send({ error: 'Falta emisorId.' });
    const changes: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const k of ['nombre','direccion','responsable','telefono']) if (k in b) changes[k] = clean((b as any)[k]) || null;
    if (typeof b.activa === 'boolean') changes.activa = b.activa;
    const { data, error } = await supabase.from('bodegas').update(changes).eq('id', request.params.id).eq('emisor_id', emisorId).select().single();
    if (error) return reply.status(400).send({ error: error.message });
    return reply.send({ bodega: data });
  });

  app.get<{ Querystring: { emisorId?: string; bodegaId?: string } }>('/inventario/ubicaciones', async (request, reply) => {
    const emisorId = clean(request.query.emisorId);
    if (!emisorId) return reply.status(400).send({ error: 'Falta emisorId.' });
    let q = supabase.from('ubicaciones_bodega').select('*').eq('emisor_id', emisorId).order('bodega_id').order('codigo');
    if (request.query.bodegaId) q = q.eq('bodega_id', request.query.bodegaId);
    const { data, error } = await q;
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({ ubicaciones: data ?? [] });
  });

  app.post<{ Body: { emisorId?: string; bodegaId?: string; codigo?: string; nombre?: string; tipo?: string } }>('/inventario/ubicaciones', async (request, reply) => {
    const b = request.body ?? {};
    if (!clean(b.emisorId) || !clean(b.bodegaId) || !clean(b.codigo) || !clean(b.nombre)) return reply.status(400).send({ error: 'Emisor, bodega, código y nombre son obligatorios.' });
    const { data, error } = await supabase.from('ubicaciones_bodega').insert({ emisor_id: clean(b.emisorId), bodega_id: clean(b.bodegaId), codigo: clean(b.codigo).toUpperCase(), nombre: clean(b.nombre), tipo: clean(b.tipo) || 'ALMACEN' }).select().single();
    if (error) return reply.status(400).send({ error: error.message });
    return reply.status(201).send({ ubicacion: data });
  });

  app.get<{ Querystring: { emisorId?: string; bodegaId?: string; productoId?: string } }>('/inventario/existencias-bodega', async (request, reply) => {
    const emisorId = clean(request.query.emisorId);
    if (!emisorId) return reply.status(400).send({ error: 'Falta emisorId.' });
    let q = supabase.from('existencias_bodega').select('id,bodega_id,producto_id,stock,stock_reservado,stock_minimo,stock_critico,stock_maximo,costo_promedio,updated_at,productos(codigo_principal,descripcion,unidad_medida)').eq('emisor_id', emisorId).order('updated_at', { ascending: false });
    if (request.query.bodegaId) q = q.eq('bodega_id', request.query.bodegaId);
    if (request.query.productoId) q = q.eq('producto_id', request.query.productoId);
    const { data, error } = await q.limit(10000);
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({ existencias: data ?? [] });
  });

  app.post<{ Body: { emisorId?: string; productoId?: string; bodegaOrigenId?: string; bodegaDestinoId?: string; cantidad?: number; nota?: string } }>('/inventario/bodegas/transferir', async (request, reply) => {
    const b = request.body ?? {};
    if (!clean(b.emisorId) || !clean(b.productoId) || !clean(b.bodegaOrigenId) || !clean(b.bodegaDestinoId) || !b.cantidad || b.cantidad <= 0) return reply.status(400).send({ error: 'Emisor, producto, bodegas y cantidad son obligatorios.' });
    const { data, error } = await supabase.rpc('transferir_inventario_bodega', { p_producto_id: b.productoId, p_bodega_origen_id: b.bodegaOrigenId, p_bodega_destino_id: b.bodegaDestinoId, p_cantidad: b.cantidad, p_nota: b.nota ?? null, p_user_id: (request as any).usuarioSesion?.userId ?? null });
    if (error) return reply.status(400).send({ error: error.message });
    return reply.status(201).send({ resultado: data?.[0] ?? null });
  });

  app.post<{ Body: { emisorId?: string; bodegaId?: string; productoId?: string; cantidad?: number; referenciaTipo?: string; referenciaId?: string } }>('/inventario/reservas', async (request, reply) => {
    const b = request.body ?? {};
    if (!clean(b.emisorId) || !clean(b.bodegaId) || !clean(b.productoId) || !b.cantidad || b.cantidad <= 0) return reply.status(400).send({ error: 'Emisor, bodega, producto y cantidad son obligatorios.' });
    const { data, error } = await supabase.rpc('reservar_inventario_bodega', { p_emisor_id: b.emisorId, p_bodega_id: b.bodegaId, p_producto_id: b.productoId, p_cantidad: b.cantidad, p_referencia_tipo: b.referenciaTipo ?? null, p_referencia_id: b.referenciaId ?? null, p_user_id: (request as any).usuarioSesion?.userId ?? null });
    if (error) return reply.status(409).send({ error: error.message });
    return reply.status(201).send({ reservaId: data });
  });

  app.post<{ Params: { id: string }; Body: { emisorId?: string } }>('/inventario/reservas/:id/liberar', async (request, reply) => {
    const emisorId = clean(request.body?.emisorId);
    if (!emisorId) return reply.status(400).send({ error: 'Falta emisorId.' });
    const { data, error } = await supabase.rpc('liberar_reserva_inventario', { p_reserva_id: request.params.id, p_emisor_id: emisorId });
    if (error) return reply.status(400).send({ error: error.message });
    return reply.send({ ok: Boolean(data) });
  });

  app.get<{ Querystring: { emisorId?: string; estado?: string; bodegaId?: string } }>('/inventario/reservas', async (request, reply) => {
    const emisorId = clean(request.query.emisorId);
    if (!emisorId) return reply.status(400).send({ error: 'Falta emisorId.' });
    let q = supabase.from('reservas_inventario').select('*,productos(codigo_principal,descripcion)').eq('emisor_id', emisorId).order('created_at', { ascending: false });
    if (request.query.estado) q = q.eq('estado', request.query.estado);
    if (request.query.bodegaId) q = q.eq('bodega_id', request.query.bodegaId);
    const { data, error } = await q.limit(5000);
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({ reservas: data ?? [] });
  });
}
