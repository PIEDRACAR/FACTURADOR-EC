# CONTSERTRIB v9.9.80 — PayPhone Production

## Cambios
- Webhook `POST /pagos/payphone/NotificacionPago` devuelve exactamente `{ "Response": true, "ErrorCode": "000" }` en éxito.
- Validación estricta de StoreId, moneda USD, StatusCode 3, TransactionStatus Approved, TransactionId, AuthorizationCode, ClientTransactionId y monto.
- Idempotencia: una notificación repetida no vuelve a activar el plan.
- Registro de la transacción y respuesta completa en Supabase.
- Activación automática del plan después de pago aprobado y validado.
- Creación/reactivación de emisor, matriz 001, punto 001, cuenta SaaS, relación del contribuyente y suscripción.
- Aviso a ROOT únicamente como auditoría; ya no se requiere activación manual.

## Railway
Requerido:
- PAYPHONE_TOKEN
- PAYPHONE_STORE_ID
- APP_URL=https://contsertrib.com
- PAYPHONE_LINK_EXPIRE_HOURS=24 (opcional)

## PayPhone
Configurar la Notificación Externa hacia:
`https://contsertrib.com/pagos/payphone/NotificacionPago`

La autorización de Notificación Externa debe estar aprobada por PayPhone; el código no puede conceder esa aprobación.

## Supabase
Ejecutar una vez:
`sql/migracion_v9980_payphone_produccion.sql`
