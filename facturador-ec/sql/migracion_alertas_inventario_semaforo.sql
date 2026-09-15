-- ============================================================
-- MIGRACIÓN: Alertas de inventario tipo semáforo
--
-- Verde  = stock normal
-- Amarillo = stock bajo (<= mínimo)
-- Rojo/STOP = stock crítico (<= crítico, por defecto 0)
-- Naranja = sobrestock (> máximo, cuando se configure)
-- ============================================================

alter table productos add column if not exists stock_critico numeric not null default 0;
alter table productos add column if not exists stock_maximo numeric;

update productos
set stock_critico = 0
where stock_critico is null or stock_critico < 0;

alter table productos drop constraint if exists productos_stock_alertas_check;
alter table productos add constraint productos_stock_alertas_check
  check (stock_critico >= 0 and stock_minimo >= 0 and (stock_maximo is null or stock_maximo >= stock_minimo));

create index if not exists idx_productos_alertas_stock
  on productos (emisor_id, activo, stock_actual, stock_critico, stock_minimo, stock_maximo);
