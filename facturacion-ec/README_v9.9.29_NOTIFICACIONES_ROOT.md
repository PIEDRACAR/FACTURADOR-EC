# CONTSERTRIB v9.9.29 — Notificaciones ROOT

- Las solicitudes públicas siguen sin crear acceso automáticamente.
- Cada solicitud se guarda y genera una notificación al/los correos ROOT configurados.
- Los destinatarios se configuran desde Panel ROOT; si no hay configuración en BD se usa `PROVEEDOR_ADMIN_EMAILS`.
- Se registra estado de notificación (`pendiente`, `enviado`, `error`) y detalle.
- El correo contiene RUC, razón social, plan, ambiente y botón al Panel ROOT.
- Incluye endpoint de prueba de correo administrativo.
- El cliente no recibe credenciales por registrarse; solo después de aprobación/creación desde ROOT.
- La migración es aditiva: `sql/migracion_contsertrib_v9929_notificaciones_root.sql`.

- ROOT puede reenviar manualmente el aviso de cualquier solicitud desde el panel.
