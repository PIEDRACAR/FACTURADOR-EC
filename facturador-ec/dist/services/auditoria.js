import { supabase } from '../db/supabase.js';
/** Registro inmutable de acciones críticas. Si la tabla aún no existe, no rompe la operación principal. */
export async function registrarAuditoria(evento) {
    try {
        await supabase.from('auditoria_sri').insert({
            emisor_id: evento.emisorId,
            user_id: evento.userId ?? null,
            usuario_email: evento.usuarioEmail ?? null,
            tipo_documento: evento.tipoDocumento ?? 'FACTURA',
            evento: evento.evento,
            estado: evento.estado ?? null,
            clave_acceso: evento.claveAcceso ?? null,
            secuencial: evento.secuencial ?? null,
            comprobante_id: evento.comprobanteId ?? null,
            documento_id: evento.documentoId ?? null,
            detalle: evento.detalle ?? {},
        });
    }
    catch {
        // La auditoría nunca debe impedir una operación tributaria ya realizada.
    }
}
//# sourceMappingURL=auditoria.js.map