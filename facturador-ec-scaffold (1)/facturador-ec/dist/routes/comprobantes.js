import { supabase } from '../db/supabase.js';
import { emitirFactura } from '../services/facturacion.js';
export async function registrarRutasComprobantes(app) {
    /**
     * Emite una factura ya generada en la tabla `comprobantes` (estado
     * 'generado'). El POS es responsable de haber creado esa fila y sus
     * `comprobante_items` / `comprobante_formas_pago` ANTES de llamar aquí,
     * para no perder el detalle de la venta si la emisión falla.
     */
    app.post('/comprobantes/factura/emitir', async (request, reply) => {
        const { emisorId, comprobanteId, facturaData } = request.body;
        if (!emisorId || !comprobanteId || !facturaData) {
            return reply.status(400).send({
                error: 'Se requieren emisorId, comprobanteId y facturaData en el cuerpo de la petición.',
            });
        }
        try {
            const resultado = await emitirFactura({ emisorId, comprobanteId, facturaData });
            return reply.send({
                estado: resultado.estado,
                claveAcceso: resultado.claveAcceso,
                numeroAutorizacion: resultado.numeroAutorizacion,
            });
        }
        catch (err) {
            request.log.error(err);
            return reply.status(502).send({
                error: 'No se pudo completar la emisión de la factura.',
                detalle: err instanceof Error ? err.message : String(err),
            });
        }
    });
    /** Consulta rápida del estado actual de un comprobante ya emitido. */
    app.get('/comprobantes/:id', async (request, reply) => {
        const { data, error } = await supabase
            .from('comprobantes')
            .select('*')
            .eq('id', request.params.id)
            .single();
        if (error || !data) {
            return reply.status(404).send({ error: 'Comprobante no encontrado.' });
        }
        return reply.send(data);
    });
}
//# sourceMappingURL=comprobantes.js.map