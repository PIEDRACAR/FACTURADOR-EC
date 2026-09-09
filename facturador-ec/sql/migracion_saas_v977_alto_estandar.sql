-- CONTSERTRIB v9.7.7 - SaaS: validaciones, auditoría y gestión comercial robusta.
-- Ejecutar después de las migraciones SaaS existentes.

create table if not exists auditoria_saas (
  id uuid primary key default gen_random_uuid(),
  cuenta_id uuid references cuentas_cliente_saas(id) on delete set null,
  emisor_id uuid references emisores(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  accion varchar(60) not null,
  detalle jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_auditoria_saas_emisor_fecha on auditoria_saas(emisor_id,created_at desc);
create index if not exists idx_auditoria_saas_cuenta_fecha on auditoria_saas(cuenta_id,created_at desc);

alter table if exists suscripciones
  add column if not exists modalidad varchar(20) not null default 'pagada',
  add column if not exists ultima_activacion date,
  add column if not exists dias_activacion integer;

alter table if exists suscripciones
  drop constraint if exists suscripciones_modalidad_chk;
alter table if exists suscripciones
  add constraint suscripciones_modalidad_chk check (modalidad in ('prueba','pagada','cortesia'));

alter table if exists cuentas_cliente_saas
  add column if not exists ruc_principal varchar(13),
  add column if not exists datos_ruc_verificados boolean not null default false,
  add column if not exists ultimo_ruc_verificado_at timestamptz;
create index if not exists idx_cuentas_cliente_saas_ruc on cuentas_cliente_saas(ruc_principal);

-- No se almacenan contraseñas ni secretos en auditoría.
