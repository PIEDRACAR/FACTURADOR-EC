import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Fastify from 'fastify';
import { env } from './config/env.js';
import { registrarRutasComprobantes } from './routes/comprobantes.js';
import { registrarRutasEmisores } from './routes/emisores.js';
import { registrarRutasPos } from './routes/pos.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = Fastify({
  logger: true,
});

app.get('/salud', async () => ({ ok: true, servicio: 'facturador-ec' }));

// Página de registro de negocios nuevos (formulario autoservicio).
app.get('/registro', async (_request, reply) => {
  const html = readFileSync(join(__dirname, '..', 'public', 'registro.html'), 'utf-8');
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

app
  .listen({ port: env.port, host: '0.0.0.0' })
  .then(() => {
    app.log.info(`facturador-ec escuchando en el puerto ${env.port}`);
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
