-- CONTSERTRIB v9.9.99 - Control de Ticket/POS desde Panel Maestro
-- Aditiva: no elimina datos ni modifica comprobantes existentes.

alter table if exists configuracion_proveedor
  add column if not exists ticket_pos_habilitado boolean not null default true;

alter table if exists planes_suscripcion
  add column if not exists incluye_ticket_pos boolean not null default true;

-- Los planes existentes conservan la funcionalidad Ticket/POS ya instalada.
update planes_suscripcion set incluye_ticket_pos = true where incluye_ticket_pos is null;

notify pgrst, 'reload schema';
