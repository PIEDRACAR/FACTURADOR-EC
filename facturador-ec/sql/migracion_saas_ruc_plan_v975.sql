-- CONTSERTRIB v9.7.5
-- Alta comercial por RUC: datos SRI, cambio de plan y activación de vigencia.

alter table if exists emisores
  add column if not exists estado_ruc_sri varchar(40),
  add column if not exists actividad_economica_principal text,
  add column if not exists codigo_actividad_economica varchar(30),
  add column if not exists tipo_contribuyente_sri varchar(100),
  add column if not exists regimen_sri varchar(100),
  add column if not exists representante_legal_sri text,
  add column if not exists agente_retencion_sri text,
  add column if not exists contribuyente_especial_sri text,
  add column if not exists correo_sri varchar(320),
  add column if not exists telefono_sri varchar(80),
  add column if not exists datos_ruc_sri jsonb,
  add column if not exists fecha_consulta_ruc_sri timestamptz;

create index if not exists idx_emisores_ruc_sri_estado on emisores(estado_ruc_sri);
create index if not exists idx_emisores_ruc_sri_consulta on emisores(fecha_consulta_ruc_sri);

-- Historial de cambios comerciales del plan para trazabilidad.
create table if not exists historial_planes_saas (
  id uuid primary key default gen_random_uuid(),
  cuenta_id uuid references cuentas_cliente_saas(id) on delete set null,
  emisor_id uuid references emisores(id) on delete set null,
  plan_anterior_id uuid references planes_suscripcion(id) on delete set null,
  plan_nuevo_id uuid references planes_suscripcion(id) on delete set null,
  fecha_cambio timestamptz not null default now(),
  nota text
);
create index if not exists idx_historial_planes_saas_cuenta on historial_planes_saas(cuenta_id, fecha_cambio desc);
