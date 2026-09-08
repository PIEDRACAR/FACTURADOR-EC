import { obtenerSesion, obtenerRolEnNegocio, obtenerNegociosDeUsuario } from './sesiones.js';
import { supabase } from '../db/supabase.js';
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
const RUTAS_PERMITIDAS_CAJERO = new Set([
    'GET /productos', 'POST /pos/venta', 'GET /comprobantes/:id/ride', 'GET /comprobantes/:id/xml',
    'POST /comprobantes/:id/reenviar-email', 'GET /comprobantes/:id/email-historial',
    'GET /dashboard/resumen', 'GET /clientes', 'POST /clientes',
]);
async function resolverEmisorIdDesdeComprobante(comprobanteId) {
    const { data } = await supabase.from('comprobantes').select('emisor_id').eq('id', comprobanteId).maybeSingle();
    return data?.emisor_id ?? null;
}
function asignarEmisorEnPeticion(request, emisorId) {
    const query = (request.query ?? {});
    if (!query.emisorId)
        query.emisorId = emisorId;
    request.query = query;
    const body = (request.body ?? {});
    if (request.body && typeof request.body === 'object' && !body.emisorId) {
        body.emisorId = emisorId;
        request.body = body;
    }
}
export function registrarProteccionSesion(app) {
    app.addHook('preHandler', async (request, reply) => {
        const metodo = request.method;
        const patronRuta = request.routeOptions?.url ?? request.url.split('?')[0];
        if (RUTAS_PUBLICAS.has(`${metodo} ${patronRuta}`))
            return;
        const token = request.cookies?.[NOMBRE_COOKIE];
        const sesion = token ? await obtenerSesion(token) : null;
        if (!sesion) {
            if (metodo === 'GET' && PAGINAS_HTML.has(patronRuta))
                return reply.redirect('/login');
            return reply.status(401).send({ error: 'Debes iniciar sesión.' });
        }
        let emisorId = (request.query?.emisorId) ||
            request.body?.emisorId;
        if (!emisorId && (patronRuta === '/comprobantes/:id/ride' || patronRuta === '/comprobantes/:id/xml' || patronRuta === '/comprobantes/:id/reenviar-email' || patronRuta === '/comprobantes/:id/email-historial')) {
            const params = request.params;
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
            }
            else if (negocios.length > 1) {
                return reply.status(409).send({
                    error: 'Selecciona el negocio con el que deseas trabajar.',
                    requiereSeleccionNegocio: true,
                    negocios,
                });
            }
            else {
                return reply.status(403).send({ error: 'Tu usuario no tiene ningún negocio asociado.' });
            }
        }
        const rol = await obtenerRolEnNegocio(sesion.userId, emisorId);
        if (!rol)
            return reply.status(403).send({ error: 'No tienes acceso a este negocio.' });
        if (rol === 'cajero' && !RUTAS_PERMITIDAS_CAJERO.has(`${metodo} ${patronRuta}`)) {
            return reply.status(403).send({ error: 'Tu rol de cajero no tiene acceso a esta función.' });
        }
        request.usuarioSesion = { userId: sesion.userId, rol, emisorId: emisorId };
    });
}
//# sourceMappingURL=proteccion.js.map