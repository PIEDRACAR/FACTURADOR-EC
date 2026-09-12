-- CONTSERTRIB v9.9.26
-- Registro público controlado: no concede acceso ni crea clientes activos.
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
  revisado_por uuid
);
create index if not exists idx_solicitudes_registro_estado_fecha on solicitudes_registro_saas(estado, creado_at desc);
create index if not exists idx_solicitudes_registro_ruc on solicitudes_registro_saas(ruc);
create index if not exists idx_solicitudes_registro_email on solicitudes_registro_saas(lower(email));
