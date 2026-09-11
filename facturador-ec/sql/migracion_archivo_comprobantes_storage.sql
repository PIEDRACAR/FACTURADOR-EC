-- Archivo documental permanente de comprobantes autorizados.
-- Los objetos reales viven en Supabase Storage; esta tabla conserva su índice,
-- rutas y metadatos para poder localizarlos desde CONTSERTRIB.

create table if not exists comprobante_archivos (
  id uuid primary key default gen_random_uuid(),
  comprobante_id uuid not null references comprobantes(id) on delete cascade,
  emisor_id uuid not null references emisores(id) on delete cascade,
  tipo text not null check (tipo in ('xml_firmado','ride_pdf')),
  bucket text not null default 'comprobantes',
  storage_path text not null,
  mime_type text not null,
  nombre_archivo text not null,
  tamano_bytes bigint,
  sha256 text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (comprobante_id, tipo)
);

create index if not exists idx_comprobante_archivos_comprobante
  on comprobante_archivos(comprobante_id, tipo);

create index if not exists idx_comprobante_archivos_emisor
  on comprobante_archivos(emisor_id, created_at desc);

create or replace function touch_comprobante_archivos() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

drop trigger if exists trg_comprobante_archivos_touch on comprobante_archivos;
create trigger trg_comprobante_archivos_touch
before update on comprobante_archivos
for each row execute function touch_comprobante_archivos();

-- IMPORTANTE: el bucket se crea desde el backend mediante la API de Storage
-- para respetar el modelo de Supabase Storage. Debe ser PRIVADO.
