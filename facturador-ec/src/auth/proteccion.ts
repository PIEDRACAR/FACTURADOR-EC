import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { obtenerSesion, obtenerRolEnNegocio, obtenerNegociosDeUsuario } from './sesiones.js';
import { supabase } from '../db/supabase.js';
import { env } from '../config/env.js';
import { obtenerPermisosUsuario, permisoParaRuta } from './permisos.js';
import { comprobarModuloPlan } from '../services/saas.js';

const NOMBRE_COOKIE = 'sesion';
const NEGOCIO_COOKIE = 'negocio_activo';

const RUTAS_PUBLICAS = new Set([
  'GET /login', 'GET /root-login', 'GET /planes', 'GET /registro', 'GET /restablecer-password', 'GET /salud',
  'POST /auth/login', 'POST /auth/root-login', 'POST /auth/actualizar-password-recuperacion', 'GET /auth/yo', 'GET /emisores/buscar', 'POST /emisores/registrar',
  'POST /pagos/payphone/NotificacionPago', 'POST /pagos/payphone/notificacion',
  'GET /productos/plantilla', 'GET /planes-publicos',
  // Recursos estáticos del shell: nunca deben pasar por la autorización de negocio.
  'GET /app.css', 'GET /app-shell.js', 'GET /security.js', 'GET /favicon.ico',
]);

const PAGINAS_HTML = new Set([
  '/pos', '/productos-admin', '/inventario', '/proveedores-admin', '/clientes-admin',
  '/contabilidad', '/cuentas-por-pagar', '/cuentas-por-cobrar', '/proformas', '/reportes', '/usuarios-admin', '/caja',
  '/', '/configuracion', '/documentos', '/correo-prueba', '/admin-proveedor', '/suscripcion', '/ats',
]);



async function resolverEmisorIdDesdeComprobante(comprobanteId: string): Promise<string | null> {
  const { data } = await supabase.from('comprobantes').select('emisor_id').eq('id', comprobanteId).maybeSingle();
  return data?.emisor_id ?? null;
}

async function resolverEmisorIdDesdeProforma(proformaId: string): Promise<string | null> {
  const { data } = await supabase.from('proformas').select('emisor_id').eq('id', proformaId).maybeSingle();
  return data?.emisor_id ?? null;
}


async function resolverEmisorIdDesdeRecurso(patronRuta: string, id: string): Promise<string | null> {
  if (!id) return null;
  const consultas: Array<[string, string]> = [
    ['/comprobantes/', 'comprobantes'],
    ['/proformas/', 'proformas'],
    ['/clientes/', 'clientes'],
    ['/proveedores/', 'proveedores'],
    ['/cuentas-por-pagar/', 'cuentas_por_pagar'],
    ['/cuentas-por-cobrar/', 'cuentas_por_cobrar'],
    ['/api/documentos/', 'documentos_sri_borrador'],
    ['/ats/compras/', 'ats_compras'],
    ['/ats/generaciones/', 'ats_generaciones'],
    ['/configuracion/establecimientos/', 'establecimientos_emisor'],
    ['/configuracion/puntos-emision/', 'puntos_emision'],
    ['/productos/', 'productos'],
    ['/contabilidad/nomina/empleados/', 'nomina_empleados'],
    ['/contabilidad/comprobantes/', 'comprobantes'],
    ['/contabilidad/cxp/', 'cuentas_por_pagar'],
    ['/contabilidad/cxc/', 'cuentas_por_cobrar'],
    ['/contabilidad/plan/', 'plan_cuentas_contables'],
    ['/contabilidad/provisiones/', 'provisiones_contables'],
    ['/contabilidad/asientos/', 'asientos_contables'],
  ];
  const entrada = consultas.find(([prefijo]) => patronRuta.startsWith(prefijo));
  if (!entrada) return null;
  const { data, error } = await supabase.from(entrada[1]).select('emisor_id').eq('id', id).maybeSingle();
  if (error || !data) return null;
  return data.emisor_id ? String(data.emisor_id) : null;
}

function asignarEmisorEnPeticion(request: FastifyRequest, emisorId: string) {
  const query = (request.query ?? {}) as Record<string, unknown>;
  if (!query.emisorId) query.emisorId = emisorId;
  (request as any).query = query;

  const body = (request.body ?? {}) as Record<string, unknown>;
  if (request.body && typeof request.body === 'object' && !body.emisorId) {
    body.emisorId = emisorId;
    (request as any).body = body;
  }
}

