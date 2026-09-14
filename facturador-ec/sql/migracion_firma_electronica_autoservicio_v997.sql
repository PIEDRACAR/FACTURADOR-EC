-- CONTSERTRIB: configuración de firma electrónica por contribuyente
alter table certificados add column if not exists p12_cifrado bytea;
alter table certificados add column if not exists p12_password_cifrado bytea;
alter table certificados add column if not exists fecha_expiracion date;
alter table certificados add column if not exists activo boolean default true;
alter table certificados add column if not exists alias text;
create unique index if not exists certificados_emisor_alias_uq_997 on certificados(emisor_id, alias);
