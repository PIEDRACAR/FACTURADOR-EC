# CONTSERTRIB v9.5.1 — Puntos de emisión multi-cajero

Cambios principales:

- Corrige la migración `migracion_v947_clientes_establecimientos_permisos.sql`: ya no utiliza `created_at` en `puntos_emision`.
- La migración ya no fuerza un único punto de emisión activo por emisor.
- Se permiten varios puntos de emisión activos simultáneamente.
- Los nuevos puntos de emisión se crean activos.
- Configuración permite activar/desactivar puntos individualmente sin apagar los demás.
- El POS muestra los puntos de emisión activos y permite al cajero seleccionar cuál utilizar.
- La selección del punto se conserva localmente por negocio en el navegador.
- El backend valida que el punto seleccionado pertenezca al emisor y esté activo.
- El incremento de secuenciales continúa realizándose de forma atómica por establecimiento + punto de emisión, permitiendo varios cajeros concurrentes sin duplicar numeración.
- La ruta `/pos/*` queda protegida por el permiso `facturar`.

Importante: si dos cajeros utilizan el mismo punto de emisión, pueden facturar simultáneamente porque PostgreSQL actualiza el contador del punto de forma atómica. Los puntos distintos mantienen secuenciales independientes.
