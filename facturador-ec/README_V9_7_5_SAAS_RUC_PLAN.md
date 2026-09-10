# CONTSERTRIB v9.7.5 — Alta SaaS por RUC + planes + vigencia

## Cambios
- Alta de cliente SaaS ingresando el RUC y consulta automática al catastro público del SRI.
- Autocompleta razón social, nombre comercial, dirección, correo disponible, estado, actividad, tipo, régimen y obligación de contabilidad.
- Consulta adicional de establecimientos SRI para mostrar cuántos existen.
- El backend vuelve a consultar SRI al crear: no confía únicamente en los datos del navegador.
- Guarda una copia de los datos consultados del SRI y fecha de consulta en `emisores`.
- Cambio de plan desde el panel maestro.
- El cambio de plan se aplica a toda la cuenta SaaS y sus RUC asociados.
- Historial de cambios de plan.
- Activar servicio por 30 días desde hoy.
- Extender vigencia por N días sin inventar un cobro.
- El botón Pago sigue registrando el cobro real y suma la vigencia desde la fecha vigente cuando corresponde.

## Migración
Ejecutar en Supabase:
`sql/migracion_saas_ruc_plan_v975.sql`

## Variables opcionales
`SRI_RUC_LOOKUP_URL`
`SRI_ESTABLECIMIENTOS_LOOKUP_URL`

## Verificación realizada
- Integridad del ZIP: pendiente hasta empaquetado final.
- Sintaxis JavaScript de `admin-proveedor.html`: OK.
- Build TypeScript completo: NO verificado en este entorno porque el ZIP no contiene `node_modules` y no se dispone de instalación de dependencias aquí.

## Nota sobre SRI
La consulta usa el servicio público que el propio proyecto ya utilizaba para consulta de RUC. Los endpoints internos del SRI pueden cambiar; por eso quedan centralizados en variables de entorno.
