# CONTSERTRIB v9.9.38 — Seguridad de procesamiento SRI

## Corrección principal
Resuelve el error de instalaciones donde PostgREST no reconoce `recepcion_sri` en `documentos_sri_borrador`.

### Protección de transmisión
- La clave de acceso, secuencial y XML original se persisten antes de iniciar la transmisión.
- Si una columna operativa nueva no está todavía en el schema cache, el backend reintenta la persistencia sin `recepcion_sri`, sin perder la clave/XML.
- Si la persistencia crítica falla, la transmisión NO inicia.
- Si la transmisión ya inició, el documento queda bloqueado en procesamiento y no se retransmite automáticamente.
- La consulta al SRI utiliza la misma clave; nunca genera otra clave automáticamente.
- La migración es autocontenida y crea/actualiza todas las columnas necesarias, índices y trigger.
- La migración ejecuta `NOTIFY pgrst, 'reload schema'`; Supabase documenta este mecanismo para recargar el schema cache de PostgREST.

## Migración
Ejecutar: `sql/migracion_contsertrib_v9938_seguridad_procesamiento_sri.sql` en Supabase SQL Editor antes de probar emisión.

No elimina comprobantes ni datos históricos.
