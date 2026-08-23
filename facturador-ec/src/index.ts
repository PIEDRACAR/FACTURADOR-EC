import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Fastify from 'fastify';
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

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = Fastify({
  logger: true,
});

app.get('/salud', async () => ({ ok: true, servicio: 'facturador-ec' }));

// Panel principal — resumen del negocio y accesos a todas las secciones.
app.get('/', async (_request, reply) => {
  const html = readFileSync(join(__dirname, '..', 'public', 'inicio.html'), 'utf-8');
  reply.type('text/html').send(html);
});

// Página de registro de negocios nuevos (formulario autoservicio).
app.get('/registro', async (_request, reply) => {
  const html = readFileSync(join(__dirname, '..', 'public', 'registro.html'), 'utf-8');
  reply.type('text/html').send(html);
});

// Página del catálogo de productos.
app.get('/productos-admin', async (_request, reply) => {
  const html = readFileSync(join(__dirname, '..', 'public', 'productos-admin.html'), 'utf-8');
  reply.type('text/html').send(html);
});

// Página de inventario (entradas, ajustes, kardex).
app.get('/inventario', async (_request, reply) => {
  const html = readFileSync(join(__dirname, '..', 'public', 'inventario.html'), 'utf-8');
  reply.type('text/html').send(html);
});

// Página de proveedores.
app.get('/proveedores-admin', async (_request, reply) => {
  const html = readFileSync(join(__dirname, '..', 'public', 'proveedores-admin.html'), 'utf-8');
  reply.type('text/html').send(html);
});

// Página de clientes.
app.get('/clientes-admin', async (_request, reply) => {
  const html = readFileSync(join(__dirname, '..', 'public', 'clientes-admin.html'), 'utf-8');
  reply.type('text/html').send(html);
});

// Página de cuentas por pagar.
app.get('/cuentas-por-pagar', async (_request, reply) => {
  const html = readFileSync(join(__dirname, '..', 'public', 'cuentas-por-pagar.html'), 'utf-8');
  reply.type('text/html').send(html);
});

// Página de cuentas por cobrar.
app.get('/cuentas-por-cobrar', async (_request, reply) => {
  const html = readFileSync(join(__dirname, '..', 'public', 'cuentas-por-cobrar.html'), 'utf-8');
  reply.type('text/html').send(html);
});

// Página de proformas (cotizaciones).
app.get('/proformas', async (_request, reply) => {
  const html = readFileSync(join(__dirname, '..', 'public', 'proformas.html'), 'utf-8');
  reply.type('text/html').send(html);
});

// Página de reportes de rentabilidad.
app.get('/reportes', async (_request, reply) => {
  const html = readFileSync(join(__dirname, '..', 'public', 'reportes.html'), 'utf-8');
  reply.type('text/html').send(html);
});

// Página del punto de venta (carrito + cobro).
app.get('/pos', async (_request, reply) => {
  const html = readFileSync(join(__dirname, '..', 'public', 'pos.html'), 'utf-8');
  reply.type('text/html').send(html);
});

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

app
  .listen({ port: env.port, host: '0.0.0.0' })
  .then(() => {
    app.log.info(`facturador-ec escuchando en el puerto ${env.port}`);
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
