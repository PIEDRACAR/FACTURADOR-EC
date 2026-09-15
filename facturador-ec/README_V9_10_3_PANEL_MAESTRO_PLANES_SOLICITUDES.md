# v9.10.3 — Panel Maestro

- Interfaz reorganizada con navegación por secciones.
- Constructor de planes con precios, límites y módulos configurables.
- Módulos adicionales en `planes_suscripcion.modulos_config` (JSONB), conservando columnas legacy.
- Solicitudes con búsqueda, filtros, contadores y eliminación controlada de rechazadas.
- Borrado de rechazadas auditado en `SAAS_SOLICITUD_RECHAZADA_ELIMINADA`.
- Ticket/POS sigue requiriendo inclusión en el plan + activación individual de ROOT por contribuyente.

Ejecutar una vez: `sql/migracion_v9103_panel_maestro_planes_modulos_solicitudes.sql`
