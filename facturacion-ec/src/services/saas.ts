import { supabase } from '../db/supabase.js';
import { fechaIsoEcuador } from '../utils/fechaEcuador.js';

export type PlanSaas = {
  id: string;
  codigo: string;
  nombre: string;
  precio_mensual: number;
  precio_anual: number;
  periodicidad: 'mensual' | 'anual';
  max_documentos_mes: number | null;
  max_documentos_anio: number | null;
  max_contribuyentes: number;
  max_establecimientos: number;
  max_puntos_emision: number;
  max_usuarios: number;
  incluye_inventario: boolean;
  incluye_ats: boolean;
  incluye_carga_electronica: boolean;
  incluye_reportes_avanzados: boolean;
};

export async function obtenerPlanSaas(emisorId: string): Promise<PlanSaas | null> {
  const { data: sub } = await supabase.from('suscripciones').select('plan_id,estado,proximo_vencimiento').eq('emisor_id', emisorId).maybeSingle();
  if (!sub?.plan_id) return null;
  const { data: plan } = await supabase.from('planes_suscripcion').select('*').eq('id', sub.plan_id).maybeSingle();
  return plan as PlanSaas | null;
}

export async function comprobarLimiteDocumentos(emisorId: string): Promise<{ ok: boolean; usados: number; limite: number | null; plan?: string; mensaje?: string }> {
  const { data: sub } = await supabase.from('suscripciones')
    .select('plan_id,fecha_inicio,proximo_vencimiento,planes_suscripcion(*)')
    .eq('emisor_id', emisorId).maybeSingle();
  const plan = (sub as any)?.planes_suscripcion as PlanSaas | null;
  if (!plan) return { ok: true, usados: 0, limite: null };

  const hoy = fechaIsoEcuador();
  let desde: string;
  let hasta: string;
  let limite: number | null;
  if (plan.periodicidad === 'anual') {
    desde = String((sub as any)?.fecha_inicio ?? `${hoy.slice(0, 4)}-01-01`);
    hasta = hoy;
    limite = plan.max_documentos_anio;
  } else {
    desde = `${hoy.slice(0, 7)}-01`;
    hasta = hoy;
    limite = plan.max_documentos_mes;
  }
  if (limite == null) return { ok: true, usados: 0, limite: null, plan: plan.codigo };

  const [{ count: countFacturas, error: e1 }, { count: countComplementarios, error: e2 }] = await Promise.all([
    supabase.from('comprobantes').select('id', { count: 'exact', head: true }).eq('emisor_id', emisorId).eq('estado', 'autorizado').gte('created_at', `${desde}T00:00:00-05:00`).lte('created_at', `${hasta}T23:59:59-05:00`),
    supabase.from('documentos_sri_borrador').select('id', { count: 'exact', head: true }).eq('emisor_id', emisorId).eq('estado', 'autorizado').gte('created_at', `${desde}T00:00:00-05:00`).lte('created_at', `${hasta}T23:59:59-05:00`),
  ]);
  if (e1 || e2) throw new Error(`No se pudo comprobar el consumo del plan: ${e1?.message || e2?.message}`);
  const usados = (countFacturas ?? 0) + (countComplementarios ?? 0);
  if (usados >= limite) {
    const unidad = plan.periodicidad === 'anual' ? 'anual' : 'mensual';
    return { ok: false, usados, limite, plan: plan.codigo, mensaje: `Has alcanzado el límite ${unidad} de ${limite} comprobantes del plan ${plan.nombre}.` };
  }
  return { ok: true, usados, limite, plan: plan.codigo };
}

export async function comprobarCaracteristica(emisorId: string, caracteristica: 'ats' | 'inventario'): Promise<{ ok: boolean; plan?: PlanSaas; mensaje?: string }> {
  const plan = await obtenerPlanSaas(emisorId);
  if (!plan) return { ok: true };
  const ok = caracteristica === 'ats' ? plan.incluye_ats : plan.incluye_inventario;
  if (!ok) return { ok: false, plan, mensaje: `La función ${caracteristica.toUpperCase()} no está incluida en el plan ${plan.nombre}.` };
  return { ok: true, plan };
}

export async function contarContribuyentes(cuentaId: string) {
  const { count, error } = await supabase.from('contribuyentes_cliente_saas').select('id', { count: 'exact', head: true }).eq('cuenta_id', cuentaId).eq('activo', true);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function contarEstablecimientos(emisorId: string) {
  const { count, error } = await supabase.from('establecimientos_emisor').select('id', { count: 'exact', head: true }).eq('emisor_id', emisorId).eq('activo', true);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function contarPuntos(emisorId: string) {
  const { count, error } = await supabase.from('puntos_emision').select('id', { count: 'exact', head: true }).eq('emisor_id', emisorId).eq('activo', true);
  if (error) throw new Error(error.message);
  return count ?? 0;
}
