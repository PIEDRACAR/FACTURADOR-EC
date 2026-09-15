# CONTSERTRIB v9.9.84

## SaaS · PayPhone · Resend · Panel Maestro

Esta versión conserva las funcionalidades existentes y corrige la robustez del flujo de contratación.

### Flujo
1. El cliente solicita un plan.
2. La solicitud se guarda en Supabase.
3. ROOT recibe la notificación por Resend cuando el correo está configurado.
4. Si no existe una promoción gratuita vigente, CONTSERTRIB solicita el link de pago a PayPhone.
5. El link se guarda en `pagos_solicitud_saas` y en `solicitudes_registro_saas`.
6. El cliente recibe el link por correo si Resend está operativo.
7. Si Resend falla, el link no se pierde: queda disponible para reenvío desde Panel Maestro y se muestra al cliente en la respuesta del registro.
8. PayPhone notifica a `/pagos/payphone/NotificacionPago`.
9. Se valida la transacción y se activa el plan automáticamente.

### Correcciones de esta versión
- Un error de Resend no invalida un link PayPhone ya generado.
- Un link existente cuyo correo falló puede reenviarse sin generar un segundo cobro.
- La respuesta del registro muestra `PAGAR AHORA` cuando existe `paymentLink`.
- Los errores HTTP de PayPhone se registran en `notificacion_admin_detalle` para diagnóstico.
- Se mantienen generación automática y generación/reenvío manual desde ROOT.
- Se mantienen las variables `PAYPHONE_TOKEN`, `PAYPHONE_STORE_ID`, `PAYPHONE_LINK_EXPIRE_HOURS`, `RESEND_API_KEY`, `EMAIL_FROM`, `PROVEEDOR_ADMIN_EMAILS` y `APP_URL`.

### Supabase
Ejecutar una vez:
`sql/migracion_v9984_PAYPHONE_RESEND_ROBUSTEZ.sql`

### PayPhone
La ruta de salud solo confirma que las variables existen; no confirma que PayPhone haya autorizado el token para API Link. Un rechazo de PayPhone quedará registrado con HTTP y respuesta del proveedor.
