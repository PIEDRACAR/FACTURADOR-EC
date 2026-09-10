-- CONTSERTRIB v9.9.4
-- Correcciones comerciales y de consulta RUC/tributaria. No elimina historial.

-- La tarifa general vigente debe partir de 15% en la configuración actual;
-- solo se corrigen configuraciones que quedaron en 13% por la migración v9.9.0.
update configuracion_iva set tarifa_general=15 where tarifa_general=13;
update catalogo_iva_sri set tarifa=15, descripcion='IVA tarifa general vigente' where codigo_porcentaje='4' and tarifa=13;

-- Asegurar que los nuevos emisores nazcan con 15% general.
alter table if exists configuracion_iva alter column tarifa_general set default 15.00;

comment on table configuracion_iva is 'Configuración tributaria por emisor. Las tarifas se cambian únicamente por una reforma oficial y los comprobantes históricos conservan su snapshot.';
