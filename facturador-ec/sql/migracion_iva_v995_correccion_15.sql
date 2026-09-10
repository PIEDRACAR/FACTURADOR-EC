-- CONTSERTRIB v9.9.5
-- CORRECCIÓN TRIBUTARIA: tarifa general de IVA parametrizada en 15%.
-- Esta migración es ADITIVA y se ejecuta DESPUÉS de v9.9.4.
-- No modifica ni recalcula comprobantes históricos: cada comprobante conserva
-- su snapshot en comprobante_impuestos.

begin;

-- 1) Garantizar las estructuras necesarias si una instalación omitió alguna
-- migración previa. No se eliminan tablas ni datos.
create table if not exists historial_configuracion_iva (
  id uuid primary key default gen_random_uuid(),
  emisor_id uuid not null references emisores(id) on delete cascade,
  tarifa_general numeric(7,4), codigo_general varchar(10),
  tarifa_reducida numeric(7,4), codigo_reducida varchar(10),
  tarifa_turismo numeric(7,4), codigo_turismo varchar(10),
  motivo varchar(500), actualizado_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- 2) Crear catálogo vigente por fecha. El catálogo permite reformas futuras
-- sin tocar código fuente ni alterar documentos históricos.
create table if not exists catalogo_iva_sri (
  id uuid primary key default gen_random_uuid(),
  codigo_porcentaje varchar(10) not null,
  descripcion varchar(120) not null,
  tarifa numeric(7,4) not null default 0,
  tipo varchar(20) not null default 'TARIFA',
  sector varchar(40),
  fecha_desde date,
  fecha_hasta date,
  base_legal varchar(250),
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(codigo_porcentaje, fecha_desde)
);

-- Instalaciones anteriores pueden tener catalogo_iva_sri creado con menos columnas.
-- La migración debe ser idempotente y no asumir que 'activo' existe.
alter table if exists catalogo_iva_sri
  add column if not exists descripcion varchar(120),
  add column if not exists tarifa numeric(7,4) default 0,
  add column if not exists tipo varchar(20) default 'TARIFA',
  add column if not exists sector varchar(40),
  add column if not exists fecha_desde date,
  add column if not exists fecha_hasta date,
  add column if not exists base_legal varchar(250),
  add column if not exists activo boolean default true,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

update catalogo_iva_sri
set activo = true
where activo is null;

alter table if exists catalogo_iva_sri
  alter column activo set default true;

-- configuracion_iva puede NO existir si la base se creó con una versión anterior
-- o si el administrador ejecuta esta corrección de forma aislada.
-- Se crea de forma compatible antes de aplicar ALTER/UPDATE.
create table if not exists configuracion_iva (
  emisor_id uuid primary key references emisores(id) on delete cascade,
  tarifa_general numeric(7,4) not null default 15.00,
  codigo_general varchar(10) not null default '4',
  tarifa_reducida numeric(7,4) not null default 5.00,
  codigo_reducida varchar(10) not null default '5',
  tarifa_turismo numeric(7,4) not null default 8.00,
  codigo_turismo varchar(10) not null default '8',
  activo boolean not null default true,
  actualizado_por uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- Si la tabla acaba de crearse o estaba vacía, inicializar un registro por emisor.
insert into configuracion_iva (emisor_id)
select id from emisores
on conflict (emisor_id) do nothing;

-- configuracion_iva también puede provenir de una instalación anterior.
alter table if exists configuracion_iva
  add column if not exists tarifa_general numeric(7,4),
  add column if not exists codigo_general varchar(10),
  add column if not exists tarifa_reducida numeric(7,4) default 5,
  add column if not exists codigo_reducida varchar(10) default '5',
  add column if not exists tarifa_turismo numeric(7,4) default 8,
  add column if not exists codigo_turismo varchar(10) default '8',
  add column if not exists activo boolean default true,
  add column if not exists actualizado_por uuid references auth.users(id) on delete set null,
  add column if not exists updated_at timestamptz default now();

update configuracion_iva set tarifa_general = 15 where tarifa_general is null;
update configuracion_iva set codigo_general = '4' where codigo_general is null or trim(codigo_general) = '';
update configuracion_iva set tarifa_reducida = 5 where tarifa_reducida is null;
update configuracion_iva set codigo_reducida = '5' where codigo_reducida is null or trim(codigo_reducida) = '';
update configuracion_iva set tarifa_turismo = 8 where tarifa_turismo is null;
update configuracion_iva set codigo_turismo = '8' where codigo_turismo is null or trim(codigo_turismo) = '';
update configuracion_iva set activo = true where activo is null;

-- 3) Auditoría antes de normalizar configuraciones que quedaron en 13% por
-- la migración v9.9.0. Solo se corrige 13%; otras parametrizaciones se respetan.
insert into historial_configuracion_iva
  (emisor_id, tarifa_general, codigo_general, tarifa_reducida, codigo_reducida,
   tarifa_turismo, codigo_turismo, motivo, actualizado_por)
select emisor_id, tarifa_general, codigo_general, tarifa_reducida, codigo_reducida,
       tarifa_turismo, codigo_turismo,
       'v9.9.5: corrección de tarifa general parametrizada 13% -> 15%',
       actualizado_por
from configuracion_iva
where tarifa_general = 13
  and not exists (
    select 1 from historial_configuracion_iva h
    where h.emisor_id = configuracion_iva.emisor_id
      and h.motivo = 'v9.9.5: corrección de tarifa general parametrizada 13% -> 15%'
  );

update configuracion_iva
set tarifa_general = 15,
    codigo_general = coalesce(nullif(trim(codigo_general), ''), '4'),
    updated_at = now()
where tarifa_general = 13;

-- 4) Desactivar el registro genérico 13% que creó v9.9.0 y registrar 15%
-- como vigencia explícita desde 2026-01-01. Si una autoridad establece una
-- nueva vigencia, se agrega otra fila: nunca se reescriben comprobantes.
update catalogo_iva_sri
set activo = false, updated_at = now()
where codigo_porcentaje = '4'
  and tarifa = 13
  and fecha_desde is null;

insert into catalogo_iva_sri
  (codigo_porcentaje, descripcion, tarifa, tipo, fecha_desde, fecha_hasta,
   base_legal, activo)
values
  ('4', 'IVA tarifa general 15%', 15, 'TARIFA', date '2026-01-01', null,
   'Parametrización vigente de CONTSERTRIB; validar siempre contra la normativa/ficha SRI vigente.', true)
on conflict (codigo_porcentaje, fecha_desde)
do update set
  descripcion = excluded.descripcion,
  tarifa = excluded.tarifa,
  tipo = excluded.tipo,
  base_legal = excluded.base_legal,
  activo = true,
  updated_at = now();

-- 5) Asegurar catálogos especiales requeridos por el motor.
insert into catalogo_iva_sri
  (codigo_porcentaje, descripcion, tarifa, tipo, fecha_desde, base_legal, activo)
values
  ('0', 'IVA tarifa 0%', 0, 'TARIFA', date '2026-01-01', 'Catálogo SRI', true),
  ('6', 'No objeto de IVA', 0, 'NO_OBJETO', date '2026-01-01', 'Catálogo SRI', true),
  ('7', 'Exento de IVA', 0, 'EXENTO', date '2026-01-01', 'Catálogo SRI', true)
on conflict (codigo_porcentaje, fecha_desde) do nothing;

-- 6) Índices para resolver rápidamente la vigencia aplicable.
create index if not exists idx_catalogo_iva_sri_vigencia
  on catalogo_iva_sri (codigo_porcentaje, fecha_desde, fecha_hasta, activo);

commit;
