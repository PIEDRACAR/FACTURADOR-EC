-- ============================================
-- MIGRACIÓN: agregar la tarifa de IVA 5% al sistema
-- Ejecutar en el SQL Editor de Supabase (una sola vez).
--
-- POR QUÉ: la normativa ecuatoriana vigente contempla, además del 0% y el
-- 15% (tarifa general desde 2024, ratificada para 2026 por Circular del
-- SRI NAC-DGECCGC25-00000006), una tarifa reducida del 5% para materiales
-- de construcción. Ni la columna `productos.tarifa_iva` ni la tabla
-- `comprobantes` (que solo separaba subtotal_0 y subtotal_15) contemplaban
-- esta tarifa.
--
-- Código de porcentaje SRI correspondiente (Ficha Técnica de Comprobantes
-- Electrónicos): 0% → código 0 · 15% → código 4 · 5% → código 5 ·
-- Exento → código 7 · No objeto de impuesto → código 6.
-- ============================================

alter table productos drop constraint if exists productos_tarifa_iva_check;
alter table productos add constraint productos_tarifa_iva_check
  check (tarifa_iva in ('0', '5', '15', 'exento', 'no_objeto'));

alter table comprobantes add column if not exists subtotal_5 numeric(12,2) not null default 0;

-- La función crear_venta cambia de firma (nuevo parámetro p_subtotal_5),
-- así que hay que eliminar la versión anterior antes de recrearla —
-- CREATE OR REPLACE no permite cambiar la lista de parámetros.
drop function if exists crear_venta(uuid, uuid, uuid, text, numeric, numeric, numeric, numeric, numeric, numeric, jsonb, jsonb);

create or replace function crear_venta(
  p_emisor_id uuid,
  p_punto_emision_id uuid,
  p_cliente_id uuid,
  p_tipo text,
  p_subtotal_0 numeric,
  p_subtotal_5 numeric,
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
    subtotal_0, subtotal_5, subtotal_15, total_descuento, total_iva, propina, importe_total, estado
  ) values (
    p_emisor_id, p_punto_emision_id, p_tipo, null, p_cliente_id,
    p_subtotal_0, p_subtotal_5, p_subtotal_15, p_total_descuento, p_total_iva, p_propina, p_importe_total, 'generado'
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

