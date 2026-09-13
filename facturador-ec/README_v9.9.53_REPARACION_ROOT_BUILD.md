# CONTSERTRIB FACTURACIÓN v9.9.53 — Reparación ROOT y build

## Corrección aplicada
- Se corrigió `src/auth/proteccion.ts` para importar explícitamente `env` desde `src/config/env.ts`.
- Esto corrige el error de Railway `TS2304: Cannot find name 'env'`.
- Se mantiene el acceso ROOT independiente de `emisorId`, negocio y suscripción.
- El correo ROOT autorizado continúa siendo `ecfacturador@gmail.com` por defecto y puede configurarse con `ROOT_ADMIN_EMAIL`.
- La contraseña continúa siendo gestionada por Supabase Auth; no se almacena en el código.

## Integridad
No se eliminaron módulos funcionales ni migraciones. La corrección es puntual sobre la autenticación/protección y la versión del paquete.

## Railway
El proyecto conserva `npm run build` y `npm start`. Railway debe usar Node `>=24.18.0`, según `package.json`.
