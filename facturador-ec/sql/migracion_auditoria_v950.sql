-- v9.5.0 Auditoría y trazabilidad reforzada
-- Ejecutar una sola vez en Supabase.

alter table if exists auditoria_sri add column if not exists user_id uuid;
alter table if exists auditoria_sri add column if not exists usuario_email text;
alter table if exists auditoria_sri add column if not exists comprobante_id uuid;
alter table if exists auditoria_sri add column if not exists documento_id uuid;
alter table if exists auditoria_sri add column if not exists detalle jsonb not null default '{}'::jsonb;
create index if not exists idx_auditoria_sri_emisor_usuario on auditoria_sri(emisor_id,user_id,created_at desc);
create index if not exists idx_auditoria_sri_evento on auditoria_sri(emisor_id,evento,created_at desc);
create index if not exists idx_auditoria_sri_comprobante on auditoria_sri(comprobante_id,created_at desc);
