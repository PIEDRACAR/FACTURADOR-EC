-- CONTSERTRIB v9.9.61
-- Catálogo comercial definitivo basado en CONTSERTRIB_planes_precios.txt.
-- ADITIVA: no elimina historial ni suscripciones existentes.
-- Los planes activos anteriores se desactivan para nuevas solicitudes; las suscripciones existentes conservan su plan.

update planes_suscripcion
set activo=false, updated_at=now()
where activo=true;

-- BÁSICO: facturación de servicios
insert into planes_suscripcion
(codigo,nombre,descripcion,precio_mensual,precio_anual,periodicidad,orden,activo,max_documentos_mes,max_documentos_anio,max_contribuyentes,max_establecimientos,max_puntos_emision,max_usuarios,incluye_inventario,incluye_ats,incluye_carga_electronica,incluye_reportes_avanzados,descripcion_comercial)
values
('BASICO_M_50','Básico 50','Facturación electrónica de servicios.',1.49,0,'mensual',101,true,50,null,1,1,1,1,false,false,false,false,'50 documentos · facturación de servicios'),
('BASICO_M_100','Básico 100','Facturación electrónica de servicios.',1.99,0,'mensual',102,true,100,null,1,1,1,1,false,false,false,false,'100 documentos · facturación de servicios'),
('BASICO_M_250','Básico 250','Facturación electrónica de servicios.',3.49,0,'mensual',103,true,250,null,1,1,1,1,false,false,false,false,'250 documentos · facturación de servicios'),
('BASICO_M_500','Básico 500','Facturación electrónica de servicios.',5.99,0,'mensual',104,true,500,null,1,1,1,1,false,false,false,false,'500 documentos · facturación de servicios'),
('BASICO_A_50','Básico 50 anual','Facturación electrónica de servicios.',0,8.49,'anual',201,true,null,50,1,1,1,1,false,false,false,false,'50 documentos · facturación de servicios'),
('BASICO_A_100','Básico 100 anual','Facturación electrónica de servicios.',0,12.49,'anual',202,true,null,100,1,1,1,1,false,false,false,false,'100 documentos · facturación de servicios'),
('BASICO_A_250','Básico 250 anual','Facturación electrónica de servicios.',0,20.49,'anual',203,true,null,250,1,1,1,1,false,false,false,false,'250 documentos · facturación de servicios'),
('BASICO_A_500','Básico 500 anual','Facturación electrónica de servicios.',0,36.99,'anual',204,true,null,500,1,1,1,1,false,false,false,false,'500 documentos · facturación de servicios')
on conflict (codigo) do update set nombre=excluded.nombre,descripcion=excluded.descripcion,precio_mensual=excluded.precio_mensual,precio_anual=excluded.precio_anual,periodicidad=excluded.periodicidad,orden=excluded.orden,activo=true,max_documentos_mes=excluded.max_documentos_mes,max_documentos_anio=excluded.max_documentos_anio,max_contribuyentes=excluded.max_contribuyentes,max_establecimientos=excluded.max_establecimientos,max_puntos_emision=excluded.max_puntos_emision,max_usuarios=excluded.max_usuarios,incluye_inventario=excluded.incluye_inventario,incluye_ats=excluded.incluye_ats,incluye_carga_electronica=excluded.incluye_carga_electronica,incluye_reportes_avanzados=excluded.incluye_reportes_avanzados,descripcion_comercial=excluded.descripcion_comercial,updated_at=now();

