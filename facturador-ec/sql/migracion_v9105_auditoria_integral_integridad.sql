-- CONTSERTRIB v9.10.5 — Auditoría integral / rendimiento e integridad de consultas
-- Migración ADITIVA: no elimina datos ni columnas y no introduce constraints
-- que puedan bloquear una instalación que ya contenga históricos.

create index if not exists idx_certificados_emisor_alias_activo
  on certificados(emisor_id, alias, activo);

create index if not exists idx_suscripciones_emisor_estado_vencimiento
  on suscripciones(emisor_id, estado, proximo_vencimiento);

create index if not exists idx_contribuyentes_cliente_saas_emisor_activo
  on contribuyentes_cliente_saas(emisor_id, activo);

create index if not exists idx_comprobantes_emisor_fecha_estado
  on comprobantes(emisor_id, created_at desc, estado);

create index if not exists idx_movimientos_inventario_emisor_producto_fecha
  on movimientos_inventario(emisor_id, producto_id, created_at desc);
