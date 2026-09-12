# CONTSERTRIB v9.9.28 — Seguridad + onboarding + salud SaaS

Esta versión mantiene las funciones de v9.9.27 y agrega una capa de producción para el SaaS:

- Registro público controlado: no crea sesión, empresa activa ni suscripción por sí mismo.
- Validación de que el plan elegido esté activo.
- Limitación básica de solicitudes públicas por IP para reducir spam.
- Diagnóstico de configuración inicial por contribuyente, sin exponer secretos.
- Panel ROOT con Centro de salud del backend.
- Auditoría SaaS para altas de clientes y cambios comerciales críticos.
- Sesión persistente: no se añade cierre automático por inactividad; el usuario sale mediante Cerrar sesión.
- Preparación para continuar con la revisión integral del módulo de Contabilidad en la siguiente etapa.

## Migración
Ejecutar en Supabase:
`sql/migracion_contsertrib_v9928_seguridad_onboarding.sql`

## Validación
Se debe ejecutar `npm install` y `npm run build` en el entorno de despliegue/Railway antes de publicar. Esta entrega no afirma un build local completo si el entorno no dispone de las dependencias del proyecto.
