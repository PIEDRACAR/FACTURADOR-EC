-- v9.7.1 - Flujo de anulación de comprobantes electrónicos.
-- IMPORTANTE: el SRI no expone en la ficha técnica de emisión offline un método
-- público equivalente a emitirFactura para ejecutar la anulación desde el SaaS.
-- Por eso el sistema registra la solicitud, abre SRI en Línea y solo permite
-- marcar ANULADO cuando el operador confirma que SRI ya refleja ese estado.

create table if not exists solicitudes_anulacion_sri (
 id uuid primary key default gen_random_uuid(),
 emisor_id uuid not null,
 comprobante_id uuid,
 clave_acceso text not null,
 tipo_documento text not null,
 motivo text not null,
 estado text not null default 'pendiente' check (estado in ('pendiente','anulado','rechazado','cancelado')),
 requiere_aceptacion boolean not null default false,
 fecha_solicitud timestamptz not null default now(),
 fecha_limite timestamptz,
 respuesta_receptor text,
 fecha_respuesta timestamptz,
 detalle jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);

create index if not exists idx_anulaciones_sri_comprobante on solicitudes_anulacion_sri(comprobante_id, created_at desc);
create index if not exists idx_anulaciones_sri_clave on solicitudes_anulacion_sri(clave_acceso, created_at desc);

alter table comprobantes add column if not exists fecha_anulacion timestamptz;
alter table comprobantes add column if not exists motivo_anulacion text;
create index if not exists idx_comprobantes_anulados on comprobantes(emisor_id, estado, fecha_anulacion desc);
