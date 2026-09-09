import { supabase } from '../db/supabase.js';
function normalizarFecha(v) {
    return String(v).slice(0, 10);
}
async function obtenerEmisorTributario(emisorId) {
    const { data, error } = await supabase.from('emisores').select('actividad_turistica,registro_turismo,luaf_vigente').eq('id', emisorId).single();
    if (error)
        throw new Error(`No se pudo leer la configuración tributaria del emisor: ${error.message}`);
    return data;
}
async function reglasVigentes(fecha) {
    const f = normalizarFecha(fecha);
    const { data, error } = await supabase.from('reglas_iva').select('*').eq('activo', true).lte('fecha_inicio', f).or(`fecha_fin.is.null,fecha_fin.gte.${f}`).order('prioridad', { ascending: true }).order('fecha_inicio', { ascending: false });
    if (error)
        throw new Error(`No se pudo leer el catálogo tributario: ${error.message}`);
    return (data ?? []);
}
export async function resolverIva(ctx) {
    const reglas = await reglasVigentes(ctx.fecha);
    const emisor = await obtenerEmisorTributario(ctx.emisorId);
    const perfil = ctx.perfil;
    if (perfil === 'CERO')
        return reglaObligatoria(reglas, r => r.tipo === 'CERO', 'No existe una regla IVA 0% vigente.');
    if (perfil === 'EXENTO')
        return reglaObligatoria(reglas, r => r.tipo === 'EXENTO', 'No existe una regla de IVA exento vigente.');
    if (perfil === 'NO_OBJETO')
        return reglaObligatoria(reglas, r => r.tipo === 'NO_OBJETO', 'No existe una regla de no objeto vigente.');
    if (perfil === 'FIJA_5')
        return reglaObligatoria(reglas, r => r.clave === 'IVA_5_CONSTRUCCION' || (r.tipo === 'FIJA' && Number(r.porcentaje) === 5), 'No existe una regla IVA 5% vigente.');
    if (perfil === 'TURISMO') {
        const elegible = Boolean(emisor?.actividad_turistica && emisor?.registro_turismo && emisor?.luaf_vigente);
        if (elegible) {
            const reducida = reglas.find(r => r.tipo === 'TURISMO');
            if (reducida)
                return reducida;
        }
        return reglaObligatoria(reglas, r => r.tipo === 'GENERAL', 'No existe una tarifa general de IVA vigente.');
    }
    return reglaObligatoria(reglas, r => r.tipo === 'GENERAL', 'No existe una tarifa general de IVA vigente.');
}
function reglaObligatoria(reglas, pred, mensaje) {
    const regla = reglas.find(pred);
    if (!regla)
        throw new Error(mensaje);
    return regla;
}
export function perfilDesdeTarifa(tarifa) {
    switch (String(tarifa ?? '15')) {
        case '0': return 'CERO';
        case '5': return 'FIJA_5';
        case '8': return 'TURISMO';
        case 'exento': return 'EXENTO';
        case 'no_objeto': return 'NO_OBJETO';
        default: return 'GENERAL';
    }
}
export function codigoSRI(regla) { return String(regla.codigo_sri); }
export function porcentajeDecimal(regla) { return Number(regla.porcentaje) / 100; }
export function redondearImpuesto(v) { return Math.round(v * 100) / 100; }
//# sourceMappingURL=impuestos.js.map