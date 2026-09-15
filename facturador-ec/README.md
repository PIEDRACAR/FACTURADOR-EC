
## v9.9.98 — Reparación Ticket POS
- Corrige la restricción `comprobantes_estado_check` para permitir el estado interno `registrado` de tickets.
- `crear_venta` crea tickets directamente en estado `registrado`; las facturas continúan iniciando en `generado`.
- No modifica ni elimina datos históricos.
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

## v9.9.86 — Flujo SaaS PayPhone + Resend definitivo
- Sin promoción: la solicitud se registra, se genera PayPhone y se notifica a ROOT antes de crear la cuenta del cliente.
- La creación de cuenta ya no puede bloquear la generación del cobro.
- ROOT recibe en el correo el link PayPhone cuando existe y el error exacto cuando no.
- El cliente recibe el link cuando PayPhone lo genera; un fallo de Resend no elimina el cobro.
- El Panel Maestro muestra salud separada de Resend y PayPhone.
- El alta definitiva de un cliente sin promoción se completa después del pago aprobado.

### Diagnóstico rápido en producción
- PayPhone: `GET /pagos/payphone/health`
- Correo Resend: `GET /notificaciones/health`
- El correo ROOT usa primero `configuracion_proveedor.admin_emails`, después `PROVEEDOR_ADMIN_EMAILS` y finalmente `ROOT_ADMIN_EMAIL` como respaldo.

## v9.9.86 — Integridad de correo Resend
- Se conserva toda la funcionalidad SaaS, PayPhone, SRI, ERP y ROOT.
- Se reforzó el cliente Resend con validación de EMAIL_FROM, timeout de 15 s y errores exactos del proveedor.
- Se agregó diagnóstico seguro de Resend en `/correo-prueba/health` sin exponer la API key.
- La prueba de correo devuelve el ID real de Resend cuando el proveedor acepta el mensaje.
- El Panel Maestro incorpora diagnóstico de Resend junto al botón de prueba.


## v9.9.87 — Interfaz de emisión electrónica unificada
- Se conserva la lógica funcional existente de facturación, notas de crédito, notas de débito, liquidaciones de compra, guías de remisión y retenciones.
- Se unifica visualmente la estación de emisión con estilo ERP profesional, compacto y táctil.
- Las pestañas de comprobantes mantienen acceso a Factura y a todos los documentos electrónicos.
- Se mejora la adaptación a móvil sin eliminar formularios, cálculos, sustento, archivos, impresión, reenvío ni transmisión SRI.
- Cambios de esta versión: presentación/layout compartido en `public/app.css`, `public/pos.html` y `public/documentos.html`; no requiere migración SQL.
