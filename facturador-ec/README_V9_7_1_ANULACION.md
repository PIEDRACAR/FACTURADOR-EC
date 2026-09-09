# CONTSERTRIB v9.7.1 — Anulación de facturas

Se incorpora el flujo de anulación de facturas electrónicas conforme a la Resolución SRI NAC-DGERCGC25-00000014 y su reforma.

## Regla importante
El sistema **no simula ni inventa una respuesta del SRI**. La anulación en línea se realiza en SRI en Línea. CONTSERTRIB registra la solicitud, conserva el motivo y la evidencia operativa, y solo permite marcar la factura como `anulado` después de que el operador verifica el estado en SRI.

## Validaciones
- Solo factura autorizada.
- Motivo obligatorio.
- No permite consumidor final `9999999999999`.
- Controla la ventana del día 7 del mes siguiente y, si el día 7 cae en sábado, domingo o feriado, la extiende al siguiente día hábil.
- Si la ventana venció, informa que corresponde nota de crédito conforme al plazo aplicable.
- Registra auditoría `SOLICITUD_ANULACION` y `ANULACION_CONFIRMADA`.
- Mantiene los documentos históricos; no borra XML/RIDE.

## Supabase
Ejecutar una vez:
`sql/migracion_anulacion_facturas_v971.sql`

## Nota técnica
La ficha pública de facturación electrónica del SRI describe los servicios de emisión/recepción/autorización y mantiene la guía de anulación como trámite de SRI en Línea. Por seguridad tributaria no se implementa un endpoint privado/no documentado del SRI.
