import type { FastifyInstance } from 'fastify';
import {
  verificarCredenciales,
  crearSesion,
  cerrarSesion,
  obtenerSesion,
  obtenerNegociosDeUsuario,
  agregarUsuarioANegocio,
  crearOEncontrarUsuario,
  obtenerUsuarioAuthPorEmail,
  DURACION_SESION_DIAS,
} from '../auth/sesiones.js';
import { supabase } from '../db/supabase.js';
import { env } from '../config/env.js';
import { CATALOGO_PERMISOS, PERMISOS_POR_ROL, obtenerPermisosUsuario, guardarPermisosUsuario } from '../auth/permisos.js';

const NOMBRE_COOKIE = 'sesion';
const COOKIE_OPTS = { path: '/', httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, maxAge: 60 * 60 * 24 * DURACION_SESION_DIAS };
const VENTANA_LOGIN_MS = 15 * 60 * 1000;
const MAX_INTENTOS_LOGIN = 8;
const intentosLogin = new Map<string, { inicio: number; fallos: number }>();

export function claveLimiteLogin(ip: string, email: string, root = false): string {
  return `${root ? 'root' : 'usuario'}:${ip}:${email.trim().toLowerCase()}`;
}
export function comprobarLimiteLogin(clave: string, ahora = Date.now()): number {
  const estado = intentosLogin.get(clave);
  if (!estado || ahora - estado.inicio >= VENTANA_LOGIN_MS) { intentosLogin.delete(clave); return 0; }
  return estado.fallos >= MAX_INTENTOS_LOGIN ? Math.ceil((VENTANA_LOGIN_MS - (ahora - estado.inicio)) / 1000) : 0;
}
export function registrarFalloLogin(clave: string, ahora = Date.now()): void {
  const estado = intentosLogin.get(clave);
  if (!estado || ahora - estado.inicio >= VENTANA_LOGIN_MS) intentosLogin.set(clave, { inicio: ahora, fallos: 1 });
  else estado.fallos += 1;
}
export function limpiarFallosLogin(clave: string): void { intentosLogin.delete(clave); }

