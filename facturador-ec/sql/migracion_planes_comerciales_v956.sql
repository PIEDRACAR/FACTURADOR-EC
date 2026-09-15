-- CONTSERTRIB v9.9.56
-- Planes comerciales flexibles: modalidad mensual/anual y límites de documentos por período.
-- No elimina planes ni historial. Ejecutar una sola vez en Supabase SQL Editor.

alter table if exists planes_suscripcion
  add column if not exists precio_anual numeric(12,2) not null default 0,
  add column if not exists periodicidad varchar(10) not null default 'mensual',
  add column if not exists max_documentos_anio integer;

alter table if exists planes_suscripcion
  drop constraint if exists planes_suscripcion_periodicidad_chk;
alter table if exists planes_suscripcion
  add constraint planes_suscripcion_periodicidad_chk check (periodicidad in ('mensual','anual'));
alter table if exists planes_suscripcion
  drop constraint if exists planes_suscripcion_precio_anual_chk;
alter table if exists planes_suscripcion
  add constraint planes_suscripcion_precio_anual_chk check (precio_anual >= 0);

-- Desactiva únicamente los nombres comerciales antiguos para que los nuevos
-- no compitan en el selector. Las suscripciones existentes no se eliminan.
update planes_suscripcion
set activo=false, updated_at=now()
where codigo in ('BASICO','PROFESIONAL','EMPRESARIAL','BASICO_50','BASICO_100','BASICO_250','BASICO_500','EXPRESS_50','EXPRESS_100','EXPRESS_250','EXPRESS_500','EXPRESS_ILIMITADO');

-- BÁSICO mensual: solo facturación.
insert into planes_suscripcion
(codigo,nombre,descripcion,precio_mensual,precio_anual,periodicidad,orden,activo,max_documentos_mes,max_documentos_anio,max_contribuyentes,max_establecimientos,max_puntos_emision,max_usuarios,incluye_inventario,incluye_ats,incluye_carga_electronica,incluye_reportes_avanzados,descripcion_comercial)
values
('BASICO_M_5','Básico 5 mensual','Solo facturación electrónica.',2.99,0,'mensual',101,true,5,null,1,1,1,1,false,false,false,false,'Hasta 5 comprobantes al mes'),
('BASICO_M_10','Básico 10 mensual','Solo facturación electrónica.',3.49,0,'mensual',102,true,10,null,1,1,1,1,false,false,false,false,'Hasta 10 comprobantes al mes'),
('BASICO_M_20','Básico 20 mensual','Solo facturación electrónica.',3.99,0,'mensual',103,true,20,null,1,1,1,1,false,false,false,false,'Hasta 20 comprobantes al mes'),
('BASICO_M_30','Básico 30 mensual','Solo facturación electrónica.',4.49,0,'mensual',104,true,30,null,1,1,1,1,false,false,false,false,'Hasta 30 comprobantes al mes'),
('BASICO_M_50','Básico 50 mensual','Solo facturación electrónica.',4.99,0,'mensual',105,true,50,null,1,1,1,1,false,false,false,false,'Hasta 50 comprobantes al mes'),
('BASICO_M_100','Básico 100 mensual','Solo facturación electrónica.',6.99,0,'mensual',106,true,100,null,1,1,1,1,false,false,false,false,'Hasta 100 comprobantes al mes'),
('BASICO_M_150','Básico 150 mensual','Solo facturación electrónica.',7.99,0,'mensual',107,true,150,null,1,1,1,1,false,false,false,false,'Hasta 150 comprobantes al mes'),
('BASICO_M_200','Básico 200 mensual','Solo facturación electrónica.',8.99,0,'mensual',108,true,200,null,1,1,1,1,false,false,false,false,'Hasta 200 comprobantes al mes'),
('BASICO_M_300','Básico 300 mensual','Solo facturación electrónica.',10.99,0,'mensual',109,true,300,null,1,1,1,1,false,false,false,false,'Hasta 300 comprobantes al mes'),
('BASICO_M_500','Básico 500 mensual','Solo facturación electrónica.',13.99,0,'mensual',110,true,500,null,1,1,1,1,false,false,false,false,'Hasta 500 comprobantes al mes')
on conflict (codigo) do update set nombre=excluded.nombre,descripcion=excluded.descripcion,precio_mensual=excluded.precio_mensual,precio_anual=excluded.precio_anual,periodicidad=excluded.periodicidad,orden=excluded.orden,activo=true,max_documentos_mes=excluded.max_documentos_mes,max_documentos_anio=excluded.max_documentos_anio,max_contribuyentes=excluded.max_contribuyentes,max_establecimientos=excluded.max_establecimientos,max_puntos_emision=excluded.max_puntos_emision,max_usuarios=excluded.max_usuarios,incluye_inventario=excluded.incluye_inventario,incluye_ats=excluded.incluye_ats,incluye_carga_electronica=excluded.incluye_carga_electronica,incluye_reportes_avanzados=excluded.incluye_reportes_avanzados,descripcion_comercial=excluded.descripcion_comercial,updated_at=now();

