# CONTSERTRIB FACTURACIÓN v9.9.52 — ROOT independiente

## Cambio principal

Se separó completamente el acceso ROOT del contexto de negocio.

- `GET /root-login` es público y no requiere `emisorId`, negocio ni suscripción.
- `POST /auth/root-login` es público y verifica correo + contraseña contra Supabase Auth.
- El único correo que puede iniciar el Panel Maestro es `ROOT_ADMIN_EMAIL` (por defecto `ecfacturador@gmail.com`).
- `/admin-proveedor` y toda la API `/proveedor/*` validan nuevamente la identidad ROOT en backend.
- Un usuario normal, aunque tenga negocio, rol admin o conozca la URL, recibe 403 o es redirigido a `/root-login`.
- `PROVEEDOR_ADMIN_EMAILS` queda únicamente para notificaciones administrativas y no otorga acceso.
- No se modifica la lógica de facturación, SRI, inventario, caja, reportes o contabilidad.

## Configuración

En Railway debe existir:

`ROOT_ADMIN_EMAIL=ecfacturador@gmail.com`

La contraseña NO se coloca en variables de entorno ni en el código. Se administra desde Supabase Auth.
