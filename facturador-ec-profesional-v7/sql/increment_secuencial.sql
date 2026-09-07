-- ============================================
-- Migración adicional: función atómica para incrementar secuenciales
-- Requerida por src/sequence/supabaseSequenceProvider.ts
-- Ejecutar DESPUÉS de setup-supabase-facturador.sql
-- ============================================

-- `columna` viene de una lista fija controlada por el propio backend
-- (COLUMNA_POR_TIPO en supabaseSequenceProvider.ts), nunca directamente
-- de un input de usuario final, así que el uso de identificador dinámico
-- aquí es seguro frente a inyección SQL.
--
-- Se filtra también por emisor_id: aunque `puntos_emision` ya tiene una
-- restricción UNIQUE(emisor_id, establecimiento, punto_emision), dos
-- emisores distintos SÍ pueden compartir el mismo "001"-"001" (es lo más
-- común, de hecho), así que sin este filtro dos negocios distintos
-- terminarían compartiendo — e inflando incorrectamente — el mismo
-- contador de secuenciales.
create or replace function increment_secuencial(
  p_emisor_id uuid,
  p_establecimiento char(3),
  p_punto_emision char(3),
  p_columna text
)
returns integer
language plpgsql
as $$
declare
  v_nuevo_valor integer;
  v_columnas_permitidas text[] := array[
    'secuencial_factura',
    'secuencial_nota_credito',
    'secuencial_nota_debito',
    'secuencial_guia_remision',
    'secuencial_retencion',
    'secuencial_proforma'
  ];
begin
  if not (p_columna = any(v_columnas_permitidas)) then
    raise exception 'Columna de secuencial no permitida: %', p_columna;
  end if;

  execute format(
    'update puntos_emision
       set %1$I = %1$I + 1
     where emisor_id = $1
       and establecimiento = $2
       and punto_emision = $3
       and activo = true
     returning %1$I',
    p_columna
  )
  into v_nuevo_valor
  using p_emisor_id, p_establecimiento, p_punto_emision;

  if v_nuevo_valor is null then
    raise exception
      'No se encontró un punto de emisión activo % - % para el emisor % (¿inactivo o inexistente?)',
      p_establecimiento, p_punto_emision, p_emisor_id;
  end if;

  return v_nuevo_valor;
end;
$$;
