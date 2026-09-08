# Archivo permanente XML + RIDE — CONTSERTRIB FACTURACIÓN

Esta versión archiva automáticamente cada factura que termina en estado `AUTORIZADO` por el SRI:

- XML firmado en Supabase Storage.
- RIDE PDF generado por CONTSERTRIB en Supabase Storage.
- Índice y metadatos en `public.comprobante_archivos`.
- Bucket privado `comprobantes`.
- SHA-256 de cada archivo para integridad.
- URLs firmadas por 1 hora mediante `GET /comprobantes/:id/archivos`.

## Migración SQL

Ejecutar una sola vez en Supabase SQL Editor:

`sql/migracion_archivo_comprobantes_storage.sql`

El bucket se crea automáticamente desde el backend mediante la API de Supabase Storage y queda privado.

## Importante

El sistema conserva también `comprobantes.xml_firmado` como respaldo inmediato. El archivo documental en Storage es la copia permanente organizada por emisor/año/clave de acceso.

Si Storage no está disponible durante una autorización, la factura NO se marca como rechazada: queda autorizada por el SRI y se registra el fallo en `log_firmas` para poder reintentar.
