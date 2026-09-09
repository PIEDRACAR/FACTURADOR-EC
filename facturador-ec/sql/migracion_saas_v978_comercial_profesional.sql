-- CONTSERTRIB v9.7.8 - Gestión comercial SaaS profesional.
-- Ejecutar después de migracion_saas_v977_alto_estandar.sql.

alter table if exists suscripciones
  add column if not exists precio_contratado numeric(12,2),
  add column if not exists fecha_cambio_plan date,
  add column if not exists prueba_usada_at date,
  add column if not exists ultimo_pago_at timestamptz,
  add column if not exists dias_gracia integer not null default 3,
  add column if not exists renovacion_automatica boolean not null default false;

update suscripciones s
set precio_contratado = p.precio_mensual
from planes_suscripcion p
where s.plan_id = p.id and s.precio_contratado is null;

alter table if exists suscripciones
  drop constraint if exists suscripciones_precio_contratado_chk;
alter table if exists suscripciones
  add constraint suscripciones_precio_contratado_chk check (precio_contratado is null or precio_contratado >= 0);

alter table if exists suscripciones
  drop constraint if exists suscripciones_dias_gracia_chk;
alter table if exists suscripciones
  add constraint suscripciones_dias_gracia_chk check (dias_gracia between 0 and 30);

alter table if exists pagos_suscripcion
  add column if not exists plan_codigo varchar(40),
  add column if not exists precio_plan numeric(12,2),
  add column if not exists comprobante_interno varchar(60),
  add column if not exists creado_por uuid references auth.users(id) on delete set null;

create index if not exists idx_pagos_suscripcion_referencia
  on pagos_suscripcion(emisor_id, referencia)
  where referencia is not null and length(trim(referencia)) > 0;

create index if not exists idx_suscripciones_vencimiento on suscripciones(proximo_vencimiento);
create index if not exists idx_suscripciones_prueba on suscripciones(prueba_usada_at);

-- Registro de cambios comerciales: conserva el precio y plan anteriores aunque se edite el catálogo.
create table if not exists historial_planes_saas (
  id uuid primary key default gen_random_uuid(),
  suscripcion_id uuid not null references suscripciones(id) on delete cascade,
  emisor_id uuid not null references emisores(id) on delete cascade,
  plan_anterior_id uuid references planes_suscripcion(id) on delete set null,
  plan_nuevo_id uuid not null references planes_suscripcion(id),
  precio_anterior numeric(12,2),
  precio_nuevo numeric(12,2),
  consumo_documentos_mes integer not null default 0,
  motivo varchar(300),
  actor_user_id uuid references auth.users(id) on delete set null,
  fecha_efectiva timestamptz not null default now()
);
create index if not exists idx_historial_planes_emisor_fecha on historial_planes_saas(emisor_id,fecha_efectiva desc);

-- Facturación interna del SaaS (no sustituye el comprobante electrónico SRI).
create table if not exists cargos_saas (
  id uuid primary key default gen_random_uuid(),
  suscripcion_id uuid not null references suscripciones(id) on delete cascade,
  emisor_id uuid not null references emisores(id) on delete cascade,
  plan_id uuid references planes_suscripcion(id) on delete set null,
  periodo_desde date not null,
  periodo_hasta date not null,
  monto numeric(12,2) not null check (monto >= 0),
  estado varchar(20) not null default 'pendiente' check (estado in ('pendiente','pagado','anulado','vencido')),
  referencia_pago varchar(150),
  fecha_pago date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(suscripcion_id,periodo_desde,periodo_hasta)
);
create index if not exists idx_cargos_saas_estado on cargos_saas(estado,periodo_hasta);
create index if not exists idx_cargos_saas_emisor on cargos_saas(emisor_id,periodo_hasta desc);

-- Reglas comerciales seguras por defecto.
update suscripciones set dias_gracia = 3 where dias_gracia is null;
