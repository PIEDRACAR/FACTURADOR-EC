import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { env } from './config/env.js';
import { registrarRutasComprobantes } from './routes/comprobantes.js';
import { registrarRutasEmisores } from './routes/emisores.js';
import { registrarRutasPos } from './routes/pos.js';
import { registrarRutasRide } from './routes/ride.js';
import { registrarRutasProformas } from './routes/proformas.js';
import { registrarRutasReportes } from './routes/reportes.js';
import { registrarRutasDashboard } from './routes/dashboard.js';
import { registrarRutasInventario } from './routes/inventario.js';
import { registrarRutasProveedores } from './routes/proveedores.js';
import { registrarRutasClientes } from './routes/clientes.js';
import { registrarRutasCuentas } from './routes/cuentas.js';
import { registrarRutasImportacionProductos } from './routes/productos-importar.js';
import { registrarRutasCaja } from './routes/caja.js';
import { registrarRutasCorreo } from './routes/correo.js';
import { registrarRutasConfiguracion } from './routes/configuracion.js';
import { registrarRutasDocumentos } from './routes/documentos.js';
import { registrarRutasProveedor } from './routes/proveedor.js';
import { registrarRutasAts } from './routes/ats.js';
import { registrarRutasImpuestos } from './routes/impuestos.js';
import { registrarRutasAuth } from './routes/auth.js';
import { registrarProteccionSesion } from './auth/proteccion.js';
import { inyectarProteccionSesion } from './services/proteccionPagina.js';
const __dirname = dirname(fileURLToPath(import.meta.url));
const app = Fastify({
    logger: true,
});
await app.register(cookie);
// Las rutas de API nunca deben devolver HTML ante un 404/error. Esto evita
// que el navegador intente hacer JSON.parse() sobre una página HTML y muestre
// el engañoso "Unexpected token '<'".
app.setNotFoundHandler(async (request, reply) => {
    const path = request.url.split('?')[0];
    const esApi = path.startsWith('/api/') || path.startsWith('/pos/') || path.startsWith('/comprobantes/') || path.startsWith('/documentos/');
    if (esApi)
        return reply.status(404).send({ ok: false, error: 'Ruta de API no encontrada.', ruta: path, metodo: request.method });
    return reply.status(404).type('text/html; charset=utf-8').send('<!doctype html><html lang="es"><head><meta charset="utf-8"><title>404</title></head><body><h1>404</h1><p>Página no encontrada.</p></body></html>');
});
function obtenerStatusCodeError(error) {
    if (typeof error === 'object' && error !== null && 'statusCode' in error) {
        const statusCode = error.statusCode;
        if (typeof statusCode === 'number' && statusCode >= 400 && statusCode <= 599)
            return statusCode;
    }
    return 500;
}
function obtenerDetalleError(error) {
    if (error instanceof Error)
        return error.message;
    if (typeof error === 'string')
        return error;
    try {
        const serializado = JSON.stringify(error);
        return serializado || 'Error interno del servidor.';
    }
    catch {
        return 'Error interno del servidor.';
    }
}
app.setErrorHandler(async (error, request, reply) => {
    request.log.error(error);
    const path = request.url.split('?')[0];
    const esApi = path.startsWith('/api/') || path.startsWith('/pos/') || path.startsWith('/comprobantes/') || path.startsWith('/documentos/');
    const statusCode = obtenerStatusCodeError(error);
    const detalle = obtenerDetalleError(error);
    if (esApi)
        return reply.status(statusCode).send({ ok: false, error: 'Error interno del servidor.', detalle });
    return reply.status(statusCode).send('Error interno del servidor.');
});
app.get('/salud', async () => ({ ok: true, servicio: 'facturador-ec' }));
// Activos de la interfaz profesional. Estas rutas son necesarias porque
// las pantallas se sirven mediante Fastify (no mediante un servidor estático).
app.get('/app.css', async (_request, reply) => {
    const css = readFileSync(join(__dirname, '..', 'public', 'app.css'), 'utf-8');
    return reply.header('Cache-Control', 'no-store, max-age=0').type('text/css; charset=utf-8').send(css);
});
app.get('/app-shell.js', async (_request, reply) => {
    const js = readFileSync(join(__dirname, '..', 'public', 'app-shell.js'), 'utf-8');
    return reply.header('Cache-Control', 'no-store, max-age=0').type('application/javascript; charset=utf-8').send(js);
});
/**
 * Sirve un archivo HTML de /public. `protegida=true` (el caso normal)
 * inyecta el script de redirección a /login ante un 401 y el botón de
 * cerrar sesión — así ninguna de las páginas ya construidas necesitó
 * editarse a mano para quedar protegidas.
 */
function servirPagina(nombreArchivo, protegida = true) {
    return async (_request, reply) => {
        let html = readFileSync(join(__dirname, '..', 'public', nombreArchivo), 'utf-8');
        if (protegida)
            html = inyectarProteccionSesion(html);
        reply.type('text/html').send(html);
    };
}
app.get('/', servirPagina('inicio.html'));
app.get('/login', servirPagina('login.html', false));
app.get('/registro', servirPagina('registro.html', false));
app.get('/productos-admin', servirPagina('productos-admin.html'));
app.get('/inventario', servirPagina('inventario.html'));
app.get('/proveedores-admin', servirPagina('proveedores-admin.html'));
app.get('/clientes-admin', servirPagina('clientes-admin.html'));
app.get('/cuentas-por-pagar', servirPagina('cuentas-por-pagar.html'));
app.get('/cuentas-por-cobrar', servirPagina('cuentas-por-cobrar.html'));
app.get('/proformas', servirPagina('proformas.html'));
app.get('/reportes', servirPagina('reportes.html'));
app.get('/pos', servirPagina('pos.html'));
app.get('/usuarios-admin', servirPagina('usuarios-admin.html'));
app.get('/caja', servirPagina('caja.html'));
app.get('/correo-prueba', servirPagina('correo-prueba.html'));
app.get('/configuracion', servirPagina('configuracion.html'));
app.get('/documentos', servirPagina('documentos.html'));
app.get('/admin-proveedor', servirPagina('admin-proveedor.html', false));
app.get('/ats', servirPagina('ats.html'));
app.get('/impuestos-admin', servirPagina('impuestos-admin.html', false));
app.get('/suscripcion', servirPagina('suscripcion-vencida.html', false));
await registrarRutasAuth(app);
registrarProteccionSesion(app); // debe registrarse DESPUÉS de las rutas de auth (login/registro quedan públicas) y antes de las que sí necesitan sesión
await registrarRutasComprobantes(app);
await registrarRutasEmisores(app);
await registrarRutasPos(app);
await registrarRutasRide(app);
await registrarRutasProformas(app);
await registrarRutasReportes(app);
await registrarRutasDashboard(app);
await registrarRutasInventario(app);
await registrarRutasProveedores(app);
await registrarRutasClientes(app);
await registrarRutasCuentas(app);
await registrarRutasImportacionProductos(app);
await registrarRutasCaja(app);
await registrarRutasCorreo(app);
await registrarRutasConfiguracion(app);
await registrarRutasDocumentos(app);
await registrarRutasProveedor(app);
await registrarRutasAts(app);
await registrarRutasImpuestos(app);
app
    .listen({ port: env.port, host: '0.0.0.0' })
    .then(() => {
    app.log.info(`facturador-ec escuchando en el puerto ${env.port}`);
})
    .catch((err) => {
    app.log.error(err);
    process.exit(1);
});
//# sourceMappingURL=index.js.map