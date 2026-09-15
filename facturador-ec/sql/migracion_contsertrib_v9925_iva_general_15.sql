-- CONTSERTRIB v9.9.25 — IVA GENERAL 15%
-- Corrige la parametrización que quedó en 13% en v9.9.24.
-- NO modifica comprobantes históricos ya emitidos.

-- Configuración por emisor
alter table if exists configuracion_iva alter column tarifa_general set default 15;
alter table if exists configuracion_iva alter column codigo_general set default '4';
update configuracion_iva
   set tarifa_general = 15,
       codigo_general = '4',
       updated_at = now()
 where tarifa_general = 13 or codigo_general = '10';

-- Catálogo SRI: asegurar el código 4 para IVA general 15%.
-- Se respeta la estructura existente (fecha_desde/fecha_hasta/base_legal/sector).
insert into catalogo_iva_sri
  (codigo_porcentaje, descripcion, tarifa, tipo, sector, fecha_desde, fecha_hasta, base_legal, activo)
select '4', 'IVA general 15%', 15, 'TARIFA', null, date '2026-01-01', null,
       'Tarifa general 15% vigente para la parametrización actual del sistema.', true
where not exists (
  select 1 from catalogo_iva_sri
   where codigo_porcentaje='4' and fecha_desde=date '2026-01-01'
);

-- Si existía el registro genérico 13% de la migración anterior, se desactiva
-- para que no pueda ser seleccionado como tarifa general vigente.
update catalogo_iva_sri
   set activo=false
 where codigo_porcentaje='10'
   and tarifa=13
   and activo=true;

notify pgrst, 'reload schema';
