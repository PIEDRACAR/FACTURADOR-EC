-- CONTSERTRIB v9.9.63 - BODEGAS Y EXISTENCIAS MULTIALMACEN
-- ADITIVA: no elimina productos ni movimientos existentes.

create table if not exists bodegas (
  id uuid primary key default uuid_generate_v4(),
  emisor_id uuid not null references emisores(id) on delete cascade,
  codigo text not null,
  nombre text not null,
  direccion text,
  responsable text,
  telefono text,
  activa boolean not null default true,
  es_principal boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (emisor_id, codigo)
);

create unique index if not exists ux_bodega_principal_por_emisor
  on bodegas(emisor_id) where es_principal = true and activa = true;

create table if not exists existencias_bodega (
  id uuid primary key default uuid_generate_v4(),
  emisor_id uuid not null references emisores(id) on delete cascade,
  bodega_id uuid not null references bodegas(id) on delete cascade,
  producto_id uuid not null references productos(id) on delete cascade,
  stock numeric(18,6) not null default 0 check (stock >= 0),
  stock_reservado numeric(18,6) not null default 0 check (stock_reservado >= 0),
  stock_minimo numeric(18,6) not null default 0 check (stock_minimo >= 0),
  stock_critico numeric(18,6) not null default 0 check (stock_critico >= 0),
  stock_maximo numeric(18,6),
  costo_promedio numeric(18,6) not null default 0,
  updated_at timestamptz not null default now(),
  unique(bodega_id, producto_id),
  check (stock_maximo is null or stock_maximo >= stock_minimo)
);

create index if not exists idx_bodegas_emisor on bodegas(emisor_id, activa);
create index if not exists idx_existencias_emisor on existencias_bodega(emisor_id, bodega_id);
create index if not exists idx_existencias_producto on existencias_bodega(producto_id, bodega_id);

create table if not exists movimientos_inventario_bodega (
  id uuid primary key default uuid_generate_v4(),
  emisor_id uuid not null references emisores(id) on delete cascade,
  bodega_id uuid not null references bodegas(id),
  producto_id uuid not null references productos(id),
  tipo text not null check (tipo in ('entrada','salida','ajuste','transferencia_entrada','transferencia_salida','devolucion_entrada','devolucion_salida')),
  cantidad numeric(18,6) not null check (cantidad > 0),
  costo_unitario numeric(18,6) not null default 0 check (costo_unitario >= 0),
  saldo_cantidad numeric(18,6) not null default 0,
  saldo_costo_promedio numeric(18,6) not null default 0,
  referencia_tipo text,
  referencia_id uuid,
  bodega_origen_id uuid references bodegas(id),
  bodega_destino_id uuid references bodegas(id),
  nota text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_mov_bodega_fecha on movimientos_inventario_bodega(bodega_id, producto_id, created_at desc);

-- Crea la bodega principal para cada emisor que todavía no tenga una.
insert into bodegas(emisor_id,codigo,nombre,es_principal)
select e.id,'MATRIZ','Bodega Matriz',true
from emisores e
where not exists(select 1 from bodegas b where b.emisor_id=e.id);

-- Distribuye el stock histórico del producto a la bodega principal, sin tocar stock_actual.
insert into existencias_bodega(emisor_id,bodega_id,producto_id,stock,stock_minimo,stock_critico,stock_maximo,costo_promedio)
select p.emisor_id,b.id,p.id,coalesce(p.stock_actual,0),coalesce(p.stock_minimo,0),coalesce(p.stock_critico,0),p.stock_maximo,coalesce(p.costo_promedio,0)
from productos p
join bodegas b on b.emisor_id=p.emisor_id and b.es_principal=true and b.activa=true
where not exists(select 1 from existencias_bodega x where x.bodega_id=b.id and x.producto_id=p.id);

create or replace function asegurar_existencia_bodega(p_bodega_id uuid,p_producto_id uuid)
returns uuid language plpgsql as $$
declare v_id uuid; v_emisor uuid;
begin
 select emisor_id into v_emisor from bodegas where id=p_bodega_id and activa=true;
 if v_emisor is null then raise exception 'bodega_no_encontrada'; end if;
 select id into v_id from existencias_bodega where bodega_id=p_bodega_id and producto_id=p_producto_id for update;
 if v_id is null then
   insert into existencias_bodega(emisor_id,bodega_id,producto_id)
   values(v_emisor,p_bodega_id,p_producto_id) returning id into v_id;
 end if;
 return v_id;
end; $$;

create or replace function transferir_inventario_bodega(
 p_producto_id uuid,p_bodega_origen_id uuid,p_bodega_destino_id uuid,p_cantidad numeric,p_nota text default null,p_user_id uuid default null
) returns table(stock_origen numeric,stock_destino numeric,movimiento_salida_id uuid,movimiento_entrada_id uuid)
language plpgsql as $$
declare
 v_e1 uuid; v_e2 uuid; v_emisor uuid; v_costo numeric; v_s1 numeric; v_s2 numeric; v_out uuid; v_in uuid;
begin
 if p_bodega_origen_id=p_bodega_destino_id then raise exception 'bodegas_iguales'; end if;
 if p_cantidad<=0 then raise exception 'cantidad_invalida'; end if;
 perform asegurar_existencia_bodega(p_bodega_origen_id,p_producto_id);
 perform asegurar_existencia_bodega(p_bodega_destino_id,p_producto_id);
 select emisor_id,stock,costo_promedio into v_emisor,v_s1,v_costo from existencias_bodega where bodega_id=p_bodega_origen_id and producto_id=p_producto_id for update;
 select stock into v_s2 from existencias_bodega where bodega_id=p_bodega_destino_id and producto_id=p_producto_id for update;
 if v_s1<p_cantidad then raise exception 'stock_insuficiente_en_bodega'; end if;
 update existencias_bodega set stock=stock-p_cantidad,updated_at=now() where bodega_id=p_bodega_origen_id and producto_id=p_producto_id returning stock into v_s1;
 update existencias_bodega set stock=stock+p_cantidad,costo_promedio=case when costo_promedio=0 then v_costo else costo_promedio end,updated_at=now() where bodega_id=p_bodega_destino_id and producto_id=p_producto_id returning stock into v_s2;
 insert into movimientos_inventario_bodega(emisor_id,bodega_id,producto_id,tipo,cantidad,costo_unitario,saldo_cantidad,saldo_costo_promedio,referencia_tipo,bodega_origen_id,bodega_destino_id,nota,created_by)
 values(v_emisor,p_bodega_origen_id,p_producto_id,'transferencia_salida',p_cantidad,v_costo,v_s1,v_costo,'TRANSFERENCIA',p_bodega_origen_id,p_bodega_destino_id,p_nota,p_user_id) returning id into v_out;
 insert into movimientos_inventario_bodega(emisor_id,bodega_id,producto_id,tipo,cantidad,costo_unitario,saldo_cantidad,saldo_costo_promedio,referencia_tipo,bodega_origen_id,bodega_destino_id,nota,created_by)
 values(v_emisor,p_bodega_destino_id,p_producto_id,'transferencia_entrada',p_cantidad,v_costo,v_s2,v_costo,'TRANSFERENCIA',p_bodega_origen_id,p_bodega_destino_id,p_nota,p_user_id) returning id into v_in;
 return query select v_s1,v_s2,v_out,v_in;
end; $$;

insert into control_migraciones(version,detalle)
values('9.9.63','Inventario multibodega: bodegas, existencias por bodega, movimientos y transferencias atómicas.')
on conflict(version) do update set detalle=excluded.detalle;
