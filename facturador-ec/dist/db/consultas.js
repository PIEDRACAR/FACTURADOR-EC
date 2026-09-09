import { supabase } from './supabase.js';
export async function obtenerEmisor(emisorId) {
    const { data, error } = await supabase.from('emisores').select('*').eq('id', emisorId).single();
    if (error || !data) {
        throw new Error(`No se encontró el emisor ${emisorId}: ${error?.message ?? 'sin datos'}`);
    }
    return data;
}
export async function obtenerPuntoEmisionActivo(emisorId, puntoEmisionId) {
    let consulta = supabase
        .from('puntos_emision')
        .select('*')
        .eq('emisor_id', emisorId)
        .eq('activo', true);
    if (puntoEmisionId)
        consulta = consulta.eq('id', puntoEmisionId);
    const { data, error } = await consulta.order('establecimiento').order('punto_emision').limit(1).maybeSingle();
    if (error || !data) {
        throw new Error(`El emisor ${emisorId} no tiene un punto de emisión activo configurado.`);
    }
    return data;
}
//# sourceMappingURL=consultas.js.map