-- CONTSERTRIB v9.5.1
-- Clientes rápidos + establecimientos/puntos + permisos granulares.
-- Ejecutar una sola vez en Supabase SQL Editor.

create extension if not exists pg_trgm;

create index if not exists idx_clientes_razon_social_trgm
  on clientes using gin (razon_social gin_trgm_ops);
create index if not exists idx_clientes_emisor_identificacion
  on clientes (emisor_id, identificacion);

create table if not exists establecimientos_emisor (
  id uuid primary key default gen_random_uuid(),
  emisor_id uuid not null references emisores(id) on delete cascade,
  codigo varchar(3) not null,
  nombre_comercial varchar(200),
  direccion varchar(300) not null,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (emisor_id, codigo)
);
create index if not exists idx_establecimientos_emisor on establecimientos_emisor(emisor_id, activo, codigo);

-- Migra automáticamente los establecimientos que ya existían en puntos_emision.
insert into establecimientos_emisor (emisor_id, codigo, direccion, activo)
select p.emisor_id, p.establecimiento, max(p.direccion), true
from puntos_emision p
group by p.emisor_id, p.establecimiento
on conflict (emisor_id, codigo) do nothing;

create index if not exists idx_puntos_emision_emisor_establecimiento
  on puntos_emision(emisor_id, establecimiento, activo);

create table if not exists usuarios_permisos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  emisor_id uuid not null references emisores(id) on delete cascade,
  permiso varchar(60) not null,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, emisor_id, permiso)
);
create index if not exists idx_usuarios_permisos_negocio
  on usuarios_permisos(emisor_id, user_id, activo);

-- IMPORTANTE: NO desactivar puntos de emisión existentes.
-- Un emisor puede tener varios puntos activos y varios cajeros pueden
-- facturar simultáneamente desde ellos (o incluso desde el mismo punto).
-- La numeración se protege mediante increment_secuencial.sql, que hace el
-- incremento atómicamente en PostgreSQL.
-- Tampoco se usa created_at aquí porque la tabla puntos_emision existente
-- puede no tener esa columna.
