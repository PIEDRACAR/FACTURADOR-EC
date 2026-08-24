import type { FastifyInstance } from 'fastify';
import { generarRidePdf } from '../services/ride.js';

export async function registrarRutasRide(app: FastifyInstance) {
  /** Descarga/muestra el RIDE (PDF) de un comprobante ya creado en el sistema. */
  app.get<{ Params: { id: string } }>('/comprobantes/:id/ride', async (request, reply) => {
    try {
      const pdf = await generarRidePdf(request.params.id);
      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', `inline; filename="factura-${request.params.id}.pdf"`);
      return reply.send(pdf);
    } catch (err) {
      request.log.error(err);
      return reply.status(404).send({
        error: 'No se pudo generar el RIDE.',
        detalle: err instanceof Error ? err.message : String(err),
      });
    }
  });
}
