# CONTSERTRIB v9.9.63 — Integración Contabilidad + Inventario Multibodega

Esta versión prepara la integración del módulo contable avanzado y agrega una base multibodega al inventario sin retirar las funciones existentes.

## Cambios
- Nueva migración `sql/migracion_inventario_bodegas_v9963.sql`.
- Nuevas tablas: `bodegas`, `existencias_bodega`, `movimientos_inventario_bodega`.
- Transferencia entre bodegas atómica mediante RPC.
- Bodega MATRIZ creada automáticamente para emisores existentes.
- El stock histórico de `productos.stock_actual` se refleja inicialmente en MATRIZ sin modificar el stock original.
- Nuevas rutas `/inventario/bodegas`, `/inventario/existencias-bodega` y `/inventario/bodegas/transferir`.
- Panel de Gestión de bodegas agregado a Inventario sin eliminar Entrada, Ajuste, Kardex ni Semáforo.

## Próxima fase contable
El proyecto `contsertrib (2).zip` se conserva como fuente del módulo contable avanzado. La integración definitiva debe mapear sus funciones a la arquitectura Railway/Supabase existente, evitando que el almacenamiento local/IndexedDB del proyecto origen se convierta en la fuente de datos del SaaS.
