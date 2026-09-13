# CONTSERTRIB v9.9.51 — LIMPIEZA SEGURA PARA PRUEBAS

## Corrección
Se incorpora `public.log_firmas` como dependencia hija de `public.comprobantes`. Su FK `log_firmas_comprobante_id_fkey` referencia `comprobantes(id)`, por lo que debe limpiarse antes de eliminar comprobantes.

## Garantías
- No elimina módulos ni funcionalidades.
- No hace DROP, TRUNCATE, ALTER ni CASCADE.
- No usa `session_replication_role`.
- Conserva estructura, RLS/políticas, Auth, `proveedores_admin`, planes y catálogos maestros.
- Si aparece otra FK no contemplada, PostgreSQL revierte la transacción completa.

## Ejecución
Ejecutar únicamente `sql/RESET_DATOS_PRUEBAS_NO_DESTRUCTIVO_v9.9.51.sql`.
No ejecutar resets anteriores.
