# CONTSERTRIB FACTURACIÓN v9.3 — mejoras profesionales

- Correo electrónico obligatorio en POS, con validación y autocompletado/consulta de identificación.
- Consulta automática de cédula (10 dígitos) y RUC (13 dígitos) al completar el número; la consulta se hace en backend.
- Proveedor del sistema protegido: el RUC del proveedor se administra centralmente en Railway mediante `RUC_PROVEEDOR_FACTURACION` y ya no se puede editar desde Configuración.
- Centro de notificaciones profesional: panel, prioridades, contador de no leídas, lectura individual y lectura de todas, persistidas por usuario/negocio.
- Botón Usuario convertido en menú funcional: gestión de usuarios, configuración y cierre de sesión.

## SQL
Ejecutar una sola vez en Supabase: `sql/migracion_notificaciones_profesionales_v93.sql`.

## Railway
Configurar `RUC_PROVEEDOR_FACTURACION` con el RUC real del proveedor del sistema y mantenerlo como variable privada.
