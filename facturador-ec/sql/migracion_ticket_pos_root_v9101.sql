-- CONTSERTRIB v9.10.1 — Ticket/POS con autorización individual por contribuyente.
-- La activación NO es autogestionable por el contribuyente: únicamente el
-- administrador ROOT/Panel Maestro puede cambiar ticket_pos_habilitado.
-- Ejecutar una sola vez en Supabase. Es aditiva e idempotente.

alter table if exists planes_suscripcion
  add column if not exists incluye_ticket_pos boolean not null default false;

alter table if exists contribuyentes_cliente_saas
  add column if not exists ticket_pos_habilitado boolean not null default false,
  add column if not exists ticket_pos_updated_at timestamptz,
  add column if not exists ticket_pos_updated_by uuid references auth.users(id) on delete set null,
  add column if not exists ticket_pos_motivo text;

create index if not exists idx_contribuyentes_ticket_pos
  on contribuyentes_cliente_saas(ticket_pos_habilitado, activo);

create table if not exists auditoria_ticket_pos (
  id uuid primary key default gen_random_uuid(),
  cuenta_id uuid references cuentas_cliente_saas(id) on delete set null,
  emisor_id uuid references emisores(id) on delete set null,
  habilitado boolean not null,
  estado_anterior boolean not null default false,
  motivo text,
  realizado_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_auditoria_ticket_pos_emisor
  on auditoria_ticket_pos(emisor_id, created_at desc);

create index if not exists idx_auditoria_ticket_pos_cuenta
  on auditoria_ticket_pos(cuenta_id, created_at desc);

comment on column contribuyentes_cliente_saas.ticket_pos_habilitado is
  'Autorización individual de Ticket/POS administrada exclusivamente por ROOT desde Panel Maestro.';
comment on column planes_suscripcion.incluye_ticket_pos is
  'Indica si el plan permite que ROOT autorice Ticket/POS a contribuyentes de ese plan.';
