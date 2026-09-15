-- CONTSERTRIB v9.9.64 - INVENTARIO ERP AVANZADO
-- Extiende v9.9.63 sin eliminar datos existentes.

create table if not exists ubicaciones_bodega (
  id uuid primary key default uuid_generate_v4(),
  emisor_id uuid not null references emisores(id) on delete cascade,
  bodega_id uuid not null references bodegas(id) on delete cascade,
  codigo text not null,
  nombre text not null,
  tipo text not null default 'ALMACEN' check (tipo in ('ALMACEN','RECEPCION','DESPACHO','CUARENTENA','DEVOLUCION','OTRA')),
  activa boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bodega_id, codigo)
);

create table if not exists reservas_inventario (
  id uuid primary key default uuid_generate_v4(),
  emisor_id uuid not null references emisores(id) on delete cascade,
  bodega_id uuid not null references bodegas(id) on delete restrict,
  producto_id uuid not null references productos(id) on delete restrict,
  cantidad numeric(18,6) not null check (cantidad > 0),
  referencia_tipo text,
  referencia_id uuid,
  estado text not null default 'ACTIVA' check (estado in ('ACTIVA','LIBERADA','CONSUMIDA','CANCELADA')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_ubicaciones_bodega on ubicaciones_bodega(emisor_id,bodega_id,activa);
create index if not exists idx_reservas_producto on reservas_inventario(emisor_id,producto_id,bodega_id,estado);

-- Lotes y fechas de caducidad son opcionales: no obligan a modificar productos existentes.
create table if not exists lotes_inventario (
  id uuid primary key default uuid_generate_v4(),
  emisor_id uuid not null references emisores(id) on delete cascade,
  producto_id uuid not null references productos(id) on delete restrict,
  bodega_id uuid not null references bodegas(id) on delete restrict,
  lote text not null,
  fecha_fabricacion date,
  fecha_caducidad date,
  cantidad numeric(18,6) not null default 0 check (cantidad >= 0),
  costo_promedio numeric(18,6) not null default 0,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bodega_id,producto_id,lote),
  check (fecha_caducidad is null or fecha_fabricacion is null or fecha_caducidad >= fecha_fabricacion)
);

create index if not exists idx_lotes_vencimiento on lotes_inventario(emisor_id,bodega_id,fecha_caducidad) where activo=true;

-- Reserva/liberación atómica: impide reservar más stock disponible.
create or replace function reservar_inventario_bodega(
  p_emisor_id uuid,p_bodega_id uuid,p_producto_id uuid,p_cantidad numeric,
  p_referencia_tipo text default null,p_referencia_id uuid default null,p_user_id uuid default null
) returns uuid language plpgsql as $$
declare v_id uuid; v_stock numeric; v_res numeric;
begin
 if p_cantidad is null or p_cantidad <= 0 then raise exception 'cantidad_invalida'; end if;
 perform asegurar_existencia_bodega(p_bodega_id,p_producto_id);
 select stock,stock_reservado into v_stock,v_res from existencias_bodega
 where emisor_id=p_emisor_id and bodega_id=p_bodega_id and producto_id=p_producto_id for update;
 if v_stock - v_res < p_cantidad then raise exception 'stock_disponible_insuficiente'; end if;
 update existencias_bodega set stock_reservado=stock_reservado+p_cantidad,updated_at=now()
 where emisor_id=p_emisor_id and bodega_id=p_bodega_id and producto_id=p_producto_id;
 insert into reservas_inventario(emisor_id,bodega_id,producto_id,cantidad,referencia_tipo,referencia_id,created_by)
 values(p_emisor_id,p_bodega_id,p_producto_id,p_cantidad,p_referencia_tipo,p_referencia_id,p_user_id) returning id into v_id;
 return v_id;
end; $$;

create or replace function liberar_reserva_inventario(p_reserva_id uuid,p_emisor_id uuid)
returns boolean language plpgsql as $$
declare r reservas_inventario%rowtype;
begin
 select * into r from reservas_inventario where id=p_reserva_id and emisor_id=p_emisor_id for update;
 if not found then raise exception 'reserva_no_encontrada'; end if;
 if r.estado <> 'ACTIVA' then return false; end if;
 update existencias_bodega set stock_reservado=greatest(0,stock_reservado-r.cantidad),updated_at=now()
 where emisor_id=r.emisor_id and bodega_id=r.bodega_id and producto_id=r.producto_id;
 update reservas_inventario set estado='LIBERADA',updated_at=now() where id=r.id;
 return true;
end; $$;

-- Ubicación estándar para cada bodega existente.
insert into ubicaciones_bodega(emisor_id,bodega_id,codigo,nombre,tipo)
select b.emisor_id,b.id,'GENERAL','Ubicación general','ALMACEN'
from bodegas b
where not exists(select 1 from ubicaciones_bodega u where u.bodega_id=b.id);

insert into control_migraciones(version,detalle)
values('9.9.64','Inventario ERP avanzado: ubicaciones, reservas, lotes opcionales y operaciones atómicas.')
on conflict(version) do update set detalle=excluded.detalle;
