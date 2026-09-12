-- CONTSERTRIB v9.5.2 - endurecimiento de documentos SRI
-- Ejecutar DESPUÉS de las migraciones anteriores. No borra datos.

-- El backend conserva DEVUELTA para distinguir una devolución de recepción SRI
-- de un rechazo posterior. La versión anterior de la tabla no lo permitía.
alter table documentos_sri_borrador drop constraint if exists documentos_sri_borrador_estado_check;
alter table documentos_sri_borrador add constraint documentos_sri_borrador_estado_check
check (estado in ('borrador','listo','procesando','autorizado','rechazado','devuelto','anulado'));

alter table documentos_sri_borrador add column if not exists recepcion_sri text;
alter table documentos_sri_borrador add column if not exists fecha_emision timestamptz;
alter table documentos_sri_borrador add column if not exists intentos integer not null default 0;
alter table documentos_sri_borrador add column if not exists ultimo_error text;

create index if not exists idx_docs_sri_clave_acceso on documentos_sri_borrador(emisor_id, clave_acceso);
create index if not exists idx_docs_sri_estado on documentos_sri_borrador(emisor_id, estado, created_at desc);
