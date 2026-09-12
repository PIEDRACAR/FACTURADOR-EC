-- CONTSERTRIB v9.7.2
-- Estructura tributaria más clara: matriz/sucursales, corrección y eliminación segura.
-- Ejecutar una sola vez en Supabase SQL Editor.

alter table if exists establecimientos_emisor
  add column if not exists tipo_establecimiento varchar(20) not null default 'SUCURSAL';

update establecimientos_emisor
set tipo_establecimiento = 'MATRIZ'
where codigo = '001' and (tipo_establecimiento is null or tipo_establecimiento = 'SUCURSAL');

create index if not exists idx_establecimientos_tipo
  on establecimientos_emisor(emisor_id, tipo_establecimiento, activo);

-- Evita más de una matriz por RUC dentro del sistema.
create unique index if not exists uq_establecimiento_matriz_por_emisor
  on establecimientos_emisor(emisor_id)
  where tipo_establecimiento = 'MATRIZ';

-- Una matriz inactiva no debe dejar puntos activos utilizables para facturar.
update puntos_emision p
set activo = false
where exists (
  select 1 from establecimientos_emisor e
  where e.emisor_id = p.emisor_id
    and e.codigo = p.establecimiento
    and e.activo = false
);