-- EXPRESS: facturación + inventario
insert into planes_suscripcion
(codigo,nombre,descripcion,precio_mensual,precio_anual,periodicidad,orden,activo,max_documentos_mes,max_documentos_anio,max_contribuyentes,max_establecimientos,max_puntos_emision,max_usuarios,incluye_inventario,incluye_ats,incluye_carga_electronica,incluye_reportes_avanzados,descripcion_comercial)
values
('EXPRESS_M_50','Express 50','Facturación electrónica + inventario.',3.49,0,'mensual',301,true,50,null,1,1,1,2,true,true,true,true,'50 documentos · facturación + inventario'),
('EXPRESS_M_100','Express 100','Facturación electrónica + inventario.',4.99,0,'mensual',302,true,100,null,1,1,1,2,true,true,true,true,'100 documentos · facturación + inventario'),
('EXPRESS_M_250','Express 250','Facturación electrónica + inventario.',6.99,0,'mensual',303,true,250,null,1,2,2,3,true,true,true,true,'250 documentos · facturación + inventario'),
('EXPRESS_M_500','Express 500','Facturación electrónica + inventario.',9.99,0,'mensual',304,true,500,null,1,2,3,5,true,true,true,true,'500 documentos · facturación + inventario'),
('EXPRESS_M_ILIMITADO','Express Ilimitado','Facturación electrónica + inventario sin límite de documentos.',14.99,0,'mensual',305,true,null,null,2,5,10,10,true,true,true,true,'Documentos ilimitados · facturación + inventario'),
('EXPRESS_A_50','Express 50 anual','Facturación electrónica + inventario.',0,20.49,'anual',401,true,null,50,1,1,1,2,true,true,true,true,'50 documentos · facturación + inventario'),
('EXPRESS_A_100','Express 100 anual','Facturación electrónica + inventario.',0,28.49,'anual',402,true,null,100,1,1,1,2,true,true,true,true,'100 documentos · facturación + inventario'),
('EXPRESS_A_250','Express 250 anual','Facturación electrónica + inventario.',0,40.99,'anual',403,true,null,250,1,2,2,3,true,true,true,true,'250 documentos · facturación + inventario'),
('EXPRESS_A_500','Express 500 anual','Facturación electrónica + inventario.',0,56.99,'anual',404,true,null,500,1,2,3,5,true,true,true,true,'500 documentos · facturación + inventario'),
('EXPRESS_A_ILIMITADO','Express Ilimitado anual','Facturación electrónica + inventario sin límite de documentos.',0,80,'anual',405,true,null,null,2,5,10,10,true,true,true,true,'Documentos ilimitados · facturación + inventario')
on conflict (codigo) do update set nombre=excluded.nombre,descripcion=excluded.descripcion,precio_mensual=excluded.precio_mensual,precio_anual=excluded.precio_anual,periodicidad=excluded.periodicidad,orden=excluded.orden,activo=true,max_documentos_mes=excluded.max_documentos_mes,max_documentos_anio=excluded.max_documentos_anio,max_contribuyentes=excluded.max_contribuyentes,max_establecimientos=excluded.max_establecimientos,max_puntos_emision=excluded.max_puntos_emision,max_usuarios=excluded.max_usuarios,incluye_inventario=excluded.incluye_inventario,incluye_ats=excluded.incluye_ats,incluye_carga_electronica=excluded.incluye_carga_electronica,incluye_reportes_avanzados=excluded.incluye_reportes_avanzados,descripcion_comercial=excluded.descripcion_comercial,updated_at=now();

-- POS: sistema comercial completo
insert into planes_suscripcion
(codigo,nombre,descripcion,precio_mensual,precio_anual,periodicidad,orden,activo,max_documentos_mes,max_documentos_anio,max_contribuyentes,max_establecimientos,max_puntos_emision,max_usuarios,incluye_inventario,incluye_ats,incluye_carga_electronica,incluye_reportes_avanzados,descripcion_comercial)
values
('POS_M_500','POS 500','Sistema comercial completo con POS, caja y bodegas.',14.99,0,'mensual',501,true,500,null,2,3,5,8,true,true,true,true,'500 documentos · POS + caja + inventario + bodegas'),
('POS_M_1000','POS 1000','Sistema comercial completo con POS, caja y bodegas.',19.99,0,'mensual',502,true,1000,null,3,5,10,15,true,true,true,true,'1.000 documentos · POS + caja + inventario + bodegas'),
('POS_M_ILIMITADO','POS Ilimitado','Sistema comercial completo sin límite de documentos.',24.99,0,'mensual',503,true,null,null,5,20,40,30,true,true,true,true,'Documentos ilimitados · POS + caja + inventario + bodegas'),
('POS_A_500','POS 500 anual','Sistema comercial completo con POS, caja y bodegas.',0,150,'anual',601,true,null,500,2,3,5,8,true,true,true,true,'500 documentos · POS + caja + inventario + bodegas'),
('POS_A_1000','POS 1000 anual','Sistema comercial completo con POS, caja y bodegas.',0,200,'anual',602,true,null,1000,3,5,10,15,true,true,true,true,'1.000 documentos · POS + caja + inventario + bodegas'),
('POS_A_ILIMITADO','POS Ilimitado anual','Sistema comercial completo sin límite de documentos.',0,250,'anual',603,true,null,null,5,20,40,30,true,true,true,true,'Documentos ilimitados · POS + caja + inventario + bodegas')
on conflict (codigo) do update set nombre=excluded.nombre,descripcion=excluded.descripcion,precio_mensual=excluded.precio_mensual,precio_anual=excluded.precio_anual,periodicidad=excluded.periodicidad,orden=excluded.orden,activo=true,max_documentos_mes=excluded.max_documentos_mes,max_documentos_anio=excluded.max_documentos_anio,max_contribuyentes=excluded.max_contribuyentes,max_establecimientos=excluded.max_establecimientos,max_puntos_emision=excluded.max_puntos_emision,max_usuarios=excluded.max_usuarios,incluye_inventario=excluded.incluye_inventario,incluye_ats=excluded.incluye_ats,incluye_carga_electronica=excluded.incluye_carga_electronica,incluye_reportes_avanzados=excluded.incluye_reportes_avanzados,descripcion_comercial=excluded.descripcion_comercial,updated_at=now();

notify pgrst, 'reload schema';
