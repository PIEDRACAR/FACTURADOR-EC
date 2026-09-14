# CONTSERTRIB v9.9.68 — corrección de compilación y acceso

## Correcciones
- Se importa `env` correctamente en `src/routes/emisores.ts`.
- Se estrecha `emisorId` antes de usarlo en las relaciones de negocio para eliminar el TS2345 detectado por Railway.
- Se conserva el alta autoservicio: usuario, negocio, matriz 001, punto 001, cuenta SaaS, suscripción de 30 días, IVA y acceso.
- Se conserva la configuración de firma electrónica `.p12/.pfx` cifrada y por contribuyente.
- Se incrementa la versión a v9.9.68.

## SQL requerido
Ejecutar `sql/migracion_sesiones.sql` si la tabla `sesiones` aún no existe.
Ejecutar `sql/migracion_firma_electronica_autoservicio_v997.sql` para la configuración de firma si aún no se ejecutó.
La variable `SECRETS_ENCRYPTION_KEY` debe existir en Railway.
