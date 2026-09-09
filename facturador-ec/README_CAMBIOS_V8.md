# CONTSERTRIB FACTURACIÓN V8

Cambios principales:
- Centro de documentos con acceso visible a Nota de crédito, Nota de débito, Liquidación de compra, Guía de remisión y Retención.
- Configuración funcional: negocio activo, ambiente, datos del emisor, proveedor de facturación, RUC del proveedor, notificaciones y asociación de usuarios.
- Selector de negocios funcional desde la configuración y barra superior.
- Notificaciones funcionales para STOP/stock bajo, comprobantes rechazados y errores de correo.
- Consulta automática de cédula/RUC al completar 10/13 dígitos en POS y clientes.
- RUC de proveedor integrado a la configuración y validado antes de emitir una factura.

## Base de datos
Ejecutar en Supabase:
`sql/migracion_configuracion_documentos_notificaciones.sql`

La emisión de documentos complementarios debe conectarse al generador XML/XSD específico de cada tipo antes de usarse en producción; esta versión deja el centro, formularios, borradores y estructura de datos preparados sin fingir una autorización SRI que todavía no haya sido probada con el certificado real.
