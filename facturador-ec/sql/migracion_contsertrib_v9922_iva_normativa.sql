-- CONTSERTRIB v9.9.22 — IVA conforme catálogo SRI y selector por línea.
-- ADITIVA: no elimina comprobantes históricos.

begin;

-- 1) Parametrización actual: IVA general 15% = código SRI 4.
create table if not exists configuracion_iva (
  emisor_id uuid primary key references emisores(id) on delete cascade,
  tarifa_general numeric(7,4) not null default 15,
  codigo_general varchar(10) not null default '10',
  tarifa_reducida numeric(7,4) not null default 5,
  codigo_reducida varchar(10) not null default '5',
  tarifa_turismo numeric(7,4) not null default 8,
  codigo_turismo varchar(10) not null default '8',
  activo boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table configuracion_iva
  add column if not exists tarifa_general numeric(7,4),
  add column if not exists codigo_general varchar(10),
  add column if not exists tarifa_reducida numeric(7,4),
  add column if not exists codigo_reducida varchar(10),
  add column if not exists tarifa_turismo numeric(7,4),
  add column if not exists codigo_turismo varchar(10),
  add column if not exists activo boolean,
  add column if not exists updated_at timestamptz;


update catalogo_iva_sri set
  descripcion=coalesce(nullif(descripcion,''),'IVA'),
  tarifa=coalesce(tarifa,0),
  tipo=coalesce(nullif(tipo,''),'TARIFA'),
  activo=coalesce(activo,true),
  created_at=coalesce(created_at,now()),
  updated_at=coalesce(updated_at,now());

alter table catalogo_iva_sri alter column created_at set default now();
alter table catalogo_iva_sri alter column updated_at set default now();

-- La parametrización anterior 15%/código 4 corresponde a una vigencia
-- histórica. Desde la normativa vigente consultada por CONTSERTRIB, la tarifa
-- general es 15% y el código electrónico correspondiente es 10.
update configuracion_iva
set tarifa_general=15, codigo_general='4',
    tarifa_reducida=coalesce(tarifa_reducida,5), codigo_reducida=coalesce(nullif(trim(codigo_reducida),''),'5'),
    tarifa_turismo=coalesce(tarifa_turismo,8), codigo_turismo=coalesce(nullif(trim(codigo_turismo),''),'8'),
    activo=coalesce(activo,true), updated_at=now();

alter table configuracion_iva alter column tarifa_general set default 15;
alter table configuracion_iva alter column codigo_general set default '10';
alter table configuracion_iva alter column tarifa_reducida set default 5;
alter table configuracion_iva alter column codigo_reducida set default '5';
alter table configuracion_iva alter column tarifa_turismo set default 8;
alter table configuracion_iva alter column codigo_turismo set default '8';

insert into configuracion_iva(emisor_id)
select id from emisores on conflict(emisor_id) do nothing;

-- 2) Catálogo de vigencias. El 8% turismo NO es permanente: solo se habilita
-- cuando existe un decreto con fechas vigentes. Se registra el Decreto Ejecutivo
-- 391 (23 al 25 de mayo de 2026) como antecedente. Nuevos decretos se agregan
-- como nuevas filas sin modificar comprobantes anteriores.
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
  updated_at timestamptz not null default now()
);

alter table catalogo_iva_sri
  add column if not exists descripcion varchar(120),
  add column if not exists tarifa numeric(7,4),
  add column if not exists tipo varchar(20),
  add column if not exists sector varchar(40),
  add column if not exists fecha_desde date,
  add column if not exists fecha_hasta date,
  add column if not exists base_legal varchar(250),
  add column if not exists activo boolean,
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz;

insert into catalogo_iva_sri(codigo_porcentaje,descripcion,tarifa,tipo,sector,fecha_desde,fecha_hasta,base_legal,activo)
select '4','IVA general 15%',15,'TARIFA','general',date '2026-01-01',null,'Código 4 para tarifa 15% según documentación SRI del Facturador Electrónico.',true
where not exists (select 1 from catalogo_iva_sri where codigo_porcentaje='10' and fecha_desde=date '2026-01-01');

insert into catalogo_iva_sri(codigo_porcentaje,descripcion,tarifa,tipo,sector,fecha_desde,fecha_hasta,base_legal,activo)
select '8','IVA diferenciado 8% — turismo',8,'TARIFA_ESPECIAL','turismo',date '2026-05-23',date '2026-05-25','Decreto Ejecutivo No. 391 — reducción temporal para actividades turísticas.',true
where not exists (select 1 from catalogo_iva_sri where codigo_porcentaje='8' and fecha_desde=date '2026-05-23');

insert into catalogo_iva_sri(codigo_porcentaje,descripcion,tarifa,tipo,sector,fecha_desde,fecha_hasta,base_legal,activo)
select * from (values
  ('0','IVA tarifa 0%',0::numeric,'TARIFA','general',date '2026-01-01',null,'Catálogo SRI',true),
  ('5','IVA 5% — construcción',5::numeric,'TARIFA','construccion',date '2026-01-01',null,'Catálogo SRI; aplicar únicamente a bienes/operaciones que legalmente correspondan.',true),
  ('6','No objeto de IVA',0::numeric,'NO_OBJETO',null,date '2026-01-01',null,'Catálogo SRI',true),
  ('7','Exento de IVA',0::numeric,'EXENTO',null,date '2026-01-01',null,'Catálogo SRI',true)
) as v(codigo_porcentaje,descripcion,tarifa,tipo,sector,fecha_desde,fecha_hasta,base_legal,activo)
where not exists (select 1 from catalogo_iva_sri c where c.codigo_porcentaje=v.codigo_porcentaje and c.fecha_desde=date '2026-01-01');

-- 3) Los productos activos configurados con el antiguo 15% pasan a la tarifa
-- general actual 15%. No se tocan comprobantes históricos.
update productos set tarifa_iva='13' where activo=true and tarifa_iva='15';

-- 4) Índices y recarga del esquema PostgREST.
create index if not exists idx_catalogo_iva_sri_vigencia_v9922
  on catalogo_iva_sri(codigo_porcentaje, fecha_desde, fecha_hasta, activo);
notify pgrst, 'reload schema';

commit;
