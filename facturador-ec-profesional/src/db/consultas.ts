import { supabase } from './supabase.js';

export interface EmisorRow {
  id: string;
  ruc: string;
  razon_social: string;
  nombre_comercial: string | null;
  direccion_matriz: string;
  contribuyente_especial: string | null;
  obligado_contabilidad: boolean;
  agente_retencion: boolean;
  ambiente: 'pruebas' | 'produccion';
}

export interface PuntoEmisionRow {
  id: string;
  emisor_id: string;
  establecimiento: string;
  punto_emision: string;
  direccion: string;
}

export async function obtenerEmisor(emisorId: string): Promise<EmisorRow> {
  const { data, error } = await supabase.from('emisores').select('*').eq('id', emisorId).single();
  if (error || !data) {
    throw new Error(`No se encontró el emisor ${emisorId}: ${error?.message ?? 'sin datos'}`);
  }
  return data;
}

export async function obtenerPuntoEmisionActivo(emisorId: string): Promise<PuntoEmisionRow> {
  const { data, error } = await supabase
    .from('puntos_emision')
    .select('*')
    .eq('emisor_id', emisorId)
    .eq('activo', true)
    .limit(1)
    .single();

  if (error || !data) {
    throw new Error(`El emisor ${emisorId} no tiene un punto de emisión activo configurado.`);
  }
  return data;
}
