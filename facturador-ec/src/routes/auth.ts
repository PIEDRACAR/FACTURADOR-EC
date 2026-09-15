import type { FastifyInstance } from 'fastify';
import {
  verificarCredenciales,
  crearSesion,
  cerrarSesion,
  obtenerSesion,
  obtenerNegociosDeUsuario,
  agregarUsuarioANegocio,
  crearOEncontrarUsuario,
} from '../auth/sesiones.js';
import { supabase } from '../db/supabase.js';
import { env } from '../config/env.js';
import { CATALOGO_PERMISOS, PERMISOS_POR_ROL, obtenerPermisosUsuario, guardarPermisosUsuario } from '../auth/permisos.js';

const NOMBRE_COOKIE = 'sesion';
const COOKIE_OPTS = { path: '/', httpOnly: true, sameSite: 'lax' as const, maxAge: 60 * 60 * 24 * 30 };

export async function registrarRutasAuth(app: FastifyInstance) {
  app.post<{ Body: { email?: string; password?: string } }>('/auth/login', async (request, reply) => {
    const { email, password } = request.body ?? {};
    if (!email || !password) return reply.status(400).send({ error: 'Correo y contraseña son obligatorios.' });

    try {
      const usuario = await verificarCredenciales(email, password);
      const token = await crearSesion(usuario.userId);
      reply.setCookie(NOMBRE_COOKIE, token, COOKIE_OPTS);

      const negocios = await obtenerNegociosDeUsuario(usuario.userId);
      return reply.send({ ok: true, negocios });
    } catch (err) {
      return reply.status(401).send({ error: err instanceof Error ? err.message : 'No se pudo iniciar sesión.' });
    }
  });

  app.post('/auth/logout', async (request, reply) => {
    const token = request.cookies?.[NOMBRE_COOKIE];
    if (token) await cerrarSesion(token);
    reply.clearCookie(NOMBRE_COOKIE, { path: '/' });
    return reply.send({ ok: true });
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
      if (!emisorId || !email || !password || !rol) {
        return reply.status(400).send({ error: 'Faltan campos obligatorios: emisorId, email, password, rol.' });
      }
      if (!['admin', 'contador', 'cajero'].includes(rol)) {
        return reply.status(400).send({ error: "El rol debe ser 'admin', 'contador' o 'cajero'." });
      }
      if (password.length < 6) {
        return reply.status(400).send({ error: 'La contraseña debe tener al menos 6 caracteres.' });
      }

      try {
        const userId = await crearOEncontrarUsuario(email, password);
        await agregarUsuarioANegocio(userId, emisorId, rol);
        return reply.status(201).send({ ok: true, userId });
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
