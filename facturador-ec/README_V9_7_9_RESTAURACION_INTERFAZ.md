# CONTSERTRIB v9.7.9 — Restauración de interfaz v9.7.4 + motor tributario

## Objetivo
Esta versión toma como referencia visual y de navegación la interfaz ORIGINAL de v9.7.4 y la conserva en `public/`.

El backend conserva las mejoras posteriores del motor de impuestos y la ruta administrativa de reglas tributarias.

## Corrección del problema anterior
La entrega anterior se organizó de forma incorrecta dentro de `v/vfinal` y se incluyó una compilación `dist` que podía confundirse con la aplicación que debía abrirse. Esta entrega tiene una única raíz de proyecto y `public/` es la interfaz HTML original de v9.7.4.

## Estructura
- `src/`: código fuente TypeScript del backend.
- `public/`: interfaz web restaurada desde v9.7.4.
- `sql/`: migraciones SQL.
- `package.json`: dependencias y scripts.
- `dist/`: se genera con `npm run build`; no se usa como sustituto de `public/`.

## Rutas de interfaz
`/`, `/login`, `/registro`, `/pos`, `/clientes-admin`, `/proveedores-admin`, `/productos-admin`, `/inventario`, `/proformas`, `/reportes`, `/caja`, `/configuracion`, `/documentos`, `/ats`, `/usuarios-admin`, `/cuentas-por-cobrar`, `/cuentas-por-pagar`, `/admin-proveedor`, `/correo-prueba`, `/suscripcion` y `/impuestos-admin`.

## Regla de despliegue
Para producción con Fastify se debe ejecutar `npm run build` y luego `npm start`. No se debe abrir un HTML aislado esperando que las APIs funcionen; la interfaz depende del backend, la sesión y Supabase.
