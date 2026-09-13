# v9.9.67 — Registro, acceso y firma electrónica

- El registro público ahora solicita contraseña y crea la cuenta operativa con 30 días de prueba.
- Se crea/recupera emisor, matriz 001, punto 001, usuario administrador, cuenta SaaS, relación y suscripción activa de 30 días.
- Se añadió Configuración → Firma electrónica SRI para subir `.p12`/`.pfx`, contraseña y fecha de expiración.
- El certificado y contraseña se cifran con `SECRETS_ENCRYPTION_KEY`.

## Supabase
Ejecutar `sql/migracion_firma_electronica_autoservicio_v997.sql`.

## Railway
Verificar que exista `SECRETS_ENCRYPTION_KEY` de 64 caracteres hexadecimales.
