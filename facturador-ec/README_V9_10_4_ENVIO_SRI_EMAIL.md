# CONTSERTRIB v9.10.4 — SRI + correo automático de facturas

## Corrección principal
La ruta general de emisión de factura ahora mantiene el flujo:

1. Construye el XML.
2. Firma electrónicamente.
3. Transmite el XML firmado al Web Service del SRI.
4. Consulta la autorización con la misma clave de acceso.
5. Solo cuando el SRI devuelve `AUTORIZADO`, guarda/asegura XML + RIDE.
6. Envía automáticamente XML firmado + RIDE PDF al correo del cliente mediante Resend.
7. Registra `email_envios` como `enviado` o `error`.

Un fallo del correo **no revierte ni falsifica** la autorización del SRI; la factura permanece autorizada y queda trazado el error para reenvío.

## No se eliminaron funciones
POS, proformas y documentos complementarios conservan sus flujos existentes. La mejora cierra la ruta general de factura que era la que no tenía envío automático garantizado.

## SQL
Ejecutar:
`sql/migracion_v9104_envio_automatico_facturas_sri.sql`

No requiere modificar datos históricos.
