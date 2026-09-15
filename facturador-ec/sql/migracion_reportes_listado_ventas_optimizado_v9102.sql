-- CONTSERTRIB v9.10.2
-- Optimización del listado de ventas. Migración segura e idempotente.
-- No modifica ni elimina datos.

create index if not exists idx_comprobantes_emisor_created_at
  on public.comprobantes (emisor_id, created_at desc);

create index if not exists idx_comprobantes_emisor_estado_created_at
  on public.comprobantes (emisor_id, estado, created_at desc);
