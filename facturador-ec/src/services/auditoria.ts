import { supabase } from '../db/supabase.js';

export interface EventoAuditoria {
  emisorId: string;
  userId?: string | null;
  usuarioEmail?: string | null;
  tipoDocumento?: string | null;
  evento: string;
  estado?: string | null;
  claveAcceso?: string | null;
  secuencial?: string | null;
  comprobanteId?: string | null;
  documentoId?: string | null;
  detalle?: Record<string, unknown>;
}

/** Registro inmutable de acciones críticas. Si la tabla aún no existe, no rompe la operación principal. */
export async function registrarAuditoria(evento: EventoAuditoria): Promise<void> {
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
  } catch {
    // La auditoría nunca debe impedir una operación tributaria ya realizada.
  }
}
