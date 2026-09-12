import { supabase } from '../db/supabase.js';

export async function registrarAuditoriaSaas(input: {
  userId?: string | null;
  emisorId?: string | null;
  evento: string;
  recurso?: string;
  recursoId?: string | null;
  detalle?: Record<string, unknown>;
}) {
  try {
    await supabase.from('auditoria_saas').insert({
      user_id: input.userId ?? null,
      emisor_id: input.emisorId ?? null,
      evento: input.evento,
      recurso: input.recurso ?? null,
      recurso_id: input.recursoId ?? null,
      detalle: input.detalle ?? {},
    });
  } catch {
    // La auditoría nunca debe tumbar una operación comercial válida.
  }
}
