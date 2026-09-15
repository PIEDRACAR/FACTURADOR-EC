-- CONTSERTRIB v9.9.72
-- Compatibilidad de la tabla certificados.
-- El backend ya NO depende de updated_at para guardar/consultar firmas.
-- Esta columna es opcional para instalaciones que quieran mantener auditoría temporal.
alter table certificados add column if not exists updated_at timestamptz default now();
