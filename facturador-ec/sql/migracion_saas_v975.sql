-- CONTSERTRIB v9.7.5 - Gestión comercial SaaS profesional
-- Ejecutar después de migracion_saas_v970.sql

alter table if exists suscripciones add column if not exists dias_gracia integer not null default 7;
alter table if exists suscripciones add column if not exists fecha_gracia_hasta date;
alter table if exists suscripciones add column if not exists nivel_bloqueo varchar(20) not null default 'normal';
alter table if exists suscripciones add column if not exists motivo_activacion varchar(120);

create table if not exists historial_suscripciones (
  id uuid primary key default gen_random_uuid(),
  suscripcion_id uuid not null references suscripciones(id) on delete cascade,
  emisor_id uuid not null references emisores(id) on delete cascade,
  cuenta_id uuid,
  accion varchar(40) not null,
  plan_anterior_id uuid references planes_suscripcion(id),
  plan_nuevo_id uuid references planes_suscripcion(id),
  estado_anterior varchar(20),
  estado_nuevo varchar(20),
  fecha_anterior date,
  fecha_nueva date,
  monto numeric(12,2),
  nota varchar(500),
  created_at timestamptz not null default now()
);
create index if not exists idx_historial_suscripciones_emisor on historial_suscripciones(emisor_id, created_at desc);

create table if not exists recibos_suscripcion (
  id uuid primary key default gen_random_uuid(),
  pago_id uuid references pagos_suscripcion(id) on delete set null,
  suscripcion_id uuid not null references suscripciones(id) on delete cascade,
  emisor_id uuid not null references emisores(id) on delete cascade,
  numero varchar(30) not null unique,
  concepto varchar(250) not null,
  subtotal numeric(12,2) not null default 0,
  iva numeric(12,2) not null default 0,
  total numeric(12,2) not null,
  created_at timestamptz not null default now()
);

alter table if exists cuentas_cliente_saas add column if not exists fecha_alta date;
alter table if exists cuentas_cliente_saas add column if not exists notas_comerciales varchar(500);
