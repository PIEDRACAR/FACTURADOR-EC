# CONTSERTRIB v9.9.61 — Catálogo comercial + contratación y pago

## Objetivo
La página pública `/planes` muestra el catálogo comercial desde `planes_suscripcion`. El Panel Maestro sigue siendo la fuente editable de precios, límites, modalidad y módulos.

## Flujo
1. Cliente entra a `/planes`.
2. Selecciona mensual/anual y un plan.
3. `/registro?plan=CODIGO` precarga el plan.
4. Envía RUC, razón social, correo y dirección.
5. `/emisores/registrar` crea una solicitud pendiente y genera automáticamente el link Payphone si las credenciales están configuradas.
6. El link se envía al correo del cliente.
7. Payphone notifica a `/pagos/payphone/notificacion` cuando el pago es aprobado.
8. El sistema registra el pago y notifica al ROOT.
9. ROOT revisa y activa manualmente la cuenta.

## Catálogo
Ejecutar una sola vez en Supabase:
`sql/migracion_catalogo_planes_v960.sql`

El catálogo se basa en `README_PLANES_PRECIOS_v960.txt` y conserva el historial: los planes anteriores se desactivan para nuevas ventas, pero no se borran.

## Railway
Verificar:
- `PAYPHONE_TOKEN`
- `PAYPHONE_STORE_ID`
- `PAYPHONE_LINK_EXPIRE_HOURS=24`
- `RESEND_API_KEY`
- `EMAIL_FROM`
- `APP_URL=https://facturador-ec-production.up.railway.app`

Webhook Payphone:
`https://facturador-ec-production.up.railway.app/pagos/payphone/notificacion`

## Regla comercial a confirmar antes de producción
El catálogo indica **7 días gratis**, mientras el flujo de contratación actual genera el enlace de pago inmediatamente después de enviar la solicitud. Si la intención comercial es que el cliente pruebe 7 días y recién después pague, debe cambiarse el momento de generación del cobro. Esta versión no inventa esa regla y conserva el flujo solicitado de enlace automático al enviar la solicitud.

## Precios comerciales — fuente autorizada
Los precios comerciales deben coincidir exactamente con `CONTSERTRIB_planes_precios.txt`. No se deben introducir precios alternativos ni valores de ejemplo. La migración `sql/migracion_catalogo_planes_v960.sql` es el catálogo autorizado para la publicación de planes.
