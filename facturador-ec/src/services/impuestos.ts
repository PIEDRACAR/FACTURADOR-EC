import { supabase } from '../db/supabase.js';

export type PerfilIva = 'GENERAL' | 'TURISMO' | 'FIJA_5' | 'CERO' | 'EXENTO' | 'NO_OBJETO';

export interface ReglaIva {
  id: string;
  clave: string;
  nombre: string;
  porcentaje: number;
  codigo_sri: string;
  tipo: 'GENERAL' | 'FIJA' | 'TURISMO' | 'CERO' | 'EXENTO' | 'NO_OBJETO';
  fecha_inicio: string;
  fecha_fin: string | null;
  activo: boolean;
  prioridad: number;
  norma_referencia: string | null;
  descripcion: string | null;
}

export interface ContextoImpuesto {
  emisorId: string;
  fecha: string;
  perfil: PerfilIva;
}

function normalizarFecha(v: string): string {
  return String(v).slice(0, 10);
}

async function obtenerEmisorTributario(emisorId: string) {
  const { data, error } = await supabase.from('emisores').select('actividad_turistica,registro_turismo,luaf_vigente').eq('id', emisorId).single();
  if (error) throw new Error(`No se pudo leer la configuración tributaria del emisor: ${error.message}`);
  return data;
}

async function reglasVigentes(fecha: string): Promise<ReglaIva[]> {
  const f = normalizarFecha(fecha);
  const { data, error } = await supabase.from('reglas_iva').select('*').eq('activo', true).lte('fecha_inicio', f).or(`fecha_fin.is.null,fecha_fin.gte.${f}`).order('prioridad', { ascending: true }).order('fecha_inicio', { ascending: false });
  if (error) throw new Error(`No se pudo leer el catálogo tributario: ${error.message}`);
  return (data ?? []) as ReglaIva[];
}

export async function resolverIva(ctx: ContextoImpuesto) {
  const reglas = await reglasVigentes(ctx.fecha);
  const emisor = await obtenerEmisorTributario(ctx.emisorId);
  const perfil = ctx.perfil;

  if (perfil === 'CERO') return reglaObligatoria(reglas, r => r.tipo === 'CERO', 'No existe una regla IVA 0% vigente.');
  if (perfil === 'EXENTO') return reglaObligatoria(reglas, r => r.tipo === 'EXENTO', 'No existe una regla de IVA exento vigente.');
  if (perfil === 'NO_OBJETO') return reglaObligatoria(reglas, r => r.tipo === 'NO_OBJETO', 'No existe una regla de no objeto vigente.');
  if (perfil === 'FIJA_5') return reglaObligatoria(reglas, r => r.clave === 'IVA_5_CONSTRUCCION' || (r.tipo === 'FIJA' && Number(r.porcentaje) === 5), 'No existe una regla IVA 5% vigente.');

  if (perfil === 'TURISMO') {
    const elegible = Boolean(emisor?.actividad_turistica && emisor?.registro_turismo && emisor?.luaf_vigente);
    if (elegible) {
      const reducida = reglas.find(r => r.tipo === 'TURISMO');
      if (reducida) return reducida;
    }
    return reglaObligatoria(reglas, r => r.tipo === 'GENERAL', 'No existe una tarifa general de IVA vigente.');
  }

  return reglaObligatoria(reglas, r => r.tipo === 'GENERAL', 'No existe una tarifa general de IVA vigente.');
}

function reglaObligatoria(reglas: ReglaIva[], pred: (r: ReglaIva) => boolean, mensaje: string): ReglaIva {
  const regla = reglas.find(pred);
  if (!regla) throw new Error(mensaje);
  return regla;
}

export function perfilDesdeTarifa(tarifa: string | null | undefined): PerfilIva {
  switch (String(tarifa ?? '15')) {
    case '0': return 'CERO';
    case '5': return 'FIJA_5';
    case '8': return 'TURISMO';
    case 'exento': return 'EXENTO';
    case 'no_objeto': return 'NO_OBJETO';
    default: return 'GENERAL';
  }
}

export function codigoSRI(regla: ReglaIva): string { return String(regla.codigo_sri); }
export function porcentajeDecimal(regla: ReglaIva): number { return Number(regla.porcentaje) / 100; }
export function redondearImpuesto(v: number): number { return Math.round(v * 100) / 100; }
