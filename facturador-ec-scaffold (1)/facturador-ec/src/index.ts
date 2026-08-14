import Fastify from 'fastify';
import { env } from './config/env.js';
import { registrarRutasComprobantes } from './routes/comprobantes.js';

const app = Fastify({
  logger: true,
});

app.get('/salud', async () => ({ ok: true, servicio: 'facturador-ec' }));

await registrarRutasComprobantes(app);

app
  .listen({ port: env.port, host: '0.0.0.0' })
  .then(() => {
    app.log.info(`facturador-ec escuchando en el puerto ${env.port}`);
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
