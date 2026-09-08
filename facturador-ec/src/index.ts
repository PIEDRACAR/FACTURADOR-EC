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
import { registrarRutasAuth } from './routes/auth.js';
import { registrarProteccionSesion } from './auth/proteccion.js';
import { inyectarProteccionSesion } from './services/proteccionPagina.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = Fastify({
  logger: true,
});

await app.register(cookie);

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
function servirPagina(nombreArchivo: string, protegida = true) {
  return async (_request: unknown, reply: { type: (t: string) => { send: (s: string) => void } }) => {
    let html = readFileSync(join(__dirname, '..', 'public', nombreArchivo), 'utf-8');
    if (protegida) html = inyectarProteccionSesion(html);
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

app
  .listen({ port: env.port, host: '0.0.0.0' })
  .then(() => {
    app.log.info(`facturador-ec escuchando en el puerto ${env.port}`);
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
