-- ============================================
-- MIGRACIÓN: constraint único en certificados (emisor_id, alias)
-- Ejecutar en el SQL Editor de Supabase (una sola vez).
--
-- POR QUÉ: /emisores/registrar ahora actualiza el certificado de un
-- emisor existente (por ejemplo, para renovar un certificado vencido, o
-- para corregir un registro hecho antes de que existiera el cifrado) en
-- vez de fallar con "RUC ya registrado". Esa actualización usa un
-- `upsert` de Postgres con `onConflict: 'emisor_id,alias'`, que requiere
-- que exista un constraint único sobre esas dos columnas — sin este
-- constraint, el upsert falla.
-- ============================================

alter table certificados
  add constraint certificados_emisor_alias_unico unique (emisor_id, alias);
