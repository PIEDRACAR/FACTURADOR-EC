import { generarRidePdf } from '../services/ride.js';
import { supabase } from '../db/supabase.js';
export async function registrarRutasRide(app) {
    /** Descarga/muestra el RIDE (PDF) de un comprobante ya creado en el sistema. */
    app.get('/comprobantes/:id/ride', async (request, reply) => {
        try {
            const pdf = await generarRidePdf(request.params.id);
            reply.header('Content-Type', 'application/pdf');
            reply.header('Content-Disposition', `inline; filename="factura-${request.params.id}.pdf"`);
            return reply.send(pdf);
        }
        catch (err) {
            request.log.error(err);
            return reply.status(404).send({
                error: 'No se pudo generar el RIDE.',
                detalle: err instanceof Error ? err.message : String(err),
            });
        }
    });
    /**
     * Descarga el XML FIRMADO tal como quedó autorizado por el SRI — es el
     * respaldo legal que la normativa exige conservar (7 años). Se guarda
     * en `comprobantes.xml_firmado` desde el momento de la emisión; este
     * endpoint solo lo entrega, no genera nada nuevo.
     */
    app.get('/comprobantes/:id/xml', async (request, reply) => {
        const { data, error } = await supabase
            .from('comprobantes')
            .select('xml_firmado, clave_acceso, secuencial')
            .eq('id', request.params.id)
            .single();
        if (error || !data) {
            return reply.status(404).send({ error: 'Comprobante no encontrado.' });
        }
        if (!data.xml_firmado) {
            return reply.status(404).send({
                error: 'Este comprobante todavía no tiene un XML firmado guardado (probablemente no llegó a autorizarse).',
            });
        }
        const nombreArchivo = data.clave_acceso || request.params.id;
        reply.header('Content-Type', 'application/xml');
        reply.header('Content-Disposition', `attachment; filename="${nombreArchivo}.xml"`);
        return reply.send(data.xml_firmado);
    });
}
//# sourceMappingURL=ride.js.map