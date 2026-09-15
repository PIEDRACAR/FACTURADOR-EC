-- CONTSERTRIB v9.9.29 — Notificaciones de solicitudes al ROOT
-- Autocontenida: puede ejecutarse aunque v9.9.26 no se haya aplicado.
-- Aditiva: no elimina solicitudes, empresas, usuarios, comprobantes ni historial.
create extension if not exists pgcrypto;

create table if not exists solicitudes_registro_saas (
  id uuid primary key default gen_random_uuid(),
  ruc varchar(13) not null,
  razon_social text not null,
  nombre_comercial text,
  email text not null,
  direccion_matriz text not null,
  plan_codigo text not null default 'BASICO',
  ambiente text not null default 'produccion' check (ambiente in ('pruebas','produccion')),
  estado text not null default 'pendiente' check (estado in ('pendiente','en_revision','atendida','rechazada')),
  observacion text,
  creado_at timestamptz not null default now(),
  revisado_at timestamptz,
  revisado_por uuid,
  ip_origen inet,
  user_agent text,
  notificacion_admin_estado text not null default 'pendiente',
  notificacion_admin_detalle text,
  notificacion_admin_enviado_at timestamptz
);

alter table solicitudes_registro_saas add column if not exists ip_origen inet;
alter table solicitudes_registro_saas add column if not exists user_agent text;
alter table solicitudes_registro_saas add column if not exists notificacion_admin_estado text not null default 'pendiente';
alter table solicitudes_registro_saas add column if not exists notificacion_admin_detalle text;
alter table solicitudes_registro_saas add column if not exists notificacion_admin_enviado_at timestamptz;

create index if not exists idx_solicitudes_registro_estado_fecha on solicitudes_registro_saas(estado, creado_at desc);
create index if not exists idx_solicitudes_registro_ruc on solicitudes_registro_saas(ruc);
create index if not exists idx_solicitudes_registro_email on solicitudes_registro_saas(lower(email));
create index if not exists idx_solicitudes_registro_notificacion on solicitudes_registro_saas(notificacion_admin_estado, creado_at desc);

create table if not exists configuracion_proveedor (
  id integer primary key check (id = 1),
  admin_emails text[] not null default '{}',
  actualizado_por uuid,
  updated_at timestamptz not null default now()
);

notify pgrst, 'reload schema';
