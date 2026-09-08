import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { obtenerSesion, obtenerRolEnNegocio, obtenerNegociosDeUsuario } from './sesiones.js';
import { supabase } from '../db/supabase.js';
import { obtenerPermisosUsuario, permisoParaRuta } from './permisos.js';

const NOMBRE_COOKIE = 'sesion';

const RUTAS_PUBLICAS = new Set([
  'GET /', 'GET /login', 'GET /registro', 'GET /salud',
  'POST /auth/login', 'GET /auth/yo', 'GET /emisores/buscar', 'POST /emisores/registrar',
]);

const PAGINAS_HTML = new Set([
  '/pos', '/productos-admin', '/inventario', '/proveedores-admin', '/clientes-admin',
  '/cuentas-por-pagar', '/cuentas-por-cobrar', '/proformas', '/reportes', '/usuarios-admin', '/caja',
  '/correo-prueba',
]);



async function resolverEmisorIdDesdeComprobante(comprobanteId: string): Promise<string | null> {
  const { data } = await supabase.from('comprobantes').select('emisor_id').eq('id', comprobanteId).maybeSingle();
  return data?.emisor_id ?? null;
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
      if (metodo === 'GET' && PAGINAS_HTML.has(patronRuta)) return reply.redirect('/login');
      return reply.status(401).send({ error: 'Debes iniciar sesión.' });
    }

    let emisorId: string | undefined =
      ((request.query as Record<string, string> | undefined)?.emisorId) ||
      (((request.body as Record<string, unknown> | undefined)?.emisorId as string | undefined));

    if (!emisorId && (patronRuta === '/comprobantes/:id/ride' || patronRuta === '/comprobantes/:id/xml' || patronRuta === '/comprobantes/:id/reenviar-email' || patronRuta === '/comprobantes/:id/email-historial' || patronRuta === '/comprobantes/:id/ticket')) {
      const params = request.params as Record<string, string>;
      emisorId = (await resolverEmisorIdDesdeComprobante(params.id)) ?? undefined;
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
        return reply.status(409).send({
          error: 'Selecciona el negocio con el que deseas trabajar.',
          requiereSeleccionNegocio: true,
          negocios,
        });
      } else {
        return reply.status(403).send({ error: 'Tu usuario no tiene ningún negocio asociado.' });
      }
    }

    const rol = await obtenerRolEnNegocio(sesion.userId, emisorId!);
    if (!rol) return reply.status(403).send({ error: 'No tienes acceso a este negocio.' });

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
