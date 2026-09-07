import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { obtenerSesion, obtenerRolEnNegocio } from './sesiones.js';
import { supabase } from '../db/supabase.js';

const NOMBRE_COOKIE = 'sesion';

const RUTAS_PUBLICAS = new Set([
  'GET /',
  'GET /login',
  'GET /registro',
  'GET /salud',
  'POST /auth/login',
  'GET /auth/yo',
  'GET /emisores/buscar',
  'POST /emisores/registrar',
]);

const PAGINAS_HTML = new Set([
  '/pos',
  '/productos-admin',
  '/inventario',
  '/proveedores-admin',
  '/clientes-admin',
  '/cuentas-por-pagar',
  '/cuentas-por-cobrar',
  '/proformas',
  '/reportes',
  '/usuarios-admin',
]);

const RUTAS_PERMITIDAS_CAJERO = new Set([
  'GET /productos',
  'POST /pos/venta',
  'GET /comprobantes/:id/ride',
  'GET /comprobantes/:id/xml',
  'GET /dashboard/resumen',
  'GET /clientes',
  'POST /clientes',
]);

async function resolverEmisorIdDesdeComprobante(comprobanteId: string): Promise<string | null> {
  const { data } = await supabase.from('comprobantes').select('emisor_id').eq('id', comprobanteId).maybeSingle();
  return data?.emisor_id ?? null;
}

export function registrarProteccionSesion(app: FastifyInstance) {
  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    const metodo = request.method;
    const patronRuta = request.routeOptions?.url ?? request.url.split('?')[0];

    if (metodo === 'GET' && PAGINAS_HTML.has(patronRuta)) return;
    if (RUTAS_PUBLICAS.has(`${metodo} ${patronRuta}`)) return;

    const token = (request.cookies as Record<string, string> | undefined)?.[NOMBRE_COOKIE];
    const sesion = token ? await obtenerSesion(token) : null;
    if (!sesion) {
      return reply.status(401).send({ error: 'Debes iniciar sesión.' });
    }

    let emisorId: string | undefined =
      (request.query as Record<string, string> | undefined)?.emisorId ||
      ((request.body as Record<string, unknown> | undefined)?.emisorId as string | undefined);

    if (!emisorId && (patronRuta === '/comprobantes/:id/ride' || patronRuta === '/comprobantes/:id/xml')) {
      const params = request.params as Record<string, string>;
      emisorId = (await resolverEmisorIdDesdeComprobante(params.id)) ?? undefined;
    }

    if (!emisorId) {
      return reply.status(400).send({ error: 'Falta emisorId en la petición — no se puede verificar el acceso.' });
    }

    const rol = await obtenerRolEnNegocio(sesion.userId, emisorId);
    if (!rol) {
      return reply.status(403).send({ error: 'No tienes acceso a este negocio.' });
    }

    if (rol === 'cajero' && !RUTAS_PERMITIDAS_CAJERO.has(`${metodo} ${patronRuta}`)) {
      return reply.status(403).send({ error: 'Tu rol de cajero no tiene acceso a esta función.' });
    }

    request.usuarioSesion = { userId: sesion.userId, rol, emisorId };
  });
}
