# CONTSERTRIB v9.9.64 — ERP Contabilidad + Inventario

Esta versión continúa la integración del motor contable con el sistema único Railway/Supabase.

## Inventario
- Multi-bodega por emisor.
- Ubicaciones internas por bodega.
- Existencias, stock reservado y disponible.
- Transferencias atómicas entre bodegas.
- Reservas y liberación atómica.
- Lotes y caducidad opcionales.
- Kardex, semáforo y valorización existentes se conservan.

## Regla de integración
No se elimina información existente. Las estructuras antiguas solo deben retirarse después de auditar dependencias y migrar datos.

## Base de datos
Ejecutar `sql/migracion_inventario_erp_v9964.sql` después de `migracion_inventario_bodegas_v9963.sql`.
