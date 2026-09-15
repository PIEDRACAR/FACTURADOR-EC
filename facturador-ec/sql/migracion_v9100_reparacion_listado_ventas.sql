-- CONTSERTRIB v9.10.0 - Reparación de Reportes / Listado de ventas
-- Migración ADITIVA e IDEMPOTENTE. No elimina datos ni modifica comprobantes.

create index if not exists idx_comprobantes_reportes_emisor_fecha_9100
  on public.comprobantes (emisor_id, created_at desc);

create index if not exists idx_comprobantes_reportes_emisor_estado_tipo_fecha_9100
  on public.comprobantes (emisor_id, estado, tipo, created_at desc);

create index if not exists idx_comprobantes_reportes_emisor_cliente_9100
  on public.comprobantes (emisor_id, cliente_id);

create index if not exists idx_clientes_reportes_id_9100
  on public.clientes (id);
