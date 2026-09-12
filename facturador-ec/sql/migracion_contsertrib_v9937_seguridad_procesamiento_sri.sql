-- CONTSERTRIB v9.9.37
-- Seguridad de documentos electrónicos en procesamiento.
-- No elimina ni modifica comprobantes históricos.

alter table documentos_sri_borrador add column if not exists recepcion_sri text;
alter table documentos_sri_borrador add column if not exists ultimo_error text;
alter table documentos_sri_borrador add column if not exists xml_original text;

create index if not exists idx_docs_sri_procesando_seguro
  on documentos_sri_borrador(emisor_id, estado, recepcion_sri, created_at desc);

notify pgrst, 'reload schema';
