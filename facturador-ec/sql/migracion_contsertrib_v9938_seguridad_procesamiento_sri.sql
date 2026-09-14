-- CONTSERTRIB v9.9.38
-- Migración autocontenida y compatible para documentos electrónicos complementarios.
-- No elimina datos históricos. Corrige instalaciones donde v9.9.37 no pudo ver recepcion_sri.

create extension if not exists pgcrypto;

create table if not exists documentos_sri_borrador (
  id uuid primary key default gen_random_uuid(),
  emisor_id uuid not null references emisores(id) on delete cascade,
  tipo text not null,
  estado text not null default 'borrador',
  cliente_id uuid references clientes(id),
  comprobante_sustento_id uuid references comprobantes(id),
  datos jsonb not null default '{}'::jsonb,
  secuencial text,
  clave_acceso text,
  numero_autorizacion text,
  xml_original text,
  xml_firmado text,
  motivo_error text,
  recepcion_sri text,
  fecha_emision timestamptz,
  fecha_autorizacion timestamptz,
  intentos integer not null default 0,
  ultimo_error text,
  email_estado text not null default 'pendiente',
  email_detalle text,
  email_enviado_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table documentos_sri_borrador add column if not exists emisor_id uuid references emisores(id) on delete cascade;
alter table documentos_sri_borrador add column if not exists tipo text;
alter table documentos_sri_borrador add column if not exists estado text default 'borrador';
alter table documentos_sri_borrador add column if not exists cliente_id uuid references clientes(id);
alter table documentos_sri_borrador add column if not exists comprobante_sustento_id uuid references comprobantes(id);
alter table documentos_sri_borrador add column if not exists datos jsonb not null default '{}'::jsonb;
alter table documentos_sri_borrador add column if not exists secuencial text;
alter table documentos_sri_borrador add column if not exists clave_acceso text;
alter table documentos_sri_borrador add column if not exists numero_autorizacion text;
alter table documentos_sri_borrador add column if not exists xml_original text;
alter table documentos_sri_borrador add column if not exists xml_firmado text;
alter table documentos_sri_borrador add column if not exists motivo_error text;
alter table documentos_sri_borrador add column if not exists recepcion_sri text;
alter table documentos_sri_borrador add column if not exists fecha_emision timestamptz;
alter table documentos_sri_borrador add column if not exists fecha_autorizacion timestamptz;
alter table documentos_sri_borrador add column if not exists intentos integer not null default 0;
alter table documentos_sri_borrador add column if not exists ultimo_error text;
alter table documentos_sri_borrador add column if not exists email_estado text not null default 'pendiente';
alter table documentos_sri_borrador add column if not exists email_detalle text;
alter table documentos_sri_borrador add column if not exists email_enviado_at timestamptz;
alter table documentos_sri_borrador add column if not exists created_at timestamptz not null default now();
alter table documentos_sri_borrador add column if not exists updated_at timestamptz not null default now();

-- Estados históricos y actuales de la aplicación.
alter table documentos_sri_borrador drop constraint if exists documentos_sri_borrador_estado_check;
alter table documentos_sri_borrador add constraint documentos_sri_borrador_estado_check
  check (estado in ('borrador','listo','procesando','autorizado','rechazado','devuelto','anulado'));

create index if not exists idx_docs_sri_emisor_tipo on documentos_sri_borrador(emisor_id,tipo,created_at desc);
create index if not exists idx_docs_sri_clave_acceso on documentos_sri_borrador(emisor_id,clave_acceso);
create index if not exists idx_docs_sri_estado on documentos_sri_borrador(emisor_id,estado,created_at desc);
create index if not exists idx_docs_sri_recepcion on documentos_sri_borrador(emisor_id,recepcion_sri,created_at desc);

create or replace function touch_documentos_sri_borrador() returns trigger language plpgsql as $$
begin new.updated_at=now(); return new; end; $$;

drop trigger if exists trg_documentos_sri_touch on documentos_sri_borrador;
create trigger trg_documentos_sri_touch before update on documentos_sri_borrador
for each row execute function touch_documentos_sri_borrador();

-- PostgREST debe recargar el catálogo de columnas después de la migración.
notify pgrst, 'reload schema';
