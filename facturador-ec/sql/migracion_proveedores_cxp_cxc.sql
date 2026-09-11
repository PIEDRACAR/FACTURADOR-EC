-- ============================================
-- MIGRACIÓN: proveedores, cuentas por pagar y cuentas por cobrar
-- Ejecutar en el SQL Editor de Supabase (una sola vez).
-- ============================================

-- --------------------------------------------
-- PROVEEDORES
-- --------------------------------------------
create table if not exists proveedores (
  id uuid primary key default uuid_generate_v4(),
  emisor_id uuid not null references emisores(id) on delete cascade,
  tipo_identificacion text not null default '04' check (tipo_identificacion in ('04','05','06')),
  identificacion text not null,
  razon_social text not null,
  nombre_comercial text,
  telefono text,
  email text,
  direccion text,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (emisor_id, tipo_identificacion, identificacion)
);

-- Vincula cada entrada de inventario a su proveedor (opcional — sigue
-- existiendo `nota` como texto libre para cuando no se quiera formalizar).
alter table movimientos_inventario add column if not exists proveedor_id uuid references proveedores(id);

-- --------------------------------------------
-- CUENTAS POR PAGAR (a proveedores)
-- --------------------------------------------
create table if not exists cuentas_por_pagar (
  id uuid primary key default uuid_generate_v4(),
  emisor_id uuid not null references emisores(id) on delete cascade,
  proveedor_id uuid not null references proveedores(id),
  numero_documento text,
  concepto text not null,
  fecha_emision date not null default current_date,
  fecha_vencimiento date not null,
  monto_total numeric(12,2) not null check (monto_total > 0),
  monto_pagado numeric(12,2) not null default 0,
  estado text not null default 'pendiente' check (estado in ('pendiente','pagada','anulada')),
  movimiento_inventario_id uuid references movimientos_inventario(id),
  created_at timestamptz not null default now()
);

create table if not exists pagos_cuentas_por_pagar (
  id uuid primary key default uuid_generate_v4(),
  cuenta_id uuid not null references cuentas_por_pagar(id) on delete cascade,
  monto numeric(12,2) not null check (monto > 0),
  forma_pago_codigo text not null default '20',
  nota text,
  created_at timestamptz not null default now()
);

-- --------------------------------------------
-- CUENTAS POR COBRAR (de clientes)
-- --------------------------------------------
create table if not exists cuentas_por_cobrar (
  id uuid primary key default uuid_generate_v4(),
  emisor_id uuid not null references emisores(id) on delete cascade,
  cliente_id uuid not null references clientes(id),
  comprobante_id uuid references comprobantes(id),
  concepto text not null,
  fecha_emision date not null default current_date,
  fecha_vencimiento date not null,
  monto_total numeric(12,2) not null check (monto_total > 0),
  monto_cobrado numeric(12,2) not null default 0,
  estado text not null default 'pendiente' check (estado in ('pendiente','cobrada','anulada')),
  created_at timestamptz not null default now()
);

create table if not exists pagos_cuentas_por_cobrar (
  id uuid primary key default uuid_generate_v4(),
  cuenta_id uuid not null references cuentas_por_cobrar(id) on delete cascade,
  monto numeric(12,2) not null check (monto > 0),
  forma_pago_codigo text not null default '01',
  nota text,
  created_at timestamptz not null default now()
);

-- --------------------------------------------
-- Se amplía `registrar_entrada_inventario` (creada en
-- migracion_inventario_entradas_ajustes.sql) para que devuelva también el
-- id del movimiento insertado — necesario para poder vincular la entrada
-- con una cuenta por pagar cuando la compra es a crédito.
-- --------------------------------------------
drop function if exists registrar_entrada_inventario(uuid, numeric, numeric, text);

