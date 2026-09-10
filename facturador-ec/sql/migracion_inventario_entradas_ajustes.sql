-- ============================================
-- MIGRACIÓN: módulo de entradas y ajustes de inventario
-- Ejecutar en el SQL Editor de Supabase (una sola vez).
--
-- Hasta ahora el stock solo se podía DESCONTAR (al vender). No existía
-- forma de registrar una compra/entrada de mercadería con su costo, ni un
-- ajuste por conteo físico — solo editar el número a mano en el catálogo,
-- lo cual no queda registrado como movimiento ni recalcula el costo
-- promedio correctamente.
--
-- Igual que con `crear_venta`, todo se hace en una función de Postgres con
-- bloqueo de fila (`for update`) para que dos entradas/ventas simultáneas
-- del mismo producto no puedan pisarse una a la otra.
-- ============================================

alter table movimientos_inventario add column if not exists nota text;

-- --------------------------------------------
-- Entrada de mercadería (compra): suma stock y recalcula el costo
-- promedio ponderado — la fórmula estándar de costeo:
--   nuevo_costo = (stock_actual*costo_actual + cantidad*costo_entrada)
--                 / (stock_actual + cantidad)
-- --------------------------------------------
create or replace function registrar_entrada_inventario(
  p_producto_id uuid,
  p_cantidad numeric,
  p_costo_unitario numeric,
  p_nota text
) returns table(stock_resultante numeric, costo_promedio_resultante numeric)
language plpgsql
as $$
declare
  v_emisor_id uuid;
  v_stock_actual numeric;
  v_costo_actual numeric;
  v_nuevo_stock numeric;
  v_nuevo_costo numeric;
begin
  if p_cantidad <= 0 then
    raise exception 'cantidad_invalida:la cantidad de entrada debe ser mayor a 0';
  end if;

  select emisor_id, stock_actual, costo_promedio into v_emisor_id, v_stock_actual, v_costo_actual
  from productos where id = p_producto_id
  for update;

  if not found then
    raise exception 'producto_no_encontrado:%', p_producto_id;
  end if;

  v_nuevo_stock := v_stock_actual + p_cantidad;
  v_nuevo_costo := ((v_stock_actual * v_costo_actual) + (p_cantidad * p_costo_unitario)) / v_nuevo_stock;

  update productos set stock_actual = v_nuevo_stock, costo_promedio = v_nuevo_costo where id = p_producto_id;

  insert into movimientos_inventario (
    emisor_id, producto_id, tipo, cantidad, costo_unitario,
    saldo_cantidad, saldo_costo_promedio, referencia_tipo, nota
  ) values (
    v_emisor_id, p_producto_id, 'entrada', p_cantidad, p_costo_unitario,
    v_nuevo_stock, v_nuevo_costo, 'compra_manual', p_nota
  );

  return query select v_nuevo_stock, v_nuevo_costo;
end;
$$;

-- --------------------------------------------
-- Ajuste de inventario (conteo físico / corrección): fija el stock a un
-- valor exacto, sin tocar el costo promedio (un ajuste de conteo no
-- implica que cambió lo que costó lo que ya había).
-- --------------------------------------------
create or replace function registrar_ajuste_inventario(
  p_producto_id uuid,
  p_nuevo_stock numeric,
  p_motivo text
) returns table(stock_resultante numeric)
language plpgsql
as $$
declare
  v_emisor_id uuid;
  v_stock_actual numeric;
  v_costo_actual numeric;
  v_delta numeric;
begin
  if p_nuevo_stock < 0 then
    raise exception 'stock_invalido:el stock no puede quedar negativo';
  end if;

  select emisor_id, stock_actual, costo_promedio into v_emisor_id, v_stock_actual, v_costo_actual
  from productos where id = p_producto_id
  for update;

  if not found then
    raise exception 'producto_no_encontrado:%', p_producto_id;
  end if;

  v_delta := p_nuevo_stock - v_stock_actual;

  update productos set stock_actual = p_nuevo_stock where id = p_producto_id;

  insert into movimientos_inventario (
    emisor_id, producto_id, tipo, cantidad, costo_unitario,
    saldo_cantidad, saldo_costo_promedio, referencia_tipo, nota
  ) values (
    v_emisor_id, p_producto_id, 'ajuste', v_delta, v_costo_actual,
    p_nuevo_stock, v_costo_actual, 'ajuste_manual', p_motivo
  );

  return query select p_nuevo_stock;
end;
$$;
