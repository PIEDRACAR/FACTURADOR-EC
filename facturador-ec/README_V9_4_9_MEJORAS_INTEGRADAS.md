# CONTSERTRIB FACTURACIÓN v9.4.9 — Mejoras integradas

Esta versión parte de v9.4.8 y conserva las correcciones anteriores.

## Cambios

1. **Clientes rápidos en POS**
   - Buscar clientes guardados desde 3 caracteres.
   - Resultados en lista desplegable sin cargar todo el catálogo.
   - Búsqueda por nombre, identificación o correo.
   - Selección inmediata rellena identificación, nombre, correo, teléfono y dirección.
   - La consulta automática de identificación ahora está correctamente aislada por negocio (`emisor_id`).

2. **Establecimientos y puntos de emisión**
   - Nueva pantalla en Configuración.
   - Crear/activar/desactivar establecimientos.
   - Crear puntos de emisión.
   - Elegir el punto activo que utilizará la facturación.
   - Migración automática de establecimientos que ya existían en `puntos_emision`.
   - La pantalla deja claro que el alta tributaria del establecimiento ante el SRI no se realiza desde el sistema.

3. **Notificaciones y Usuario**
   - Botones superiores con iconografía SVG profesional y estado visual.
   - Centro de notificaciones con icono según tipo de alerta.
   - Mantiene contador, lectura individual, lectura total y actualización automática.

4. **Roles y permisos granulares**
   - Nuevo catálogo de permisos por módulo.
   - Administrador puede elegir permisos individualmente para cada usuario no administrador.
   - Los administradores conservan acceso total.
   - Si todavía no existen permisos personalizados, se conservan los permisos base del rol actual para no bloquear usuarios existentes.
   - Protección backend aplicada a módulos y APIs principales.

5. **RUC del proveedor de facturación**
   - Se conserva la inclusión obligatoria del RUC del proveedor en `infoAdicional` del XML antes de firmar.
   - El RUC del proveedor también aparece en el RIDE/PDF.
   - La vista previa de impresión muestra el RUC del proveedor.
   - El RUC continúa administrándose de forma central por `RUC_PROVEEDOR_FACTURACION` y no por el cliente.

## Migración Supabase

Ejecutar una vez:

`sql/migracion_v947_clientes_establecimientos_permisos.sql`

No contiene `node_modules` ni `dist`: Railway genera `dist` durante `npm run build`.
