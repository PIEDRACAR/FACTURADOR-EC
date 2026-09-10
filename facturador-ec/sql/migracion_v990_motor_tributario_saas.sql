-- CONTSERTRIB v9.9.0
-- Motor tributario dinámico + facturación automática de pagos SaaS.
-- Ejecutar después de las migraciones anteriores.

-- 1) Configuración tributaria: valores por defecto vigentes a la fecha de esta versión.
-- El código no debe asumir que una tarifa futura será 13%; la fecha y el código SRI
-- deben quedar configurables y los comprobantes históricos no se recalculan.
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

insert into catalogo_iva_sri(codigo_porcentaje,descripcion,tarifa,tipo,base_legal,activo)
values
 ('0','IVA tarifa 0%',0,'TARIFA','Catálogo SRI',true),
 ('6','No objeto de IVA',0,'NO_OBJETO','LRTI / catálogo SRI',true),
 ('7','Exento de IVA',0,'EXENTO','LRTI / catálogo SRI',true),
 ('4','IVA tarifa general vigente',13,'TARIFA','Configuración vigente del SRI',true)
on conflict do nothing;

alter table if exists configuracion_iva
  add column if not exists tarifa_general numeric(5,2);
update configuracion_iva set tarifa_general=13 where tarifa_general=15;

alter table if exists configuracion_iva
  add column if not exists codigo_no_objeto varchar(10) not null default '6',
  add column if not exists codigo_exento varchar(10) not null default '7';

-- Los comprobantes históricos ya guardados conservan su detalle en comprobante_impuestos.
-- Se añade snapshot legal para auditoría de futuras reformas.
alter table if exists comprobante_impuestos
  add column if not exists descripcion varchar(120),
  add column if not exists base_legal varchar(250),
  add column if not exists fecha_vigencia date;

-- 2) Facturación SaaS: vincular cada pago a su comprobante de venta.
alter table if exists pagos_suscripcion
  add column if not exists comprobante_id uuid references comprobantes(id) on delete set null,
  add column if not exists estado_factura varchar(20) not null default 'pendiente',
  add column if not exists error_factura text,
  add column if not exists subtotal_facturado numeric(12,2),
  add column if not exists iva_facturado numeric(12,2),
  add column if not exists tarifa_iva_facturada numeric(7,4),
  add column if not exists codigo_porcentaje_iva_facturado varchar(10);

create unique index if not exists ux_pagos_suscripcion_comprobante
  on pagos_suscripcion(comprobante_id) where comprobante_id is not null;
create index if not exists idx_pagos_suscripcion_factura_estado
  on pagos_suscripcion(estado_factura, fecha_pago desc);

create table if not exists facturas_saas (
  id uuid primary key default gen_random_uuid(),
  pago_suscripcion_id uuid not null unique references pagos_suscripcion(id) on delete cascade,
  comprobante_id uuid unique references comprobantes(id) on delete set null,
  cliente_emisor_id uuid not null references emisores(id) on delete cascade,
  proveedor_emisor_id uuid not null references emisores(id) on delete restrict,
  plan_id uuid references planes_suscripcion(id) on delete set null,
  descripcion varchar(500) not null,
  subtotal numeric(12,2) not null default 0,
  tarifa_iva numeric(7,4) not null default 0,
  codigo_porcentaje_iva varchar(10) not null default '0',
  iva numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  estado varchar(20) not null default 'pendiente',
  clave_acceso varchar(64),
  numero_autorizacion varchar(64),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_facturas_saas_cliente on facturas_saas(cliente_emisor_id,created_at desc);
create index if not exists idx_facturas_saas_estado on facturas_saas(estado,created_at desc);

-- 3) Historial de cambios de tarifa para auditoría.
create table if not exists historial_configuracion_iva (
  id uuid primary key default gen_random_uuid(),
  emisor_id uuid not null references emisores(id) on delete cascade,
  tarifa_general numeric(7,4), codigo_general varchar(10),
  tarifa_reducida numeric(7,4), codigo_reducida varchar(10),
  tarifa_turismo numeric(7,4), codigo_turismo varchar(10),
  motivo varchar(500), actualizado_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table facturas_saas is 'Factura comercial emitida por CONTSERTRIB al cliente SaaS por cada pago cobrado.';
comment on column pagos_suscripcion.monto is 'Importe total efectivamente cobrado al cliente, incluyendo IVA cuando corresponda.';
