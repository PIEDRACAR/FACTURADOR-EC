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

export async function obtenerPuntoEmisionActivo(emisorId: string, puntoEmisionId?: string): Promise<PuntoEmisionRow> {
  let consulta = supabase
    .from('puntos_emision')
    .select('*')
    .eq('emisor_id', emisorId)
    .eq('activo', true);

  if (puntoEmisionId) consulta = consulta.eq('id', puntoEmisionId);

  const { data, error } = await consulta.order('establecimiento').order('punto_emision').limit(1).maybeSingle();

  if (error || !data) {
    throw new Error(`El emisor ${emisorId} no tiene un punto de emisión activo configurado.`);
  }

  // El SRI exige dirEstablecimiento con al menos 1 carácter. En bases
  // antiguas existen puntos de emisión cuyo campo direccion quedó vacío,
  // aunque la matriz/establecimiento sí tenga una dirección válida.
  // Aplicamos una cascada segura y reparamos el registro para que el
  // problema no vuelva a aparecer en la siguiente emisión.
  let direccion = String(data.direccion ?? '').trim();
  if (!direccion) {
    const { data: establecimiento } = await supabase
      .from('establecimientos_emisor')
      .select('direccion')
      .eq('emisor_id', emisorId)
      .eq('codigo', data.establecimiento)
      .maybeSingle();
    direccion = String(establecimiento?.direccion ?? '').trim();
  }

  if (!direccion) {
    const { data: emisor } = await supabase
      .from('emisores')
      .select('direccion_matriz')
      .eq('id', emisorId)
      .maybeSingle();
    direccion = String(emisor?.direccion_matriz ?? '').trim();
  }

  if (!direccion) {
    throw new Error(
      `El punto de emisión ${data.establecimiento}-${data.punto_emision} no tiene dirección. ` +
      'Configure la dirección del establecimiento/matriz antes de emitir al SRI.'
    );
  }

  if (direccion.length > 300) {
    throw new Error('La dirección del establecimiento supera los 300 caracteres permitidos por el SRI.');
  }

  if (direccion !== String(data.direccion ?? '').trim()) {
    const { error: reparacionError } = await supabase
      .from('puntos_emision')
      .update({ direccion })
      .eq('id', data.id)
      .eq('emisor_id', emisorId);
    if (reparacionError) {
      // La emisión no debe bloquearse si el dato ya pudo resolverse; el XML
      // recibirá la dirección correcta aunque la reparación persistente falle.
      console.warn('[SRI] No se pudo persistir la dirección recuperada del punto de emisión:', reparacionError.message);
    }
  }

  return { ...data, direccion };
}
