# CONTSERTRIB FACTURACIÓN v9.9.58 — BUILD FIX

Corrección crítica del build de Railway.

- Se eliminó de la ruta `PATCH /proveedor/iva-decretos/:id` código de campos que pertenecían a planes SaaS (`precioAnual`, `periodicidad`, `maxDocumentosAnio`).
- Esos campos permanecen correctamente en `PATCH /proveedor/planes/:id`.
- No se elimina ninguna funcionalidad de planes, ROOT, IVA ni SaaS.
- Se mantiene la migración `migracion_planes_comerciales_v956.sql` para los campos anuales.
