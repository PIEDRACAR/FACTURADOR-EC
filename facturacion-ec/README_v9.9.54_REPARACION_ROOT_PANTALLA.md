# v9.9.54 — Reparación ROOT: pantalla independiente

Corrección puntual sin eliminar módulos ni migraciones.

- `/root-login` se sirve sin `inyectarProteccionSesion`.
- No carga `app.css` ni `app-shell.js`, evitando que el shell normal aparezca detrás o encima del login ROOT.
- `/root-login` continúa siendo público a nivel de ruta para poder mostrar el formulario.
- `POST /auth/root-login` sigue validando exclusivamente `ROOT_ADMIN_EMAIL` y la contraseña mediante Supabase Auth.
- `/admin-proveedor` y `/proveedor/*` continúan protegidos por backend para ROOT.
- No se modifican módulos de facturación, SRI, inventario, POS, caja, contabilidad, reportes ni migraciones SQL.
