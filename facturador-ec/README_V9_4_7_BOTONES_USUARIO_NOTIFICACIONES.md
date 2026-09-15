# CONTSERTRIB FACTURACIÓN v9.4.7 — Botones Usuario y Notificaciones

## Corrección principal

Esta versión corrige de forma estructural los controles superiores **Usuario** y **Notificaciones**.

### Usuario
- El botón `Usuario` usa captura de eventos a nivel de documento para evitar que otros componentes bloqueen el click.
- El menú se crea fuera del header, directamente en `body`.
- Incluye Gestión de usuarios solo para administradores.
- Incluye Configuración y Cerrar sesión.
- Conserva el `emisorId` actual en los enlaces.
- Cerrar sesión usa la sesión HTTP actual y limpia el negocio seleccionado.
- Soporte de teclado con Escape.

### Notificaciones
- El botón abre/cierra el centro profesional.
- Carga el contador y las notificaciones automáticamente al iniciar.
- Actualiza el contador cada 30 segundos mientras la página está visible.
- Permite marcar una notificación como leída.
- Permite marcar todas como leídas.
- Muestra error real y botón Reintentar si el endpoint falla.
- Filtra errores de correo por comprobantes del negocio activo.
- Valida en backend que la sesión realmente pertenezca al negocio consultado.

### Robustez visual
- Backdrop controlado para cerrar los popovers.
- Z-index reforzado para evitar que el header o modales oculten los controles.
- Compatibilidad móvil.
- `Cache-Control: no-store` para `app-shell.js` y `app.css`.
- Cache-busting `app-shell.js?v=9.4.7` para evitar que el navegador continúe usando la versión anterior.

## Validación realizada

- `node --check public/app-shell.js` → OK.
- Se verificaron los cambios estructurales de cache-busting, endpoints de notificaciones y controles superiores.
- El `npm ci` del entorno de trabajo agotó el tiempo de transporte del contenedor; por eso no se declara un build TypeScript local completo como aprobado. Railway debe ejecutar la instalación limpia y `npm run build` con el `package-lock.json` incluido.

## Importante

Esta versión es acumulativa sobre v9.4.6. No elimina las correcciones SRI, fecha Ecuador, correo, inventario, RIDE, Storage ni demás funcionalidades existentes.
