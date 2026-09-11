-- CONTSERTRIB v9.9.12 — Reparación de esquema contable existente
-- Objetivo: corregir instalaciones donde alguna tabla contable ya existía
-- con una estructura antigua y, por CREATE TABLE IF NOT EXISTS, no recibió
-- columnas nuevas como emisor_id.
-- ADITIVA: no elimina datos, tablas ni asientos.

begin;

-- 1) Crear las tablas si no existen.
create table if not exists plan_cuentas_contables (
  id uuid primary key default gen_random_uuid(),
  emisor_id uuid references emisores(id) on delete cascade,
  codigo varchar(30) not null,
  nombre varchar(180) not null,
  nivel integer not null default 1,
  tipo varchar(20) not null,
  naturaleza varchar(10) not null,
  acepta_movimientos boolean not null default true,
  activa boolean not null default true,
  cuenta_padre_id uuid references plan_cuentas_contables(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists asientos_contables (
  id uuid primary key default gen_random_uuid(),
  emisor_id uuid references emisores(id) on delete cascade,
  fecha date not null,
  tipo varchar(30) not null,
  concepto varchar(500) not null,
  referencia varchar(120),
  origen_tipo varchar(40),
  origen_id uuid,
  estado varchar(20) not null default 'CONTABILIZADO',
  total_debe numeric(14,2) not null default 0,
  total_haber numeric(14,2) not null default 0,
  diferencia numeric(14,2) not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists asiento_lineas_contables (
  id uuid primary key default gen_random_uuid(),
  asiento_id uuid not null,
  cuenta_id uuid not null,
  descripcion varchar(300),
  debe numeric(14,2) not null default 0,
  haber numeric(14,2) not null default 0,
  tercero_tipo varchar(20),
  tercero_id uuid,
  created_at timestamptz not null default now(),
  check (debe >= 0 and haber >= 0 and not (debe > 0 and haber > 0))
);

create table if not exists periodos_contables (
  id uuid primary key default gen_random_uuid(),
  emisor_id uuid references emisores(id) on delete cascade,
  periodo char(7) not null,
  estado varchar(15) not null default 'ABIERTO',
  cerrado_por uuid references auth.users(id) on delete set null,
  cerrado_at timestamptz,
  created_at timestamptz not null default now()
);

-- 2) REPARACIÓN CLAVE: si las tablas ya existían, CREATE TABLE IF NOT EXISTS
-- no agrega columnas. Por eso las agregamos explícitamente de forma segura.
alter table plan_cuentas_contables add column if not exists emisor_id uuid;
alter table asientos_contables add column if not exists emisor_id uuid;
alter table asiento_lineas_contables add column if not exists asiento_id uuid;
alter table asiento_lineas_contables add column if not exists cuenta_id uuid;
alter table periodos_contables add column if not exists emisor_id uuid;

-- Columnas que las rutas actuales utilizan y que pueden faltar en instalaciones antiguas.
alter table plan_cuentas_contables add column if not exists nivel integer default 1;
alter table plan_cuentas_contables add column if not exists tipo varchar(20);
alter table plan_cuentas_contables add column if not exists naturaleza varchar(10);
alter table plan_cuentas_contables add column if not exists acepta_movimientos boolean default true;
alter table plan_cuentas_contables add column if not exists activa boolean default true;
alter table plan_cuentas_contables add column if not exists cuenta_padre_id uuid;
alter table plan_cuentas_contables add column if not exists created_at timestamptz default now();
alter table plan_cuentas_contables add column if not exists updated_at timestamptz default now();

alter table asientos_contables add column if not exists referencia varchar(120);
alter table asientos_contables add column if not exists origen_tipo varchar(40);
alter table asientos_contables add column if not exists origen_id uuid;
alter table asientos_contables add column if not exists estado varchar(20) default 'CONTABILIZADO';
alter table asientos_contables add column if not exists total_debe numeric(14,2) default 0;
alter table asientos_contables add column if not exists total_haber numeric(14,2) default 0;
alter table asientos_contables add column if not exists diferencia numeric(14,2) default 0;
alter table asientos_contables add column if not exists created_by uuid;
alter table asientos_contables add column if not exists created_at timestamptz default now();
alter table asientos_contables add column if not exists updated_at timestamptz default now();

alter table asiento_lineas_contables add column if not exists descripcion varchar(300);
alter table asiento_lineas_contables add column if not exists debe numeric(14,2) default 0;
alter table asiento_lineas_contables add column if not exists haber numeric(14,2) default 0;
alter table asiento_lineas_contables add column if not exists tercero_tipo varchar(20);
alter table asiento_lineas_contables add column if not exists tercero_id uuid;
alter table asiento_lineas_contables add column if not exists created_at timestamptz default now();

alter table periodos_contables add column if not exists periodo char(7);
alter table periodos_contables add column if not exists estado varchar(15) default 'ABIERTO';
alter table periodos_contables add column if not exists cerrado_por uuid;
alter table periodos_contables add column if not exists cerrado_at timestamptz;
alter table periodos_contables add column if not exists created_at timestamptz default now();

-- 3) Normalizar nulos de columnas de control sin tocar importes históricos.
update plan_cuentas_contables set acepta_movimientos=true where acepta_movimientos is null;
update plan_cuentas_contables set activa=true where activa is null;
update plan_cuentas_contables set nivel=1 where nivel is null;
update asientos_contables set estado='CONTABILIZADO' where estado is null;
update asientos_contables set total_debe=0 where total_debe is null;
update asientos_contables set total_haber=0 where total_haber is null;
update asientos_contables set diferencia=round(coalesce(total_debe,0)-coalesce(total_haber,0),2) where diferencia is null;
update asiento_lineas_contables set debe=0 where debe is null;
update asiento_lineas_contables set haber=0 where haber is null;
update periodos_contables set estado='ABIERTO' where estado is null;

-- 4) Claves foráneas explícitas. Solo se agregan si no existen.
do $$
begin
  if not exists (select 1 from pg_constraint where conname='fk_plan_cuentas_emisor_v9912' and conrelid='plan_cuentas_contables'::regclass) then
    alter table plan_cuentas_contables add constraint fk_plan_cuentas_emisor_v9912 foreign key(emisor_id) references emisores(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname='fk_asientos_emisor_v9912' and conrelid='asientos_contables'::regclass) then
    alter table asientos_contables add constraint fk_asientos_emisor_v9912 foreign key(emisor_id) references emisores(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname='fk_asiento_linea_asiento_v9912' and conrelid='asiento_lineas_contables'::regclass) then
    alter table asiento_lineas_contables add constraint fk_asiento_linea_asiento_v9912 foreign key(asiento_id) references asientos_contables(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname='fk_asiento_linea_cuenta_v9912' and conrelid='asiento_lineas_contables'::regclass) then
    alter table asiento_lineas_contables add constraint fk_asiento_linea_cuenta_v9912 foreign key(cuenta_id) references plan_cuentas_contables(id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname='fk_periodos_emisor_v9912' and conrelid='periodos_contables'::regclass) then
    alter table periodos_contables add constraint fk_periodos_emisor_v9912 foreign key(emisor_id) references emisores(id) on delete cascade;
  end if;
