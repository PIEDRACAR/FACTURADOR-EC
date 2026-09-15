# CONTSERTRIB FACTURACIÓN v9.5.0

## Mejoras
- Listado de ventas: botón **🖨 Ticket** para reimpresión en 80 mm, sin volver a emitir el comprobante.
- Reimpresión registrada como evento de auditoría.
- Nuevo reporte **Auditoría SRI** con checklist de controles y últimos eventos.
- Trazabilidad de respuesta del SRI y errores de emisión.
- Verificación de RUC del proveedor en una muestra de XML autorizados.
- Cobertura del archivo permanente de comprobantes.
- Indicador de comprobantes rechazados/devueltos.
- Auditoría por usuario, correo, evento, estado, secuencial y clave de acceso.
- Exportación de la auditoría a Excel/PDF.

## Migración obligatoria
Ejecutar en Supabase SQL Editor:

`sql/migracion_auditoria_v950.sql`

Si la instalación todavía no ejecutó la migración general de cumplimiento, ejecutar también:

`sql/migracion_sri_cumplimiento_v9.sql`

## Importante sobre cumplimiento
La auditoría del sistema es un control técnico interno; no constituye por sí sola una certificación legal del SRI. Las obligaciones deben validarse contra el RUC, autorizaciones, certificado de firma y normativa/fichas técnicas vigentes.
