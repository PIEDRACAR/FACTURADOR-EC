# CONTSERTRIB v9.9.59 — Flujo automático de pago SaaS

## Flujo comercial

1. El cliente entra a `/planes` y selecciona su plan.
2. En `/registro?plan=...` completa RUC, razón social, correo y dirección.
3. Al enviar la solicitud, el backend crea la solicitud SaaS sin crear acceso ni activar una empresa.
4. CONTSERTRIB genera automáticamente un link de pago Payphone para el importe exacto del plan y lo envía al correo del cliente.
5. Payphone notifica al webhook público `/pagos/payphone/notificacion` cuando el cobro es aprobado.
6. El sistema valida la referencia, StoreID y monto, marca el pago como `pagado` y envía una notificación a ROOT.
7. ROOT abre el Panel Maestro, verifica el pago y pulsa `Activar → crear cliente`.
8. El backend no permite convertir una solicitud pública en cliente SaaS mediante `solicitudId` si el pago no está aprobado.
9. La creación final genera la cuenta, RUC, matriz 001, punto 001, usuario administrador y suscripción activa según el plan.

## Payphone

Variables de Railway:

- `PAYPHONE_TOKEN` — Bearer Token de la aplicación Payphone.
- `PAYPHONE_STORE_ID` — StoreID del comercio.
- `PAYPHONE_LINK_EXPIRE_HOURS` — horas de validez del link (1–168, recomendado 24).

El webhook que debes registrar en Payphone es:

`https://facturador-ec-production.up.railway.app/pagos/payphone/notificacion`

Si el dominio principal ya apunta al backend, también puede usarse:

`https://contsertrib.com/pagos/payphone/notificacion`

## Base de datos

Ejecutar en Supabase SQL Editor:

`sql/migracion_pago_saas_payphone_v958.sql`

La migración es aditiva y crea `pagos_solicitud_saas` y las columnas de trazabilidad en `solicitudes_registro_saas`.

## Seguridad

- No se almacenan datos de tarjetas.
- El link de pago nunca se genera desde el navegador.
- La activación no ocurre automáticamente por el webhook.
- Se verifica que el `clientTransactionId` pertenezca a un cobro creado por CONTSERTRIB.
- Se verifica el StoreID cuando Payphone lo envía.
- Se verifica que el monto aprobado coincida con el monto solicitado.
- Los pagos duplicados no vuelven a activar ni a generar notificaciones de activación.
