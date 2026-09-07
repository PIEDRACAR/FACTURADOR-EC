-- ============================================
-- MIGRACIÓN: certificados cifrados en base de datos
-- Ejecutar en el SQL Editor de Supabase (una sola vez).
--
-- Reemplaza el esquema anterior (P12_PASSWORD__<alias>,
-- P12_BASE64__<alias> como variables de entorno de Railway) por columnas
-- cifradas en la propia tabla `certificados`, cifradas con la llave
-- maestra SECRETS_ENCRYPTION_KEY (ver src/crypto/secrets.ts).
--
-- La columna `referencia_almacenamiento` ya no se usa para resolver el
-- certificado en tiempo de emisión, pero se conserva por compatibilidad
-- con datos existentes; puedes dejarla vacía en registros nuevos.
-- ============================================

alter table certificados
  add column if not exists p12_cifrado bytea,
  add column if not exists p12_password_cifrado bytea;

comment on column certificados.p12_cifrado is
  'Archivo .p12 cifrado con AES-256-GCM usando SECRETS_ENCRYPTION_KEY. Nunca en texto plano.';
comment on column certificados.p12_password_cifrado is
  'Contraseña del .p12 cifrada con AES-256-GCM usando SECRETS_ENCRYPTION_KEY. Nunca en texto plano.';
