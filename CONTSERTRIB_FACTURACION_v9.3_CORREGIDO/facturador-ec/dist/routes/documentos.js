import { supabase } from '../db/supabase.js';
import { emitirDocumentoSri, normalizarDatosDocumento } from '../services/documentosSri.js';
const TIPOS = new Set(['nota_credito', 'nota_debito', 'liquidacion_compra', 'guia_remision', 'retencion']);
const ESTADOS = new Set(['borrador', 'listo', 'procesando', 'autorizado', 'rechazado', 'devuelto', 'anulado']);
export async function registrarRutasDocumentos(app) {
    app.get('/api/documentos', async (request, reply) => {
        const { emisorId, tipo } = request.query;
        if (!emisorId)
            return reply.status(400).send({ error: 'Falta emisorId.' });
        let q = supabase.from('documentos_sri_borrador').select('*').eq('emisor_id', emisorId).order('created_at', { ascending: false }).limit(100);
        if (tipo && TIPOS.has(tipo))
            q = q.eq('tipo', tipo);
        const { data, error } = await q;
        if (error)
            return reply.status(500).send({ error: error.message });
        return reply.send(data ?? []);
    });
    app.post('/api/documentos', async (request, reply) => {
        const b = request.body ?? {};
        if (!b.emisorId || !b.tipo || !TIPOS.has(b.tipo))
            return reply.status(400).send({ error: 'Tipo de comprobante no válido.' });
        const datos = normalizarDatosDocumento(b.tipo, b.datos ?? {});
        const { data, error } = await supabase.from('documentos_sri_borrador').insert({ emisor_id: b.emisorId, tipo: b.tipo, cliente_id: b.clienteId || null, comprobante_sustento_id: b.comprobanteSustentoId || null, datos, estado: 'borrador' }).select('id').single();
        if (error || !data)
            return reply.status(500).send({ error: error?.message ?? 'No se pudo guardar el documento.' });
        return reply.status(201).send({ ok: true, id: data.id, mensaje: 'Borrador guardado.' });
    });
    app.patch('/api/documentos/:id', async (request, reply) => {
        const cambios = {};
        if (request.body?.estado && ESTADOS.has(request.body.estado))
            cambios.estado = request.body.estado;
        if (request.body?.datos)
            cambios.datos = normalizarDatosDocumento('', request.body.datos);
        const { error } = await supabase.from('documentos_sri_borrador').update(cambios).eq('id', request.params.id);
        if (error)
            return reply.status(500).send({ error: error.message });
        return reply.send({ ok: true });
    });
    app.post('/api/documentos/:id/emitir', async (request, reply) => {
        const { data: doc, error } = await supabase.from('documentos_sri_borrador').select('*').eq('id', request.params.id).single();
        if (error || !doc)
            return reply.status(404).send({ error: 'Documento no encontrado.' });
        if (doc.estado === 'autorizado')
            return reply.status(409).send({ error: 'El documento ya fue autorizado; no se debe emitir nuevamente.' });
        await supabase.from('documentos_sri_borrador').update({ estado: 'procesando', motivo_error: null }).eq('id', doc.id);
        try {
            const result = await emitirDocumentoSri(doc.emisor_id, doc.tipo, normalizarDatosDocumento(doc.tipo, doc.datos ?? {}));
            const estado = result.estado === 'AUTORIZADO' ? 'autorizado' : result.estado === 'DEVUELTA' ? 'devuelto' : 'rechazado';
            await supabase.from('documentos_sri_borrador').update({ estado, secuencial: result.secuencial, clave_acceso: result.claveAcceso, numero_autorizacion: result.numeroAutorizacion, xml_firmado: result.xmlFirmado, xml_original: result.xmlOriginal, fecha_autorizacion: result.fechaAutorizacion ?? null, motivo_error: result.estado === 'AUTORIZADO' ? null : (result.mensaje ?? JSON.stringify(result)) }).eq('id', doc.id);
            return reply.send({ ok: estado === 'autorizado', estado, ...result });
        }
        catch (e) {
            const mensaje = e instanceof Error ? e.message : String(e);
            await supabase.from('documentos_sri_borrador').update({ estado: 'rechazado', motivo_error: mensaje }).eq('id', doc.id);
            return reply.status(422).send({ ok: false, error: mensaje });
        }
    });
}
//# sourceMappingURL=documentos.js.map