end $$;

-- 5) Índices/únicos que requiere el backend. Los NULL históricos no se modifican.
create unique index if not exists ux_plan_cuentas_emisor_codigo_v9912 on plan_cuentas_contables(emisor_id,codigo);
create unique index if not exists ux_periodos_emisor_periodo_v9912 on periodos_contables(emisor_id,periodo);
create unique index if not exists ux_asientos_origen_v9912 on asientos_contables(emisor_id,origen_tipo,origen_id) where origen_tipo is not null and origen_id is not null;
create index if not exists idx_plan_cuentas_emisor_activa_codigo_v9912 on plan_cuentas_contables(emisor_id,activa,codigo);
create index if not exists idx_asientos_emisor_fecha_v9912 on asientos_contables(emisor_id,fecha desc);
create index if not exists idx_asientos_estado_fecha_v9912 on asientos_contables(emisor_id,estado,fecha);
create index if not exists idx_lineas_asiento_v9912 on asiento_lineas_contables(asiento_id);
create index if not exists idx_lineas_cuenta_v9912 on asiento_lineas_contables(cuenta_id);
create index if not exists idx_periodos_emisor_periodo_v9912 on periodos_contables(emisor_id,periodo);

-- 6) Funciones contables robustas frente a periodos antiguos.
create or replace function periodo_contable_abierto(p_emisor_id uuid, p_fecha date)
returns boolean language plpgsql as $$
declare v_estado text;
begin
  if p_emisor_id is null or p_fecha is null then return false; end if;
  select estado into v_estado
    from periodos_contables
   where emisor_id=p_emisor_id and periodo=to_char(p_fecha,'YYYY-MM');
  return coalesce(v_estado,'ABIERTO')='ABIERTO';
end; $$;

create or replace function cerrar_periodo_contable(p_emisor_id uuid,p_periodo char(7),p_user_id uuid)
returns void language plpgsql as $$
declare v_d numeric; v_h numeric; v_estado text;
begin
  if p_emisor_id is null then raise exception 'emisor_id_obligatorio'; end if;
  if p_periodo !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'periodo_invalido'; end if;
  select estado into v_estado from periodos_contables where emisor_id=p_emisor_id and periodo=p_periodo for update;
  if coalesce(v_estado,'ABIERTO')='CERRADO' then return; end if;
  select coalesce(sum(total_debe),0),coalesce(sum(total_haber),0)
    into v_d,v_h
    from asientos_contables
   where emisor_id=p_emisor_id and estado='CONTABILIZADO' and to_char(fecha,'YYYY-MM')=p_periodo;
  if round(v_d,2)<>round(v_h,2) then raise exception 'periodo_con_asientos_descuadrados'; end if;
  insert into periodos_contables(emisor_id,periodo,estado,cerrado_por,cerrado_at)
  values(p_emisor_id,p_periodo,'CERRADO',p_user_id,now())
  on conflict(emisor_id,periodo) do update set estado='CERRADO',cerrado_por=excluded.cerrado_por,cerrado_at=excluded.cerrado_at;
end; $$;

-- 7) Forzar recarga del schema cache de PostgREST/Supabase.
notify pgrst, 'reload schema';

insert into control_migraciones(version,detalle)
select '9.9.12','Reparación de esquema contable: agrega columnas emisor_id faltantes, relaciones, índices y recarga del schema cache.'
where to_regclass('control_migraciones') is not null
on conflict(version) do update set detalle=excluded.detalle, aplicado_at=now();

commit;
