-- CONTSERTRIB v9.10.3 — Panel Maestro
alter table if exists planes_suscripcion add column if not exists modulos_config jsonb not null default '{}'::jsonb;
create index if not exists idx_planes_suscripcion_activo_orden on planes_suscripcion(activo, orden);
create index if not exists idx_solicitudes_registro_estado on solicitudes_registro_saas(estado);
comment on column planes_suscripcion.modulos_config is 'Configuración comercial de módulos por plan. Las columnas legacy se conservan para compatibilidad.';
