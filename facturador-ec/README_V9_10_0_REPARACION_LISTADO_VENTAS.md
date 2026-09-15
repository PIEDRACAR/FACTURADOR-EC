# CONTSERTRIB v9.10.0 — Reparación Listado de ventas

Se mantiene v9.10.0 como base. Esta reparación no elimina ni reemplaza funciones existentes.

## Problema corregido

`Reportes > Listado de ventas` podía quedar en `Consultando información detallada…` por una consulta pesada que hacía `comprobantes + clientes(...)` en una sola respuesta de PostgREST.

## Solución

- Consulta principal de comprobantes optimizada y limitada a 1.000 filas para respuesta inmediata en pantalla.
- Se eliminó el JOIN anidado de clientes de la consulta principal.
- Los datos de clientes se recuperan en lotes de 250 IDs.
- Se agregaron índices específicos para emisor/fecha, emisor/estado/tipo/fecha y emisor/cliente.
- Timeout visual de 10 segundos para evitar estados infinitos.
- Se evita que una consulta vieja sobrescriba una consulta más reciente.
- Excel/PDF y descarga masiva de XML/PDF se conservan.

## Supabase

Ejecutar una sola vez:

`sql/migracion_v9100_reparacion_listado_ventas.sql`

La migración usa `IF NOT EXISTS` y no borra registros.
