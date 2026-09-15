import { supabase } from '../db/supabase.js';
import { fechaIsoEcuador } from '../utils/fechaEcuador.js';

export type ResolucionIva = {
  tarifa: string;
  porcentaje: number;
  codigoPorcentaje: string;
  reglaId: string | null;
  categoria: string;
  nombre: string;
  baseLegal: string | null;
  advertencias: string[];
};

function num(v: unknown) { const n=Number(v); return Number.isFinite(n)?n:0; }

export async function resolverIva(emisorId: string, tarifaProducto: string, fecha = fechaIsoEcuador()): Promise<ResolucionIva> {
  const base = String(tarifaProducto || 'general').toLowerCase();
  const { data: perfil } = await supabase.from('perfil_tributario_emisor').select('*').eq('emisor_id', emisorId).maybeSingle();
  const advertencias: string[] = [];

  if (base === '0' || base === 'exento' || base === 'no_objeto') {
    const mapa:any={ '0':['0',0,'0%'],'exento':['exento',0,'Exento'],'no_objeto':['no_objeto',0,'No objeto de IVA'] };
    const x=mapa[base]; return { tarifa:x[0], porcentaje:x[1], codigoPorcentaje:x[2], reglaId:null, categoria:base.toUpperCase(), nombre:x[2], baseLegal:null, advertencias };
  }

  if (base === 'general' || base === '15') {
    // Primero una regla turística temporal, solo si el contribuyente está habilitado.
    if (perfil?.es_turistico && perfil?.registro_turismo && perfil?.luaf_vigente) {
      const { data: turismo } = await supabase.from('reglas_tributarias_ecuador').select('*')
        .eq('impuesto','IVA').eq('categoria','TURISMO').eq('activo',true)
        .lte('fecha_inicio',fecha).or(`fecha_fin.is.null,fecha_fin.gte.${fecha}`)
        .order('prioridad',{ascending:true}).limit(1).maybeSingle();
      if (turismo) return { tarifa:String(turismo.tarifa), porcentaje:num(turismo.tarifa)/100, codigoPorcentaje:String(turismo.codigo_porcentaje), reglaId:turismo.id, categoria:'TURISMO', nombre:turismo.nombre, baseLegal:turismo.base_legal, advertencias };
    }
    const { data: general } = await supabase.from('reglas_tributarias_ecuador').select('*')
      .eq('impuesto','IVA').eq('categoria','GENERAL').eq('activo',true)
      .lte('fecha_inicio',fecha).or(`fecha_fin.is.null,fecha_fin.gte.${fecha}`)
      .order('prioridad',{ascending:true}).limit(1).maybeSingle();
    if (general) return { tarifa:String(general.tarifa), porcentaje:num(general.tarifa)/100, codigoPorcentaje:String(general.codigo_porcentaje), reglaId:general.id, categoria:'GENERAL', nombre:general.nombre, baseLegal:general.base_legal, advertencias };
    advertencias.push('No existe una regla general vigente para la fecha indicada.');
    return { tarifa:'15',porcentaje:.15,codigoPorcentaje:'4',reglaId:null,categoria:'GENERAL',nombre:'IVA general (respaldo)',baseLegal:null,advertencias };
  }

  const porcentaje=num(base);
  const { data: fija } = await supabase.from('reglas_tributarias_ecuador').select('*').eq('impuesto','IVA').eq('activo',true)
    .eq('tarifa',porcentaje).lte('fecha_inicio',fecha).or(`fecha_fin.is.null,fecha_fin.gte.${fecha}`).order('prioridad',{ascending:true}).limit(1).maybeSingle();
  if (fija) return { tarifa:String(fija.tarifa), porcentaje:fija.tarifa/100, codigoPorcentaje:String(fija.codigo_porcentaje), reglaId:fija.id, categoria:fija.categoria, nombre:fija.nombre, baseLegal:fija.base_legal, advertencias };
  advertencias.push(`La tarifa ${base}% no tiene regla SRI configurada para ${fecha}.`);
  return { tarifa:base, porcentaje:porcentaje/100, codigoPorcentaje:base === '15' ? '4' : base === '8' ? '8' : base === '5' ? '5' : '', reglaId:null, categoria:'CONFIGURADA', nombre:`IVA ${base}%`, baseLegal:null, advertencias };
}

export async function obtenerMotorResumen(emisorId: string) {
  const hoy=fechaIsoEcuador();
  const [{ data: reglas }, { data: perfil }, { data: feriados }] = await Promise.all([
    supabase.from('reglas_tributarias_ecuador').select('*').eq('activo',true).order('fecha_inicio',{ascending:false}).order('prioridad'),
    supabase.from('perfil_tributario_emisor').select('*').eq('emisor_id',emisorId).maybeSingle(),
    supabase.from('feriados_ecuador').select('*').eq('activo',true).gte('fecha',`${hoy.slice(0,4)}-01-01`).lte('fecha',`${hoy.slice(0,4)}-12-31`).order('fecha')
  ]);
  return { fecha:hoy, perfil:perfil ?? null, reglas:reglas ?? [], feriados:feriados ?? [] };
}
