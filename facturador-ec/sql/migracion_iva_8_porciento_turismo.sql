-- ============================================
-- MIGRACIÓN: agregar la tarifa de IVA 8% (turismo en feriados) al sistema
-- Ejecutar en el SQL Editor de Supabase (una sola vez).
--
-- POR QUÉ: el Presidente de la República puede reducir el IVA del 15% al
-- 8% para actividades turísticas durante feriados puntuales (hasta 12
-- días al año), mediante decreto ejecutivo específico para cada feriado
-- — no es una tarifa permanente ni automática. Código de porcentaje SRI: 8.
--
-- ⚠️ IMPORTANTE — ELEGIBILIDAD (verificar antes de asignar esta tarifa a
-- un producto/servicio):
--   1. El negocio debe estar inscrito en el Registro Nacional de Turismo
--      y contar con Licencia Única Anual de Funcionamiento (LUAF).
--   2. La actividad debe ser una de las contempladas en el art. 5 de la
--      Ley de Turismo (alojamiento, alimentos y bebidas, transporte
--      turístico, agenciamiento, eventos, parques temáticos, etc.).
--   3. Solo aplica durante las fechas EXACTAS que el decreto ejecutivo de
--      cada feriado señale (varían cada vez — verificar el decreto vigente
--      antes de facturar con esta tarifa).
-- Aplicarla fuera de estas condiciones es una infracción sancionable.
-- ============================================

alter table productos drop constraint if exists productos_tarifa_iva_check;
alter table productos add constraint productos_tarifa_iva_check
  check (tarifa_iva in ('0', '5', '8', '15', 'exento', 'no_objeto'));

alter table comprobantes add column if not exists subtotal_8 numeric(12,2) not null default 0;

-- Nueva firma de crear_venta (agrega p_subtotal_8) — hay que eliminar la
-- versión anterior antes de recrearla.
drop function if exists crear_venta(uuid, uuid, uuid, text, numeric, numeric, numeric, numeric, numeric, numeric, jsonb, jsonb);

create or replace function crear_venta(
  p_emisor_id uuid,
  p_punto_emision_id uuid,
  p_cliente_id uuid,
  p_tipo text,
  p_subtotal_0 numeric,
  p_subtotal_5 numeric,
  p_subtotal_8 numeric,
  p_subtotal_15 numeric,
  p_total_descuento numeric,
  p_total_iva numeric,
  p_propina numeric,
  p_importe_total numeric,
  p_items jsonb,
  p_pagos jsonb
) returns uuid
language plpgsql
as $$
declare
  v_comprobante_id uuid;
  v_item jsonb;
  v_pago jsonb;
  v_producto_id uuid;
  v_cantidad numeric;
  v_stock_resultante numeric;
  v_costo_promedio numeric;
begin
  insert into comprobantes (
    emisor_id, punto_emision_id, tipo, secuencial, cliente_id,
    subtotal_0, subtotal_5, subtotal_8, subtotal_15, total_descuento, total_iva, propina, importe_total, estado
  ) values (
    p_emisor_id, p_punto_emision_id, p_tipo, null, p_cliente_id,
    p_subtotal_0, p_subtotal_5, p_subtotal_8, p_subtotal_15, p_total_descuento, p_total_iva, p_propina, p_importe_total, 'generado'
  )
  returning id into v_comprobante_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_producto_id := nullif(v_item->>'producto_id', '')::uuid;
    v_cantidad := (v_item->>'cantidad')::numeric;

    insert into comprobante_items (
      comprobante_id, producto_id, descripcion, cantidad, precio_unitario,
      descuento, precio_total_sin_impuesto, costo_unitario_momento, tarifa_iva, valor_iva
    ) values (
      v_comprobante_id, v_producto_id, v_item->>'descripcion', v_cantidad,
      (v_item->>'precio_unitario')::numeric, (v_item->>'descuento')::numeric,
      (v_item->>'precio_total_sin_impuesto')::numeric, (v_item->>'costo_unitario_momento')::numeric,
      v_item->>'tarifa_iva', (v_item->>'valor_iva')::numeric
    );

    if v_producto_id is not null then
      update productos
        set stock_actual = stock_actual - v_cantidad
        where id = v_producto_id and stock_actual >= v_cantidad
        returning stock_actual, costo_promedio into v_stock_resultante, v_costo_promedio;

      if not found then
        raise exception 'stock_insuficiente:%', v_producto_id;
      end if;

      insert into movimientos_inventario (
        emisor_id, producto_id, tipo, cantidad, costo_unitario,
        saldo_cantidad, saldo_costo_promedio, referencia_tipo, referencia_id
      ) values (
        p_emisor_id, v_producto_id, 'salida', v_cantidad,
        (v_item->>'costo_unitario_momento')::numeric, v_stock_resultante, v_costo_promedio,
        'comprobante', v_comprobante_id
      );
    end if;
  end loop;

  for v_pago in select * from jsonb_array_elements(p_pagos)
  loop
    insert into comprobante_formas_pago (comprobante_id, forma_pago_codigo, valor)
    values (v_comprobante_id, v_pago->>'forma_pago_codigo', (v_pago->>'valor')::numeric);
  end loop;

  return v_comprobante_id;
end;
$$;