create or replace function registrar_entrada_inventario(
  p_producto_id uuid,
  p_cantidad numeric,
  p_costo_unitario numeric,
  p_nota text,
  p_proveedor_id uuid default null
) returns table(stock_resultante numeric, costo_promedio_resultante numeric, movimiento_id uuid)
language plpgsql
as $$
declare
  v_emisor_id uuid;
  v_stock_actual numeric;
  v_costo_actual numeric;
  v_nuevo_stock numeric;
  v_nuevo_costo numeric;
  v_movimiento_id uuid;
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
    saldo_cantidad, saldo_costo_promedio, referencia_tipo, nota, proveedor_id
  ) values (
    v_emisor_id, p_producto_id, 'entrada', p_cantidad, p_costo_unitario,
    v_nuevo_stock, v_nuevo_costo, 'compra_manual', p_nota, p_proveedor_id
  )
  returning id into v_movimiento_id;

  return query select v_nuevo_stock, v_nuevo_costo, v_movimiento_id;
end;
$$;

-- --------------------------------------------
-- Funciones atómicas para registrar pagos parciales (bloqueo de fila para
-- evitar que dos pagos simultáneos sobre la misma cuenta se pisen, mismo
-- patrón que crear_venta / registrar_entrada_inventario).
-- --------------------------------------------
create or replace function registrar_pago_cuenta_por_pagar(
  p_cuenta_id uuid,
  p_monto numeric,
  p_forma_pago_codigo text,
  p_nota text
) returns table(monto_pagado_resultante numeric, saldo_resultante numeric, estado_resultante text)
language plpgsql
as $$
declare
  v_monto_total numeric;
  v_monto_pagado numeric;
  v_nuevo_pagado numeric;
  v_nuevo_estado text;
begin
  select monto_total, monto_pagado into v_monto_total, v_monto_pagado
  from cuentas_por_pagar where id = p_cuenta_id for update;

  if not found then
    raise exception 'cuenta_no_encontrada:%', p_cuenta_id;
  end if;

  v_nuevo_pagado := v_monto_pagado + p_monto;
  if v_nuevo_pagado > v_monto_total + 0.01 then
    raise exception 'monto_excede_saldo:el pago supera el saldo pendiente';
  end if;

  v_nuevo_estado := case when v_nuevo_pagado >= v_monto_total - 0.01 then 'pagada' else 'pendiente' end;

  update cuentas_por_pagar set monto_pagado = v_nuevo_pagado, estado = v_nuevo_estado where id = p_cuenta_id;

  insert into pagos_cuentas_por_pagar (cuenta_id, monto, forma_pago_codigo, nota)
  values (p_cuenta_id, p_monto, p_forma_pago_codigo, p_nota);

  return query select v_nuevo_pagado, round((v_monto_total - v_nuevo_pagado)::numeric, 2), v_nuevo_estado;
end;
$$;

create or replace function registrar_pago_cuenta_por_cobrar(
  p_cuenta_id uuid,
  p_monto numeric,
  p_forma_pago_codigo text,
  p_nota text
) returns table(monto_cobrado_resultante numeric, saldo_resultante numeric, estado_resultante text)
language plpgsql
as $$
declare
  v_monto_total numeric;
  v_monto_cobrado numeric;
  v_nuevo_cobrado numeric;
  v_nuevo_estado text;
begin
  select monto_total, monto_cobrado into v_monto_total, v_monto_cobrado
  from cuentas_por_cobrar where id = p_cuenta_id for update;

  if not found then
    raise exception 'cuenta_no_encontrada:%', p_cuenta_id;
  end if;

  v_nuevo_cobrado := v_monto_cobrado + p_monto;
  if v_nuevo_cobrado > v_monto_total + 0.01 then
    raise exception 'monto_excede_saldo:el cobro supera el saldo pendiente';
  end if;

  v_nuevo_estado := case when v_nuevo_cobrado >= v_monto_total - 0.01 then 'cobrada' else 'pendiente' end;

  update cuentas_por_cobrar set monto_cobrado = v_nuevo_cobrado, estado = v_nuevo_estado where id = p_cuenta_id;

  insert into pagos_cuentas_por_cobrar (cuenta_id, monto, forma_pago_codigo, nota)
  values (p_cuenta_id, p_monto, p_forma_pago_codigo, p_nota);

  return query select v_nuevo_cobrado, round((v_monto_total - v_nuevo_cobrado)::numeric, 2), v_nuevo_estado;
end;
$$;
