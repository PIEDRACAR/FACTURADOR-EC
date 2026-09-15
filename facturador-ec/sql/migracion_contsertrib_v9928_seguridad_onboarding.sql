-- CONTSERTRIB v9.9.28 — Seguridad, onboarding y salud del SaaS
-- Aditiva: no elimina documentos, empresas, usuarios ni historial.

create table if not exists auditoria_saas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  emisor_id uuid references emisores(id) on delete set null,
  evento varchar(80) not null,
  recurso varchar(120),
  recurso_id uuid,
  detalle jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_auditoria_saas_emisor_fecha on auditoria_saas(emisor_id,created_at desc);
create index if not exists idx_auditoria_saas_evento on auditoria_saas(evento,created_at desc);

alter table if exists solicitudes_registro_saas add column if not exists ip_origen inet;
alter table if exists solicitudes_registro_saas add column if not exists user_agent text;

notify pgrst, 'reload schema';