export async function registrarRutasAuth(app: FastifyInstance) {
  app.post<{ Body: { email?: string; password?: string } }>('/auth/login', async (request, reply) => {
    const { email, password } = request.body ?? {};
    if (!email || !password) return reply.status(400).send({ error: 'Correo y contraseña son obligatorios.' });

    const clave = claveLimiteLogin(request.ip, String(email ?? ''));
    const retryAfter = comprobarLimiteLogin(clave);
    if (retryAfter) return reply.header('Retry-After', String(retryAfter)).status(429).send({ error: 'Demasiados intentos. Intenta nuevamente más tarde.' });
    try {
      const usuario = await verificarCredenciales(email, password);
      limpiarFallosLogin(clave);
      const token = await crearSesion(usuario.userId);
      reply.setCookie(NOMBRE_COOKIE, token, COOKIE_OPTS);

      const negocios = await obtenerNegociosDeUsuario(usuario.userId);
      return reply.send({ ok: true, negocios });
    } catch (err) {
      registrarFalloLogin(clave);
      return reply.status(401).send({ error: err instanceof Error ? err.message : 'No se pudo iniciar sesión.' });
    }
  });

  /**
   * Inicio de sesión exclusivo para el Panel Maestro.
   * Solo acepta ROOT_ADMIN_EMAIL (por defecto ecfacturador@gmail.com).
   * La contraseña se verifica contra Supabase Auth y nunca se guarda en el código.
   */
  app.post<{ Body: { email?: string; password?: string } }>('/auth/root-login', async (request, reply) => {
    const { email, password } = request.body ?? {};
    const correo = String(email ?? '').trim().toLowerCase();
    if (!correo || !password) {
      return reply.status(400).send({ error: 'Correo ROOT y contraseña son obligatorios.' });
    }
    const clave = claveLimiteLogin(request.ip, correo, true);
    const retryAfter = comprobarLimiteLogin(clave);
    if (retryAfter) return reply.header('Retry-After', String(retryAfter)).status(429).send({ error: 'Demasiados intentos. Intenta nuevamente más tarde.' });
    if (correo !== env.rootAdminEmail) {
      registrarFalloLogin(clave);
      return reply.status(403).send({ error: 'Este acceso está reservado exclusivamente para ROOT.' });
    }

    try {
      const usuario = await verificarCredenciales(correo, password);
      limpiarFallosLogin(clave);

      // La identidad ROOT se define exclusivamente por ROOT_ADMIN_EMAIL.
      // No depende de emisorId, negocio, suscripción ni de una fila de usuarios_emisor.
      // La contraseña ya fue verificada contra Supabase Auth arriba.
      const token = await crearSesion(usuario.userId);
      reply.setCookie(NOMBRE_COOKIE, token, COOKIE_OPTS);
      return reply.send({ ok: true, root: true, email: usuario.email });
    } catch (err) {
      registrarFalloLogin(clave);
      return reply.status(401).send({ error: err instanceof Error ? err.message : 'No se pudo iniciar sesión como ROOT.' });
    }
  });

  app.post('/auth/logout', async (request, reply) => {
    const token = request.cookies?.[NOMBRE_COOKIE];
    if (token) await cerrarSesion(token);
    reply.clearCookie(NOMBRE_COOKIE, { path: '/' });
    reply.clearCookie('negocio_activo', { path: '/' });
    return reply.send({ ok: true });
  });

  app.post<{ Body: { accessToken?: string; password?: string } }>('/auth/actualizar-password-recuperacion', async (request, reply) => {
    const accessToken=String(request.body?.accessToken??'').trim();
    const password=String(request.body?.password??'');
    if (!accessToken || password.length < 8) return reply.status(400).send({error:'El enlace es inválido o la contraseña tiene menos de 8 caracteres.'});
    const respuesta=await fetch(`${env.supabaseUrl}/auth/v1/user`,{method:'PUT',headers:{'Content-Type':'application/json',apikey:env.supabaseServiceRoleKey,Authorization:`Bearer ${accessToken}`},body:JSON.stringify({password})});
    if (!respuesta.ok) return reply.status(400).send({error:'El enlace de recuperación expiró o no es válido.'});
    return reply.send({ok:true});
  });

  /** Con quién estamos hablando y a qué negocios tiene acceso — lo usa cada página al cargar. */
  app.get('/auth/yo', async (request, reply) => {
    const token = request.cookies?.[NOMBRE_COOKIE];
    if (!token) return reply.status(401).send({ error: 'No hay sesión activa.' });

    const sesion = await obtenerSesion(token);
    if (!sesion) return reply.status(401).send({ error: 'La sesión expiró o no es válida.' });

    const negocios = await obtenerNegociosDeUsuario(sesion.userId);
    return reply.send({ userId: sesion.userId, negocios });
  });

  /** Lista los usuarios (con su rol) de un negocio — solo un admin puede verlo (verificado por el hook global). */
  app.get<{ Querystring: { emisorId?: string } }>('/auth/usuarios', async (request, reply) => {
    const { emisorId } = request.query;
    if (!emisorId) return reply.status(400).send({ error: 'Falta el parámetro emisorId.' });

    const { data, error } = await supabase.from('usuarios_emisor').select('user_id, rol').eq('emisor_id', emisorId);
    if (error) return reply.status(500).send({ error: error.message });

    const usuarios = await Promise.all(
      (data ?? []).map(async (fila) => {
        const resp = await fetch(`${env.supabaseUrl}/auth/v1/admin/users/${fila.user_id}`, {
          headers: { apikey: env.supabaseServiceRoleKey, Authorization: `Bearer ${env.supabaseServiceRoleKey}` },
        });
        const datos = resp.ok ? ((await resp.json()) as { email?: string }) : {};
        return { userId: fila.user_id, rol: fila.rol, email: datos.email ?? '(correo no disponible)' };
      })
    );

    return reply.send(usuarios);
  });

  /** Invita (o agrega) un usuario a un negocio con un rol — solo un admin puede hacerlo. */
  app.post<{ Body: { emisorId?: string; email?: string; password?: string; rol?: string } }>(
    '/auth/usuarios',
    async (request, reply) => {
      const { emisorId, email, password, rol } = request.body ?? {};
      if (!emisorId || !email || !rol) {
        return reply.status(400).send({ error: 'Faltan campos obligatorios: emisorId, email, password, rol.' });
      }
      if (!['admin', 'contador', 'cajero'].includes(rol)) {
        return reply.status(400).send({ error: "El rol debe ser 'admin', 'contador' o 'cajero'." });
      }
      const existente = await obtenerUsuarioAuthPorEmail(email);
      if (!existente && (!password || password.length < 8)) {
        return reply.status(400).send({ error: 'Para un usuario nuevo, la contraseña debe tener al menos 8 caracteres.' });
      }

      try {
        const userId = existente?.id ?? await crearOEncontrarUsuario(email, String(password));
        await agregarUsuarioANegocio(userId, emisorId, rol);
        return reply.status(201).send({ ok: true, userId, usuarioExistente: Boolean(existente) });
      } catch (err) {
        return reply.status(500).send({ error: err instanceof Error ? err.message : 'No se pudo agregar el usuario.' });
      }
    }
  );

  /** Catálogo y permisos efectivos de un usuario — solo administrador del negocio. */
  app.get<{ Querystring: { emisorId?: string; userId?: string } }>('/auth/permisos', async (request, reply) => {
    const { emisorId, userId } = request.query;
    if (!emisorId || !userId) return reply.status(400).send({ error: 'Faltan emisorId o userId.' });
    const token = request.cookies?.[NOMBRE_COOKIE];
    const sesion = token ? await obtenerSesion(token) : null;
    if (!sesion) return reply.status(401).send({ error: 'Sesión no válida.' });
    const rolActual = await (async () => { const { data } = await supabase.from('usuarios_emisor').select('rol').eq('user_id', sesion.userId).eq('emisor_id', emisorId).maybeSingle(); return data?.rol as string | undefined; })();
    if (rolActual !== 'admin') return reply.status(403).send({ error: 'Solo el administrador puede administrar permisos.' });
    const { data: objetivo } = await supabase.from('usuarios_emisor').select('rol').eq('user_id', userId).eq('emisor_id', emisorId).maybeSingle();
    if (!objetivo) return reply.status(404).send({ error: 'El usuario no pertenece a este negocio.' });
    const efectivos = await obtenerPermisosUsuario(userId, emisorId, objetivo.rol);
    return reply.send({ catalogo: CATALOGO_PERMISOS, rol: objetivo.rol, permisos: [...efectivos], permisosBaseRol: PERMISOS_POR_ROL[objetivo.rol] ?? [] });
  });

  app.patch<{ Body: { emisorId?: string; userId?: string; permisos?: string[] } }>('/auth/usuarios/permisos', async (request, reply) => {
    const { emisorId, userId, permisos } = request.body ?? {};
    if (!emisorId || !userId || !Array.isArray(permisos)) return reply.status(400).send({ error: 'Faltan emisorId, userId o permisos.' });
    const token = request.cookies?.[NOMBRE_COOKIE];
    const sesion = token ? await obtenerSesion(token) : null;
    if (!sesion) return reply.status(401).send({ error: 'Sesión no válida.' });
    const { data: admin } = await supabase.from('usuarios_emisor').select('rol').eq('user_id', sesion.userId).eq('emisor_id', emisorId).maybeSingle();
    if (admin?.rol !== 'admin') return reply.status(403).send({ error: 'Solo el administrador puede administrar permisos.' });
    const { data: objetivo } = await supabase.from('usuarios_emisor').select('rol').eq('user_id', userId).eq('emisor_id', emisorId).maybeSingle();
    if (!objetivo) return reply.status(404).send({ error: 'El usuario no pertenece a este negocio.' });
    if (objetivo.rol === 'admin') return reply.status(400).send({ error: 'El administrador conserva acceso total y no necesita permisos individuales.' });
    try { await guardarPermisosUsuario(userId, emisorId, permisos); return reply.send({ ok: true, permisos: [...new Set(permisos)] }); }
    catch (err) { return reply.status(500).send({ error: err instanceof Error ? err.message : 'No se pudieron guardar los permisos.' }); }
  });

  /** Cambia el rol de un usuario dentro de un negocio, o lo quita (rol=null). */
  app.patch<{ Body: { emisorId?: string; userId?: string; rol?: string | null } }>('/auth/usuarios/rol', async (request, reply) => {
    const { emisorId, userId, rol } = request.body ?? {};
    if (!emisorId || !userId) return reply.status(400).send({ error: 'Faltan emisorId o userId.' });

    if (rol === null) {
      const { error } = await supabase.from('usuarios_emisor').delete().eq('emisor_id', emisorId).eq('user_id', userId);
      if (error) return reply.status(500).send({ error: error.message });
      return reply.send({ ok: true });
    }

    if (!rol || !['admin', 'contador', 'cajero'].includes(rol)) {
      return reply.status(400).send({ error: "El rol debe ser 'admin', 'contador' o 'cajero'." });
    }
    const { error } = await supabase.from('usuarios_emisor').update({ rol }).eq('emisor_id', emisorId).eq('user_id', userId);
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({ ok: true });
  });
}
