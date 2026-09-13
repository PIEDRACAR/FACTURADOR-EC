# CONTSERTRIB v9.9.61 — Corrección Payphone

## Decisión de integración
Esta versión usa **API Link** (`https://pay.payphonetodoesposible.com/api/Links`), no Botón/Cajita. Por eso en Payphone Developers se debe crear/configurar la aplicación como **API**.

## Notificación externa
Webhook principal:
`https://contsertrib.com/pagos/payphone/NotificacionPago`

Alias compatible:
`https://contsertrib.com/pagos/payphone/notificacion`

El endpoint devuelve `Response: true` y `ErrorCode: 000` cuando procesa correctamente la notificación, conforme al formato documentado por Payphone.

## Variables Railway
- `PAYPHONE_TOKEN`
- `PAYPHONE_STORE_ID`
- `PAYPHONE_LINK_EXPIRE_HOURS`

## Importante
La Notificación Externa de Payphone requiere autorización previa. La aplicación API y el webhook son cosas distintas: la aplicación API permite generar el Link; la Notificación Externa permite que Payphone avise a CONTSERTRIB de un pago aprobado.