export function registrarProteccionSesion(app: FastifyInstance) {
  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    const metodo = request.method;
    const patronRuta = request.routeOptions?.url ?? request.url.split('?')[0];

    if (RUTAS_PUBLICAS.has(`${metodo} ${patronRuta}`)) return;

    const token = (request.cookies as Record<string, string> | undefined)?.[NOMBRE_COOKIE];
    const sesion = token ? await obtenerSesion(token) : null;
    if (!sesion) {
      if (metodo === 'GET' && patronRuta === '/admin-proveedor') return reply.redirect('/root-login');
      if (metodo === 'GET' && PAGINAS_HTML.has(patronRuta)) return reply.redirect('/login');
      return reply.status(401).send({ error: 'Debes iniciar sesión.' });
    }

    // El Panel Maestro y TODA su API son independientes de emisorId, negocio y
    // suscripción. Solo la identidad ROOT configurada puede utilizarlos.
    // Nunca se concede acceso por tener una fila en usuarios_emisor.
    const esRutaMaestro = patronRuta === '/admin-proveedor' || patronRuta.startsWith('/proveedor/');
    if (esRutaMaestro) {
      const { data: authUser, error: authError } = await supabase.auth.admin.getUserById(sesion.userId);
      const email = authUser.user?.email?.trim().toLowerCase() ?? '';
      if (authError || email !== env.rootAdminEmail) {
        if (metodo === 'GET' && patronRuta === '/admin-proveedor') return reply.redirect('/root-login');
        return reply.status(403).send({ error: 'Acceso exclusivo para ROOT.' });
      }

      request.usuarioSesion = { userId: sesion.userId, rol: 'proveedor', emisorId: '' };
      return;
    }

    // /suscripcion pertenece al flujo de las empresas cliente y sí utiliza emisorId.

    // Para rutas que operan sobre un recurso concreto, la empresa se obtiene
    // SIEMPRE del propio recurso y no del emisorId enviado por el navegador.
    // Esto evita un ataque de tipo IDOR en el que un usuario autorizado en la
    // empresa A intenta operar sobre un UUID de la empresa B.
    let emisorId: string | undefined;
    const params = request.params as Record<string, string>;
    const idRecurso = params?.id;
    const idAlternativo = params?.cuentaId || params?.pagoId;
    if (idRecurso) emisorId = (await resolverEmisorIdDesdeRecurso(patronRuta, idRecurso)) ?? undefined;
    if (!emisorId && idAlternativo) {
      emisorId = (await resolverEmisorIdDesdeRecurso(patronRuta, idAlternativo)) ?? undefined;
      if (!emisorId && patronRuta.includes('/pagos/')) {
        const base = patronRuta.includes('cuentas-por-pagar') ? 'pagos_cuentas_por_pagar' : patronRuta.includes('cuentas-por-cobrar') ? 'pagos_cuentas_por_cobrar' : '';
        if (base) {
          const { data: pago } = await supabase.from(base).select('id,cuenta_id').eq('id', idAlternativo).maybeSingle();
          if (pago?.cuenta_id) {
            const tablaCuenta = base === 'pagos_cuentas_por_pagar' ? 'cuentas_por_pagar' : 'cuentas_por_cobrar';
            const { data: cuenta } = await supabase.from(tablaCuenta).select('emisor_id').eq('id', pago.cuenta_id).maybeSingle();
            emisorId = cuenta?.emisor_id ?? undefined;
          }
        }
      }
    }

    if (!emisorId && (patronRuta === '/comprobantes/:id/ride' || patronRuta === '/comprobantes/:id/xml' || patronRuta === '/comprobantes/:id/reenviar-email' || patronRuta === '/comprobantes/:id/email-historial' || patronRuta === '/comprobantes/:id/ticket' || patronRuta === '/comprobantes/:id/archivos')) {
      emisorId = (await resolverEmisorIdDesdeComprobante(params.id)) ?? undefined;
    }

    if (!emisorId && patronRuta === '/proformas/:id/pdf') {
      emisorId = (await resolverEmisorIdDesdeProforma(params.id)) ?? undefined;
    }

    if (!emisorId) {
      emisorId =
        ((request.query as Record<string, string> | undefined)?.emisorId) ||
        (((request.body as Record<string, unknown> | undefined)?.emisorId as string | undefined)) ||
        (request.cookies as Record<string,string> | undefined)?.[NEGOCIO_COOKIE];
    }

    // Si el usuario tiene un solo negocio, el sistema lo selecciona automáticamente.
    // Esto evita que las páginas queden inutilizables por enlaces sin ?emisorId=...
    if (!emisorId) {
      const negocios = await obtenerNegociosDeUsuario(sesion.userId);
      if (negocios.length === 1) {
        emisorId = negocios[0].emisorId;
        if (metodo === 'GET' && PAGINAS_HTML.has(patronRuta)) {
          return reply.redirect(`${patronRuta}?emisorId=${encodeURIComponent(emisorId)}`);
        }
        asignarEmisorEnPeticion(request, emisorId);
      } else if (negocios.length > 1) {
        // Si el usuario ya tiene un negocio activo en cookie se usa ese;
        // si no, se fija automáticamente el primero para evitar que módulos
        // operativos fallen con 409 antes de que cargue el shell. El cambio
        // de negocio se mantiene mediante el parámetro emisorId y esta cookie.
        emisorId = negocios[0].emisorId;
        reply.setCookie(NEGOCIO_COOKIE, emisorId, { path: '/', httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 60 * 60 * 24 * 30 });
        if (metodo === 'GET' && PAGINAS_HTML.has(patronRuta)) {
          return reply.redirect(`${patronRuta}?emisorId=${encodeURIComponent(emisorId)}`);
        }
        asignarEmisorEnPeticion(request, emisorId);
      } else {
        return reply.status(403).send({ error: 'Tu usuario no tiene ningún negocio asociado.' });
      }
    }

    if (emisorId) reply.setCookie(NEGOCIO_COOKIE, emisorId, { path: '/', httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 60 * 60 * 24 * 30 });

    const rol = await obtenerRolEnNegocio(sesion.userId, emisorId!);
    if (!rol) return reply.status(403).send({ error: 'No tienes acceso a este negocio.' });

    // Control comercial SaaS: si la empresa tiene una suscripción registrada,
    // su acceso operativo depende de que esté activa y vigente. Los emisores
    // históricos que aún no tienen suscripción no se bloquean.
    const { data: suscripcion } = await supabase
      .from('suscripciones')
      .select('id,estado,proximo_vencimiento')
      .eq('emisor_id', emisorId!)
      .maybeSingle();
    if (suscripcion) {
      const hoy = new Date().toISOString().slice(0, 10);
      if (suscripcion.estado === 'activa' && suscripcion.proximo_vencimiento < hoy) {
        await supabase.from('suscripciones').update({ estado: 'vencida', updated_at: new Date().toISOString() }).eq('id', suscripcion.id);
        if (metodo === 'GET' && PAGINAS_HTML.has(patronRuta)) return reply.redirect(`/suscripcion?emisorId=${encodeURIComponent(emisorId!)}`);
        return reply.status(402).send({ error: 'La suscripción de esta empresa está vencida.', estadoSuscripcion: 'vencida', proximoVencimiento: suscripcion.proximo_vencimiento });
      }
      if (['vencida','suspendida','cancelada'].includes(suscripcion.estado)) {
        if (metodo === 'GET' && PAGINAS_HTML.has(patronRuta)) return reply.redirect(`/suscripcion?emisorId=${encodeURIComponent(emisorId!)}`);
        return reply.status(402).send({ error: 'La suscripción de esta empresa no está activa.', estadoSuscripcion: suscripcion.estado, proximoVencimiento: suscripcion.proximo_vencimiento });
      }
    }

    const moduloPorRuta: Array<[string, string]> = [
      ['/contabilidad', 'contabilidad'],
      ['/ats', 'ats'],
      ['/inventario', 'inventario'],
      ['/productos-importar', 'carga_electronica'],
      ['/proveedores-admin', 'compras_proveedores'],
      ['/proveedores', 'compras_proveedores'],
      ['/cuentas-por-pagar', 'cuentas_por_pagar'],
      ['/cuentas-por-cobrar', 'cuentas_por_cobrar'],
      ['/proformas', 'proformas'],
      ['/caja', 'caja'],
      ['/reportes', 'reportes_avanzados'],
      ['/usuarios-admin', 'usuarios_permisos'],
      ['/documentos', 'documentos_tributarios'],
      ['/api/documentos', 'documentos_tributarios'],
    ];
    const modulo = moduloPorRuta.find(([prefijo]) => patronRuta.startsWith(prefijo))?.[1];
    if (modulo) {
      const caracteristica = await comprobarModuloPlan(emisorId!, modulo);
      if (!caracteristica.ok) return reply.status(402).send({ error: caracteristica.mensaje, modulo, plan: caracteristica.plan?.nombre });
    }

    // A partir de aquí, el emisor queda fijado por sesión/recurso. Nunca se debe
    // confiar en un emisor diferente enviado posteriormente por el navegador.
    const queryCanon = (request.query ?? {}) as Record<string, unknown>;
    if ('emisorId' in queryCanon) queryCanon.emisorId = emisorId!;
    (request as any).query = queryCanon;
    if (request.body && typeof request.body === 'object') {
      const bodyCanon = request.body as Record<string, unknown>;
      if ('emisorId' in bodyCanon || Object.keys(bodyCanon).length > 0) bodyCanon.emisorId = emisorId!;
      (request as any).body = bodyCanon;
    }

    const permiso = permisoParaRuta(metodo, patronRuta);
    if (permiso) {
      const permisos = await obtenerPermisosUsuario(sesion.userId, emisorId!, rol);
      if (!permisos.has(permiso)) {
        return reply.status(403).send({ error: `Tu usuario no tiene permiso para: ${permiso}. Solicita al administrador que lo habilite.` });
      }
    }

    request.usuarioSesion = { userId: sesion.userId, rol, emisorId: emisorId! };
  });
}
