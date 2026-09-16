-- v9.9.21 — Archivo y notificación de comprobantes SRI complementarios.
-- ADITIVA: no elimina ni recalcula comprobantes históricos.
alter table documentos_sri_borrador add column if not exists email_estado text not null default 'pendiente';
alter table documentos_sri_borrador add column if not exists email_detalle text;
alter table documentos_sri_borrador add column if not exists email_enviado_at timestamptz;
create index if not exists idx_docs_sri_email on documentos_sri_borrador(emisor_id,email_estado,created_at desc);
notify pgrst, 'reload schema';