-- BÁSICO anual: solo facturación. Precios económicos solicitados.
insert into planes_suscripcion
(codigo,nombre,descripcion,precio_mensual,precio_anual,periodicidad,orden,activo,max_documentos_mes,max_documentos_anio,max_contribuyentes,max_establecimientos,max_puntos_emision,max_usuarios,incluye_inventario,incluye_ats,incluye_carga_electronica,incluye_reportes_avanzados,descripcion_comercial)
values
('BASICO_A_25','Básico 25 anual','Solo facturación electrónica.',0,5,'anual',201,true,null,25,1,1,1,1,false,false,false,false,'Hasta 25 comprobantes al año'),
('BASICO_A_50','Básico 50 anual','Solo facturación electrónica.',0,10,'anual',202,true,null,50,1,1,1,1,false,false,false,false,'Hasta 50 comprobantes al año'),
('BASICO_A_100','Básico 100 anual','Solo facturación electrónica.',0,15,'anual',203,true,null,100,1,1,1,1,false,false,false,false,'Hasta 100 comprobantes al año'),
('BASICO_A_200','Básico 200 anual','Solo facturación electrónica.',0,20,'anual',204,true,null,200,1,1,1,1,false,false,false,false,'Hasta 200 comprobantes al año'),
('BASICO_A_300','Básico 300 anual','Solo facturación electrónica.',0,25,'anual',205,true,null,300,1,1,1,1,false,false,false,false,'Hasta 300 comprobantes al año'),
('BASICO_A_500','Básico 500 anual','Solo facturación electrónica.',0,35,'anual',206,true,null,500,1,1,1,1,false,false,false,false,'Hasta 500 comprobantes al año')
on conflict (codigo) do update set nombre=excluded.nombre,descripcion=excluded.descripcion,precio_mensual=excluded.precio_mensual,precio_anual=excluded.precio_anual,periodicidad=excluded.periodicidad,orden=excluded.orden,activo=true,max_documentos_mes=excluded.max_documentos_mes,max_documentos_anio=excluded.max_documentos_anio,max_contribuyentes=excluded.max_contribuyentes,max_establecimientos=excluded.max_establecimientos,max_puntos_emision=excluded.max_puntos_emision,max_usuarios=excluded.max_usuarios,incluye_inventario=excluded.incluye_inventario,incluye_ats=excluded.incluye_ats,incluye_carga_electronica=excluded.incluye_carga_electronica,incluye_reportes_avanzados=excluded.incluye_reportes_avanzados,descripcion_comercial=excluded.descripcion_comercial,updated_at=now();

-- Profesional mensual/anual.
insert into planes_suscripcion
(codigo,nombre,descripcion,precio_mensual,precio_anual,periodicidad,orden,activo,max_documentos_mes,max_documentos_anio,max_contribuyentes,max_establecimientos,max_puntos_emision,max_usuarios,incluye_inventario,incluye_ats,incluye_carga_electronica,incluye_reportes_avanzados,descripcion_comercial)
values
('PRO_M_300','Profesional 300 mensual','Facturación + inventario + gestión.',12,0,'mensual',301,true,300,null,1,2,2,3,true,false,true,true,'Hasta 300 comprobantes al mes'),
('PRO_M_500','Profesional 500 mensual','Facturación + inventario + gestión.',15,0,'mensual',302,true,500,null,1,2,3,5,true,false,true,true,'Hasta 500 comprobantes al mes'),
('PRO_M_1000','Profesional 1000 mensual','Facturación + inventario + gestión.',20,0,'mensual',303,true,1000,null,2,5,10,10,true,true,true,true,'Hasta 1.000 comprobantes al mes'),
('PRO_M_2000','Profesional 2000 mensual','Facturación + inventario + gestión avanzada.',28,0,'mensual',304,true,2000,null,3,10,20,15,true,true,true,true,'Hasta 2.000 comprobantes al mes'),
('PRO_A_300','Profesional 300 anual','Facturación + inventario + gestión.',0,120,'anual',401,true,null,300,1,2,2,3,true,false,true,true,'Hasta 300 comprobantes al año'),
('PRO_A_500','Profesional 500 anual','Facturación + inventario + gestión.',0,150,'anual',402,true,null,500,1,2,3,5,true,false,true,true,'Hasta 500 comprobantes al año'),
('PRO_A_1000','Profesional 1000 anual','Facturación + inventario + gestión.',0,200,'anual',403,true,null,1000,2,5,10,10,true,true,true,true,'Hasta 1.000 comprobantes al año'),
('PRO_A_2000','Profesional 2000 anual','Facturación + inventario + gestión avanzada.',0,280,'anual',404,true,null,2000,3,10,20,15,true,true,true,true,'Hasta 2.000 comprobantes al año')
on conflict (codigo) do update set nombre=excluded.nombre,descripcion=excluded.descripcion,precio_mensual=excluded.precio_mensual,precio_anual=excluded.precio_anual,periodicidad=excluded.periodicidad,orden=excluded.orden,activo=true,max_documentos_mes=excluded.max_documentos_mes,max_documentos_anio=excluded.max_documentos_anio,max_contribuyentes=excluded.max_contribuyentes,max_establecimientos=excluded.max_establecimientos,max_puntos_emision=excluded.max_puntos_emision,max_usuarios=excluded.max_usuarios,incluye_inventario=excluded.incluye_inventario,incluye_ats=excluded.incluye_ats,incluye_carga_electronica=excluded.incluye_carga_electronica,incluye_reportes_avanzados=excluded.incluye_reportes_avanzados,descripcion_comercial=excluded.descripcion_comercial,updated_at=now();

