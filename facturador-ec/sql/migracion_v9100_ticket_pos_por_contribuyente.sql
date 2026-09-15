-- CONTSERTRIB v9.10.0
-- Ticket/POS se controla individualmente por contribuyente.
-- No elimina datos ni modifica comprobantes históricos.

alter table if exists emisores
  add column if not exists ticket_pos_habilitado boolean not null default false;

-- Los contribuyentes que ya utilizaban Ticket antes de este cambio conservan el acceso.
-- Los nuevos contribuyentes creados desde esta versión nacen deshabilitados.
update emisores
set ticket_pos_habilitado = true
where id in (select distinct emisor_id from comprobantes where lower(coalesce(tipo,'')) = 'ticket')
  and ticket_pos_habilitado = false;

create index if not exists idx_emisores_ticket_pos_habilitado
  on emisores(ticket_pos_habilitado);
