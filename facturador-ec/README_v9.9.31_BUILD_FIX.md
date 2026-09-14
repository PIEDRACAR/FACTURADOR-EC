# CONTSERTRIB v9.9.31 — FIX BUILD RAILWAY

Corrección del error de compilación reportado por Railway en `src/routes/proveedor.ts`: `proveedorAuth` y `planCode` se utilizaban fuera de su ámbito en la ruta de creación de contribuyentes.

- La ruta ahora obtiene y valida `proveedorAuth` correctamente.
- La auditoría utiliza `cuentaPlan.plan_id` en lugar de la variable inexistente `planCode`.
- No se elimina funcionalidad.
- Se actualiza la versión del paquete a v9.9.31.
