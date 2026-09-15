-- Configuración del sistema, proveedor de facturación, documentos complementarios y notificaciones.
create table if not exists configuracion_sistema (
  emisor_id uuid primary key references emisores(id) on delete cascade,
  ruc_proveedor_facturacion text,
  nombre_proveedor_facturacion text,
  incluir_ruc_proveedor boolean not null default true,
  notificaciones_activas boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists documentos_sri_borrador (
  id uuid primary key default gen_random_uuid(),
  emisor_id uuid not null references emisores(id) on delete cascade,
  tipo text not null check (tipo in ('nota_credito','nota_debito','liquidacion_compra','guia_remision','retencion')),
  estado text not null default 'borrador' check (estado in ('borrador','listo','procesando','autorizado','rechazado','anulado')),
  cliente_id uuid references clientes(id),
  comprobante_sustento_id uuid references comprobantes(id),
  datos jsonb not null default '{}'::jsonb,
  secuencial text,
  clave_acceso text,
  numero_autorizacion text,
  xml_firmado text,
  motivo_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_docs_sri_emisor_tipo on documentos_sri_borrador(emisor_id,tipo,created_at desc);

create or replace function touch_configuracion_sistema() returns trigger language plpgsql as $$
begin new.updated_at=now(); return new; end; $$;
drop trigger if exists trg_configuracion_sistema_touch on configuracion_sistema;
create trigger trg_configuracion_sistema_touch before update on configuracion_sistema for each row execute function touch_configuracion_sistema();

drop trigger if exists trg_documentos_sri_touch on documentos_sri_borrador;
create trigger trg_documentos_sri_touch before update on documentos_sri_borrador for each row execute function touch_configuracion_sistema();
