# CONTSERTRIB Facturación v9.4.8 — Railway Root/Build Fix

Esta entrega conserva la funcionalidad de v9.4.7 y corrige la estructura de despliegue.

## Estructura
El `package.json` queda en la raíz del proyecto. Ya no existe un contenedor `facturador-ec/` alrededor del proyecto.

## Railway
Incluye `railway.json` con:
- Build: `npm ci && npm run build`
- Start: `npm start`
- Healthcheck: `/salud`
- Railpack

## dist
`dist/` NO se incluye en el ZIP fuente. Se genera durante `npm run build` a partir de `src/` y se usa después mediante `npm start`.

## Conserva
- SRI y fecha Ecuador
- facturación electrónica
- RIDE/XML y Storage
- correo
- inventario/semaforo
- caja/reportes
- usuario y notificaciones v9.4.7
