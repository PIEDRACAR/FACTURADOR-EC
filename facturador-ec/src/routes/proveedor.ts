import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { supabase } from '../db/supabase.js';
import { env } from '../config/env.js';
import { obtenerSesion, crearOEncontrarUsuario, agregarUsuarioANegocio } from '../auth/sesiones.js';
import { enviarComprobantePorCorreo } from '../services/email.js';
import { fechaIsoEcuador } from '../utils/fechaEcuador.js';

const COOKIE = 'sesion';
const RUC_REGEX = /^\d{13}$/;
const ESTADOS = ['activa', 'pendiente', 'vencida', 'suspendida', 'cancelada'] as const;
type Estado = typeof ESTADOS[number];

async function obtenerEmailAuth(userId: string): Promise<string | null> {
  const r = await fetch(`${env.supabaseUrl}/auth/v1/admin/users/${userId}`, {
    headers: { apikey: env.supabaseServiceRoleKey, Authorization: `Bearer ${env.supabaseServiceRoleKey}` },
  });
  if (!r.ok) return null;
  const d = await r.json() as { email?: string };
  return d.email ?? null;
}

async function esProveedorAdmin(request: { cookies?: Record<string, string | undefined> }): Promise<{ ok: boolean; userId?: string; email?: string }> {
  const token = request.cookies?.[COOKIE];
  if (!token) return { ok: false };
  const sesion = await obtenerSesion(token);
  if (!sesion) return { ok: false };

  const { data } = await supabase.from('proveedores_admin').select('user_id,activo').eq('user_id', sesion.userId).eq('activo', true).maybeSingle();
  if (data?.user_id) return { ok: true, userId: sesion.userId, email: await obtenerEmailAuth(sesion.userId) ?? undefined };

  const email = await obtenerEmailAuth(sesion.userId);
  const permitidos = (env.proveedorAdminEmails ?? '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
  if (email && permitidos.includes(email.toLowerCase())) return { ok: true, userId: sesion.userId, email };
  return { ok: false, userId: sesion.userId, email: email ?? undefined };
}

async function exigirProveedor(request: any, reply: any) {
  const auth = await esProveedorAdmin(request);
  if (!auth.ok) {
    await reply.status(403).send({ ok: false, error: 'Acceso restringido al administrador de CONTSERTRIB.' });
    return null;
  }
  return auth;
}

function fechaMasDias(dias: number): string {
  const [y, m, d] = fechaIsoEcuador().split('-').map(Number);
  const fecha = new Date(Date.UTC(y, m - 1, d + dias, 12, 0, 0));
  return fecha.toISOString().slice(0, 10);
}

function hoyEcuadorIso(): string {
  return fechaIsoEcuador();
}

function generarPasswordTemporal(): string {
  return `Ct${randomBytes(6).toString('base64url')}!`;
}

export async function registrarRutasProveedor(app: FastifyInstance) {
  app.get('/proveedor/resumen', async (request, reply) => {
    if (!await exigirProveedor(request, reply)) return;
    const [{ count: empresas }, { count: activas }, { count: vencidas }, { data: ingresos }] = await Promise.all([
      supabase.from('emisores').select('id', { count: 'exact', head: true }),
      supabase.from('suscripciones').select('id', { count: 'exact', head: true }).eq('estado', 'activa'),
      supabase.from('suscripciones').select('id', { count: 'exact', head: true }).in('estado', ['vencida', 'suspendida']),
      supabase.from('pagos_suscripcion').select('monto').gte('fecha_pago', new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10)),
    ]);
    const ingresosMes = (ingresos ?? []).reduce((s, x) => s + Number(x.monto || 0), 0);
    return reply.send({ empresas: empresas ?? 0, activas: activas ?? 0, vencidas: vencidas ?? 0, ingresosMes });
  });

  app.get('/proveedor/planes', async (request, reply) => {
    if (!await exigirProveedor(request, reply)) return;
    const { data, error } = await supabase.from('planes_suscripcion').select('*').order('orden');
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(data ?? []);
  });

  app.patch<{ Params: { id: string }; Body: { nombre?: string; descripcion?: string; precioMensual?: number; activo?: boolean } }>('/proveedor/planes/:id', async (request, reply) => {
    if (!await exigirProveedor(request, reply)) return;
    const b = request.body ?? {};
    const cambios: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (b.nombre !== undefined) cambios.nombre = String(b.nombre).trim();
    if (b.descripcion !== undefined) cambios.descripcion = String(b.descripcion).trim() || null;
    if (b.precioMensual !== undefined) {
      const precio = Number(b.precioMensual);
      if (!Number.isFinite(precio) || precio < 0) return reply.status(400).send({ error: 'El precio mensual no es válido.' });
      cambios.precio_mensual = precio;
    }
    if (b.activo !== undefined) cambios.activo = Boolean(b.activo);
    const { data, error } = await supabase.from('planes_suscripcion').update(cambios).eq('id', request.params.id).select('*').single();
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(data);
  });

  app.get('/proveedor/clientes', async (request, reply) => {
    if (!await exigirProveedor(request, reply)) return;
    const { data: emisores, error } = await supabase.from('emisores').select('id,ruc,razon_social,nombre_comercial,direccion_matriz,ambiente,created_at').order('created_at', { ascending: false });
    if (error) return reply.status(500).send({ error: error.message });
    const ids = (emisores ?? []).map(x => x.id);
    const { data: subs } = ids.length ? await supabase.from('suscripciones').select('id,emisor_id,estado,fecha_inicio,proximo_vencimiento,plan_id,planes_suscripcion(codigo,nombre,precio_mensual)').in('emisor_id', ids) : { data: [] as any[] };
    const { data: certs } = ids.length ? await supabase.from('certificados').select('emisor_id,fecha_expiracion').in('emisor_id', ids).eq('alias','PRINCIPAL') : { data: [] as any[] };
    const subMap = new Map((subs ?? []).map(x => [x.emisor_id, x]));
    const certMap = new Map((certs ?? []).map(x => [x.emisor_id, x]));
    return reply.send((emisores ?? []).map(e => ({ ...e, suscripcion: subMap.get(e.id) ?? null, certificado: certMap.get(e.id) ?? null, configuracionPendiente: !certMap.has(e.id) })));
  });

  app.post<{ Body: { ruc?: string; razonSocial?: string; nombreComercial?: string; direccionMatriz?: string; emailAdmin?: string; passwordTemporal?: string; planCodigo?: string; ambiente?: 'pruebas'|'produccion'; diasIniciales?: number } }>('/proveedor/clientes', async (request, reply) => {
    if (!await exigirProveedor(request, reply)) return;
    const b = request.body ?? {};
    const ruc = String(b.ruc ?? '').trim();
    const razonSocial = String(b.razonSocial ?? '').trim();
    const direccion = String(b.direccionMatriz ?? '').trim();
    const email = String(b.emailAdmin ?? '').trim().toLowerCase();
    if (!RUC_REGEX.test(ruc)) return reply.status(400).send({ error: 'El RUC debe tener 13 dígitos.' });
    if (!razonSocial || !direccion || !email) return reply.status(400).send({ error: 'RUC, razón social, dirección y correo son obligatorios.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply.status(400).send({ error: 'El correo del administrador no es válido.' });

    const { data: existente } = await supabase.from('emisores').select('id').eq('ruc', ruc).maybeSingle();
    if (existente) return reply.status(409).send({ error: 'Ese RUC ya está registrado en CONTSERTRIB.', emisorId: existente.id });

    const ambiente = b.ambiente === 'pruebas' ? 'pruebas' : 'produccion';
    const planCode = String(b.planCodigo ?? 'BASICO').toUpperCase();
    const { data: plan } = await supabase.from('planes_suscripcion').select('id,codigo,nombre,precio_mensual').eq('codigo', planCode).eq('activo', true).maybeSingle();
    if (!plan) return reply.status(400).send({ error: `El plan ${planCode} no existe o está inactivo.` });
    const { data: emisor, error: eError } = await supabase.from('emisores').insert({ ruc, razon_social: razonSocial, nombre_comercial: String(b.nombreComercial ?? '').trim() || null, direccion_matriz: direccion, obligado_contabilidad: false, ambiente }).select('id').single();
    if (eError || !emisor) return reply.status(500).send({ error: 'No se pudo crear la empresa.', detalle: eError?.message });

    const { data: punto, error: pError } = await supabase.from('puntos_emision').insert({ emisor_id: emisor.id, establecimiento: '001', punto_emision: '001', direccion, activo: true }).select('id').single();
    if (pError || !punto) return reply.status(500).send({ error: 'La empresa se creó pero no se pudo crear el punto de emisión.', emisorId: emisor.id, detalle: pError?.message });

    const { error: estError } = await supabase.from('establecimientos_emisor').upsert({ emisor_id: emisor.id, codigo: '001', nombre_comercial: String(b.nombreComercial ?? '').trim() || null, direccion, activo: true }, { onConflict: 'emisor_id,codigo' });
    if (estError) request.log.warn({ err: estError }, 'No se pudo crear el establecimiento extendido');

    const password = String(b.passwordTemporal ?? '').trim() || generarPasswordTemporal();
    if (password.length < 8) return reply.status(400).send({ error: 'La contraseña temporal debe tener al menos 8 caracteres.' });
    let userId: string;
    try {
      userId = await crearOEncontrarUsuario(email, password);
      await agregarUsuarioANegocio(userId, emisor.id, 'admin');
    } catch (err) {
      return reply.status(500).send({ error: 'La empresa fue creada, pero no se pudo crear el usuario administrador.', emisorId: emisor.id, detalle: err instanceof Error ? err.message : String(err) });
    }

    const dias = Math.max(1, Math.min(365, Number(b.diasIniciales ?? 30)));
    const inicio = hoyEcuadorIso();
    const vencimiento = fechaMasDias(dias);
    const { data: sub, error: sError } = await supabase.from('suscripciones').insert({ emisor_id: emisor.id, plan_id: plan.id, estado: 'activa', fecha_inicio: inicio, proximo_vencimiento: vencimiento }).select('*').single();
    if (sError || !sub) return reply.status(500).send({ error: 'La empresa y usuario quedaron creados, pero falló la suscripción.', emisorId: emisor.id, detalle: sError?.message });

    let correoEnviado = false;
    let correoError: string | null = null;
    try {
      await enviarComprobantePorCorreo({ to: email, subject: 'Acceso a CONTSERTRIB', html: `<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto"><h2>Bienvenido a CONTSERTRIB</h2><p>Su empresa <strong>${razonSocial.replace(/[<>]/g,'')}</strong> fue registrada.</p><p><strong>Acceso:</strong> <a href="${env.appUrl}/login">${env.appUrl}/login</a></p><p><strong>Usuario:</strong> ${email}</p><p><strong>Contraseña temporal:</strong> ${password}</p><p>Por seguridad, cambie esta contraseña después de ingresar.</p><p>Plan: ${plan.nombre}</p><p>Vigencia inicial: ${dias} días.</p></div>` });
      correoEnviado = true;
    } catch (err) { correoError = err instanceof Error ? err.message : String(err); }

    return reply.status(201).send({ ok: true, emisorId: emisor.id, puntoEmisionId: punto.id, userId, plan: { codigo: plan.codigo, nombre: plan.nombre, precioMensual: plan.precio_mensual }, fechaInicio: inicio, proximoVencimiento: vencimiento, correoEnviado, correoError, acceso: { url: `${env.appUrl}/login`, email, passwordTemporal: password } });
  });

  app.patch<{ Params: { emisorId: string }; Body: { estado?: Estado; dias?: number; nota?: string } }>('/proveedor/clientes/:emisorId/suscripcion', async (request, reply) => {
    if (!await exigirProveedor(request, reply)) return;
    const b = request.body ?? {};
    if (b.estado && !ESTADOS.includes(b.estado)) return reply.status(400).send({ error: 'Estado de suscripción no válido.' });
    const cambios: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (b.estado) cambios.estado = b.estado;
    if (b.nota !== undefined) cambios.nota = String(b.nota).trim() || null;
    if (b.dias !== undefined) cambios.proximo_vencimiento = fechaMasDias(Math.max(0, Math.min(3650, Number(b.dias))));
    const { data, error } = await supabase.from('suscripciones').update(cambios).eq('emisor_id', request.params.emisorId).select('*').single();
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(data);
  });

  app.post<{ Params: { emisorId: string }; Body: { monto?: number; metodo?: string; referencia?: string; dias?: number; nota?: string } }>('/proveedor/clientes/:emisorId/pago', async (request, reply) => {
    if (!await exigirProveedor(request, reply)) return;
    const b = request.body ?? {};
    const monto = Number(b.monto);
    if (!Number.isFinite(monto) || monto <= 0) return reply.status(400).send({ error: 'El monto debe ser mayor que cero.' });
    const { data: sub } = await supabase.from('suscripciones').select('id,proximo_vencimiento').eq('emisor_id', request.params.emisorId).maybeSingle();
    if (!sub) return reply.status(404).send({ error: 'El cliente no tiene una suscripción.' });
    const dias = Math.max(1, Math.min(3650, Number(b.dias ?? 30)));
    const desde = sub.proximo_vencimiento && sub.proximo_vencimiento >= hoyEcuadorIso() ? sub.proximo_vencimiento : hoyEcuadorIso();
    const hastaDate = new Date(`${desde}T12:00:00`); hastaDate.setDate(hastaDate.getDate() + dias);
    const hasta = hastaDate.toISOString().slice(0,10);
    const { data: pago, error } = await supabase.from('pagos_suscripcion').insert({ suscripcion_id: sub.id, emisor_id: request.params.emisorId, monto, fecha_pago: hoyEcuadorIso(), periodo_desde: desde, periodo_hasta: hasta, metodo: String(b.metodo ?? 'efectivo'), referencia: String(b.referencia ?? '').trim() || null, nota: String(b.nota ?? '').trim() || null }).select('*').single();
    if (error) return reply.status(500).send({ error: error.message });
    const { data: actualizada, error: uError } = await supabase.from('suscripciones').update({ estado: 'activa', proximo_vencimiento: hasta, updated_at: new Date().toISOString() }).eq('id', sub.id).select('*').single();
    if (uError) return reply.status(500).send({ error: uError.message });
    return reply.send({ ok: true, pago, suscripcion: actualizada });
  });

  app.post<{ Params: { emisorId: string } }>('/proveedor/clientes/:emisorId/reenvio-acceso', async (request, reply) => {
    if (!await exigirProveedor(request, reply)) return;
    const { data: emisor } = await supabase.from('emisores').select('razon_social').eq('id', request.params.emisorId).single();
    const { data: rel } = await supabase.from('usuarios_emisor').select('user_id').eq('emisor_id', request.params.emisorId).eq('rol','admin').limit(1).maybeSingle();
    if (!emisor || !rel) return reply.status(404).send({ error: 'No se encontró el administrador del cliente.' });
    const email = await obtenerEmailAuth(rel.user_id);
    if (!email) return reply.status(404).send({ error: 'No se pudo obtener el correo del administrador.' });
    const password = generarPasswordTemporal();
    const reset = await fetch(`${env.supabaseUrl}/auth/v1/admin/users/${rel.user_id}`, { method:'PUT', headers:{'Content-Type':'application/json',apikey:env.supabaseServiceRoleKey,Authorization:`Bearer ${env.supabaseServiceRoleKey}`}, body:JSON.stringify({ password }) });
    if (!reset.ok) return reply.status(500).send({ error:'No se pudo regenerar la contraseña.' });
    let correoEnviado=false;
    try { await enviarComprobantePorCorreo({to:email,subject:'Nuevo acceso a CONTSERTRIB',html:`<div style="font-family:Arial"><h2>Nuevo acceso</h2><p>${emisor.razon_social}</p><p>Usuario: <strong>${email}</strong></p><p>Contraseña temporal: <strong>${password}</strong></p><p><a href="${env.appUrl}/login">Ingresar a CONTSERTRIB</a></p></div>`}); correoEnviado=true; } catch {}
    return reply.send({ ok:true, correo, correoEnviado });
  });
}
