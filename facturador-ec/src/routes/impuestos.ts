import type { FastifyInstance } from 'fastify';
import { supabase } from '../db/supabase.js';
import { obtenerSesion } from '../auth/sesiones.js';
import { fechaIsoEcuador } from '../utils/fechaEcuador.js';
import { env } from '../config/env.js';

async function esProveedorAdmin(request: any): Promise<boolean> {
  const token = request.cookies?.sesion;
  if (!token) return false;
  const sesion = await obtenerSesion(token);
  if (!sesion) return false;
  const { data } = await supabase.from('proveedores_admin').select('user_id').eq('user_id', sesion.userId).eq('activo', true).maybeSingle();
  if (data?.user_id) return true;
  const email = await obtenerEmailAuth(sesion.userId);
  const permitidos = (env.proveedorAdminEmails ?? '').split(',').map((x:string)=>x.trim().toLowerCase()).filter(Boolean);
  return !!email && permitidos.includes(email.toLowerCase());
}
async function obtenerEmailAuth(userId: string): Promise<string | null> {
  const url = `${env.supabaseUrl}/auth/v1/admin/users/${userId}`;
  const key = env.supabaseServiceRoleKey;
  const r = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!r.ok) return null;
  const d = await r.json() as { email?: string };
  return d.email ?? null;
}

export async function registrarRutasImpuestos(app: FastifyInstance) {
  app.get('/impuestos/reglas', async (_request, reply) => {
    const { data, error } = await supabase.from('reglas_iva').select('*').order('fecha_inicio', { ascending: false }).order('prioridad', { ascending: true });
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({ hoy: fechaIsoEcuador(), reglas: data ?? [] });
  });

  app.post<{ Body: { clave: string; nombre: string; porcentaje: number; codigoSri: string; tipo: string; fechaInicio: string; fechaFin?: string | null; prioridad?: number; normaReferencia?: string; descripcion?: string } }>('/impuestos/reglas', async (request, reply) => {
    if (!await esProveedorAdmin(request)) return reply.status(403).send({ error: 'Solo el administrador de CONTSERTRIB puede publicar reglas tributarias.' });
    const b = request.body ?? {};
    const tipos = new Set(['GENERAL','FIJA','TURISMO','CERO','EXENTO','NO_OBJETO']);
    if (!b.clave || !b.nombre || !b.fechaInicio || !tipos.has(String(b.tipo))) return reply.status(400).send({ error: 'Completa clave, nombre, tipo y fecha de inicio.' });
    const porcentaje = Number(b.porcentaje);
    if (!Number.isFinite(porcentaje) || porcentaje < 0 || porcentaje > 100) return reply.status(400).send({ error: 'Porcentaje inválido.' });
    if (!/^\d+$/.test(String(b.codigoSri))) return reply.status(400).send({ error: 'El código SRI debe ser numérico.' });
    const { data, error } = await supabase.from('reglas_iva').insert({ clave:String(b.clave).trim(), nombre:String(b.nombre).trim(), porcentaje, codigo_sri:String(b.codigoSri).trim(), tipo:String(b.tipo), fecha_inicio:b.fechaInicio, fecha_fin:b.fechaFin || null, prioridad:Number.isFinite(Number(b.prioridad))?Math.floor(Number(b.prioridad)):100, norma_referencia:b.normaReferencia?.trim()||null, descripcion:b.descripcion?.trim()||null, activo:true }).select('*').single();
    if (error) return reply.status(409).send({ error: error.message });
    return reply.status(201).send(data);
  });

  app.patch<{ Params: { id: string }; Body: { activo?: boolean; fechaFin?: string | null; nombre?: string; descripcion?: string; prioridad?: number } }>('/impuestos/reglas/:id', async (request, reply) => {
    if (!await esProveedorAdmin(request)) return reply.status(403).send({ error: 'Solo el administrador de CONTSERTRIB puede modificar reglas tributarias.' });
    const b = request.body ?? {};
    const cambios: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (b.activo !== undefined) cambios.activo = Boolean(b.activo);
    if (b.fechaFin !== undefined) cambios.fecha_fin = b.fechaFin || null;
    if (b.nombre !== undefined) cambios.nombre = String(b.nombre).trim();
    if (b.descripcion !== undefined) cambios.descripcion = String(b.descripcion).trim() || null;
    if (b.prioridad !== undefined) cambios.prioridad = Math.floor(Number(b.prioridad));
    const { data, error } = await supabase.from('reglas_iva').update(cambios).eq('id', request.params.id).select('*').single();
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(data);
  });
}
