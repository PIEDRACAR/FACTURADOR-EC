-- CONTSERTRIB v9.9.41 — Motor IVA maestro por decreto/feriado.
-- ADITIVA: no elimina ni recalcula comprobantes históricos.
-- Ejecutar una sola vez en Supabase. Es autocontenida para instalaciones
-- que ya tengan catalogo_iva_sri/configuracion_iva con versiones anteriores.

begin;

create extension if not exists pgcrypto;

create table if not exists catalogo_iva_sri (
  id uuid primary key default gen_random_uuid(),
  codigo_porcentaje varchar(10) not null,
  descripcion varchar(120) not null,
  tarifa numeric(7,4) not null default 0,
  tipo varchar(30) not null default 'TARIFA',
  sector varchar(40),
  fecha_desde date,
  fecha_hasta date,
  base_legal varchar(250),
  activo boolean not null default true,
  aplicacion_automatica boolean not null default false,
  requiere_turismo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table catalogo_iva_sri
  add column if not exists codigo_porcentaje varchar(10),
  add column if not exists descripcion varchar(120),
  add column if not exists tarifa numeric(7,4),
  add column if not exists tipo varchar(30),
  add column if not exists sector varchar(40),
  add column if not exists fecha_desde date,
  add column if not exists fecha_hasta date,
  add column if not exists base_legal varchar(250),
  add column if not exists activo boolean,
  add column if not exists aplicacion_automatica boolean,
  add column if not exists requiere_turismo boolean,
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz;

update catalogo_iva_sri set
  descripcion=coalesce(nullif(descripcion,''),'IVA'),
  tarifa=coalesce(tarifa,0),
  tipo=coalesce(nullif(tipo,''),'TARIFA'),
  activo=coalesce(activo,true),
  aplicacion_automatica=coalesce(aplicacion_automatica,false),
  requiere_turismo=coalesce(requiere_turismo,false),
  created_at=coalesce(created_at,now()),
  updated_at=coalesce(updated_at,now());

-- Regla de referencia: el 8% de turismo solo está activo en las fechas del
-- decreto correspondiente. Se conserva como antecedente; ROOT puede activar,
-- editar o crear nuevos períodos cuando exista una nueva norma oficial.
update catalogo_iva_sri
set aplicacion_automatica=true, requiere_turismo=true, activo=true, updated_at=now()
where codigo_porcentaje='8'
  and tipo='TARIFA_ESPECIAL'
  and fecha_desde=date '2026-05-23'
  and fecha_hasta=date '2026-05-25';

-- Configuración por emisor: la elegibilidad la administra ROOT, nunca el cajero.
create table if not exists configuracion_iva (
  emisor_id uuid primary key references emisores(id) on delete cascade,
  tarifa_general numeric(7,4) not null default 15,
  codigo_general varchar(10) not null default '4',
  tarifa_reducida numeric(7,4) not null default 5,
  codigo_reducida varchar(10) not null default '5',
  tarifa_turismo numeric(7,4) not null default 8,
  codigo_turismo varchar(10) not null default '8',
  turismo_habilitado boolean not null default false,
  registro_turismo varchar(80),
  luaf varchar(80),
  activo boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table configuracion_iva
  add column if not exists turismo_habilitado boolean default false,
  add column if not exists registro_turismo varchar(80),
  add column if not exists luaf varchar(80);

update configuracion_iva set
  tarifa_general=coalesce(tarifa_general,15),
  codigo_general=coalesce(nullif(trim(codigo_general),''),'4'),
  tarifa_reducida=coalesce(tarifa_reducida,5),
  codigo_reducida=coalesce(nullif(trim(codigo_reducida),''),'5'),
  tarifa_turismo=coalesce(tarifa_turismo,8),
  codigo_turismo=coalesce(nullif(trim(codigo_turismo),''),'8'),
  turismo_habilitado=coalesce(turismo_habilitado,false),
  activo=coalesce(activo,true),
  updated_at=now();

create index if not exists idx_catalogo_iva_sri_maestro_v9941
  on catalogo_iva_sri(codigo_porcentaje, sector, fecha_desde, fecha_hasta, activo, aplicacion_automatica);

notify pgrst, 'reload schema';
commit;
