-- v9.10.4 - Trazabilidad del envío automático de facturas autorizadas por SRI.
-- No elimina ni modifica comprobantes existentes.

create table if not exists email_envios (
  id uuid primary key default gen_random_uuid(),
  comprobante_id uuid not null references comprobantes(id) on delete cascade,
  destinatario text not null,
  estado text not null check (estado in ('enviado','error')),
  detalle text,
  created_at timestamptz not null default now()
);

create index if not exists idx_email_envios_comprobante
  on email_envios(comprobante_id, created_at desc);

create index if not exists idx_email_envios_estado
  on email_envios(estado, created_at desc);
