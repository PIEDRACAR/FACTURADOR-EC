# CONTSERTRIB v9.10.2 — Listado de ventas optimizado

## Problema corregido
El reporte **Listado de ventas** podía permanecer indefinidamente en “Consultando…”, especialmente cuando la tabla `comprobantes` tenía un volumen considerable o la consulta relacional tardaba.

## Correcciones
- Consulta del listado limitada a 1.000 filas para la vista de pantalla.
- Índices compuestos por `emisor_id + created_at` y `emisor_id + estado + created_at`.
- Tiempo máximo de espera en backend para evitar respuestas colgadas.
- `AbortController` en frontend para que la pantalla nunca quede bloqueada indefinidamente.
- Evita que una consulta anterior sobrescriba una consulta nueva.
- Mantiene filtros por fecha, acciones XML/PDF/Ticket/Reenvío/Anulación.
- La exportación conserva hasta 5.000 filas mediante el mismo servicio.
- No elimina ni modifica ventas existentes.

## Supabase
Ejecutar una sola vez:
`sql/migracion_reportes_listado_ventas_optimizado_v9102.sql`

La migración utiliza `CREATE INDEX IF NOT EXISTS` y no borra datos.
