-- CONTSERTRIB v9.9.58 — Solicitud → link de pago → notificación → activación ROOT
-- Aditiva. No elimina clientes, suscripciones, pagos ni historial.
create extension if not exists pgcrypto;

create table if not exists pagos_solicitud_saas (
  id uuid primary key default gen_random_uuid(),
  solicitud_id uuid not null references solicitudes_registro_saas(id) on delete cascade,
  plan_id uuid references planes_suscripcion(id),
  monto numeric(12,2) not null check (monto > 0),
  moneda varchar(3) not null default 'USD',
  proveedor varchar(30) not null default 'payphone',
  estado varchar(30) not null default 'pendiente_pago' check (estado in ('pendiente_pago','link_generado','pagado','rechazado','expirado','cancelado')),
  client_transaction_id varchar(15) unique,
  payment_link text,
  payment_id text,
  transaction_id text,
  authorization_code text,
  transaction_status text,
  metodo_pago text,
  referencia text,
  respuesta_proveedor jsonb,
  notificacion_cliente_estado varchar(20) default 'pendiente',
  notificacion_admin_estado varchar(20) default 'pendiente',
  pagado_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_pago_solicitud_activo on pagos_solicitud_saas(solicitud_id)
  where estado in ('pendiente_pago','link_generado','pagado');
create index if not exists idx_pago_solicitud_estado on pagos_solicitud_saas(estado, created_at desc);
create index if not exists idx_pago_solicitud_tx on pagos_solicitud_saas(client_transaction_id);

alter table solicitudes_registro_saas add column if not exists pago_id uuid references pagos_solicitud_saas(id);
alter table solicitudes_registro_saas add column if not exists pago_estado varchar(30) default 'pendiente_pago';
alter table solicitudes_registro_saas add column if not exists pago_link text;
alter table solicitudes_registro_saas add column if not exists pago_monto numeric(12,2);
alter table solicitudes_registro_saas add column if not exists pago_notificado_at timestamptz;

notify pgrst, 'reload schema';
