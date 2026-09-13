-- ============================================
-- MIGRACIÓN: creación de venta + descuento de inventario, en una sola
-- transacción atómica de Postgres.
-- Ejecutar en el SQL Editor de Supabase (una sola vez).
--
-- POR QUÉ: hasta ahora, POST /pos/venta hacía varios `insert` separados
-- desde JavaScript (comprobante, luego items, luego pagos) sin descontar
-- inventario. Si algo fallaba a mitad de camino (por ejemplo, se creaba el
-- comprobante pero fallaban los items), quedaba una venta a medias en la
-- base de datos. Empaquetar todo en una sola función de Postgres (llamada
-- por RPC) hace que sea todo-o-nada: o se crea la venta completa con su
-- inventario descontado, o no se crea nada.
--
-- El descuento de stock usa `where stock_actual >= cantidad` en el UPDATE
-- mismo, que es la forma atómica correcta de evitar que dos ventas
-- simultáneas vendan más unidades de las que hay — el mismo patrón ya
-- usado en increment_secuencial.sql para los secuenciales.
-- ============================================

create or replace function crear_venta(
  p_emisor_id uuid,
  p_punto_emision_id uuid,
  p_cliente_id uuid,
  p_tipo text,
  p_subtotal_0 numeric,
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
    subtotal_0, subtotal_15, total_descuento, total_iva, propina, importe_total, estado
  ) values (
    p_emisor_id, p_punto_emision_id, p_tipo, null, p_cliente_id,
    p_subtotal_0, p_subtotal_15, p_total_descuento, p_total_iva, p_propina, p_importe_total, 'generado'
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

    -- Las líneas libres (sin producto de catálogo) no descuentan inventario.
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