-- Empresarial mensual/anual.
insert into planes_suscripcion
(codigo,nombre,descripcion,precio_mensual,precio_anual,periodicidad,orden,activo,max_documentos_mes,max_documentos_anio,max_contribuyentes,max_establecimientos,max_puntos_emision,max_usuarios,incluye_inventario,incluye_ats,incluye_carga_electronica,incluye_reportes_avanzados,descripcion_comercial)
values
('EMP_M_1000','Empresarial 1000 mensual','Operación empresarial completa.',35,0,'mensual',501,true,1000,null,3,10,20,15,true,true,true,true,'Hasta 1.000 comprobantes al mes'),
('EMP_M_2000','Empresarial 2000 mensual','Operación empresarial completa.',45,0,'mensual',502,true,2000,null,5,20,40,25,true,true,true,true,'Hasta 2.000 comprobantes al mes'),
('EMP_M_5000','Empresarial 5000 mensual','Operación empresarial completa.',60,0,'mensual',503,true,5000,null,10,30,60,40,true,true,true,true,'Hasta 5.000 comprobantes al mes'),
('EMP_M_10000','Empresarial 10000 mensual','Operación empresarial completa.',80,0,'mensual',504,true,10000,null,25,50,100,60,true,true,true,true,'Hasta 10.000 comprobantes al mes'),
('EMP_A_1000','Empresarial 1000 anual','Operación empresarial completa.',0,350,'anual',601,true,null,1000,3,10,20,15,true,true,true,true,'Hasta 1.000 comprobantes al año'),
('EMP_A_2000','Empresarial 2000 anual','Operación empresarial completa.',0,450,'anual',602,true,null,2000,5,20,40,25,true,true,true,true,'Hasta 2.000 comprobantes al año'),
('EMP_A_5000','Empresarial 5000 anual','Operación empresarial completa.',0,600,'anual',603,true,null,5000,10,30,60,40,true,true,true,true,'Hasta 5.000 comprobantes al año'),
('EMP_A_10000','Empresarial 10000 anual','Operación empresarial completa.',0,800,'anual',604,true,null,10000,25,50,100,60,true,true,true,true,'Hasta 10.000 comprobantes al año')
on conflict (codigo) do update set nombre=excluded.nombre,descripcion=excluded.descripcion,precio_mensual=excluded.precio_mensual,precio_anual=excluded.precio_anual,periodicidad=excluded.periodicidad,orden=excluded.orden,activo=true,max_documentos_mes=excluded.max_documentos_mes,max_documentos_anio=excluded.max_documentos_anio,max_contribuyentes=excluded.max_contribuyentes,max_establecimientos=excluded.max_establecimientos,max_puntos_emision=excluded.max_puntos_emision,max_usuarios=excluded.max_usuarios,incluye_inventario=excluded.incluye_inventario,incluye_ats=excluded.incluye_ats,incluye_carga_electronica=excluded.incluye_carga_electronica,incluye_reportes_avanzados=excluded.incluye_reportes_avanzados,descripcion_comercial=excluded.descripcion_comercial,updated_at=now();
