-- ============================================================================
-- CONTSERTRIB v9.9.50 - LIMPIEZA SEGURA DE DATOS DE PRUEBA
-- ============================================================================
-- NO elimina funcionalidades, estructura ni seguridad.
-- NO usa DROP, TRUNCATE, ALTER, CASCADE ni session_replication_role.
-- Solo elimina DATOS OPERATIVOS de prueba, respetando primero las FK hijas.
-- Si una FK no contemplada impide la limpieza, la transaccion completa se
-- revierte y se informa el bloqueo: no queda una limpieza a medias.
-- ============================================================================

begin;

-- 1) Datos hijos de comprobantes/productos/clientes/proveedores.
--    El orden es deliberado: primero las tablas que referencian a otras.
do $$
declare
  t text;
  tablas text[] := array[
    'public.log_firmas',
    'public.comprobante_items',
    'public.comprobante_formas_pago',
    'public.comprobante_impuestos',
    'public.comprobante_archivos',
    'public.email_envios',
    'public.documentos_sri_borrador',
    'public.solicitudes_anulacion_sri',
    'public.pagos_cuentas_por_cobrar',
    'public.pagos_cuentas_por_pagar',
    'public.movimientos_caja',
    'public.proforma_items',
    'public.proformas',
    'public.movimientos_inventario',
    'public.cuentas_por_cobrar',
    'public.cuentas_por_pagar',
    'public.nomina_detalles',
    'public.nomina_pagos'
  ];
begin
  foreach t in array tablas loop
    if to_regclass(t) is not null then
      execute format('delete from %s', t);
    end if;
  end loop;
end $$;

-- 2) Comprobantes. Ya no existen comprobante_items ni otros hijos conocidos.
do $$
begin
  if to_regclass('public.comprobantes') is not null then
    delete from public.comprobantes;
  end if;
end $$;

-- 3) Nómina: detalles ya fueron eliminados; ahora empleados/periodos/pagos.
do $$
declare
  t text;
  tablas text[] := array[
    'public.nomina_empleados',
    'public.nomina_periodos'
  ];
begin
  foreach t in array tablas loop
    if to_regclass(t) is not null then
      execute format('delete from %s', t);
    end if;
  end loop;
end $$;

-- 4) Contabilidad operativa. Primero líneas y dependientes; luego asientos.
do $$
declare
  t text;
  tablas text[] := array[
    'public.asiento_lineas_contables',
    'public.activos_fijos_contables',
    'public.asientos_contables',
    'public.periodos_contables',
    'public.reglas_clasificacion_contable'
  ];
begin
  foreach t in array tablas loop
    if to_regclass(t) is not null then
      execute format('delete from %s', t);
    end if;
  end loop;
end $$;

-- 5) Plan de cuentas del tenant. Se desvincula la FK autorreferenciada
--    únicamente como dato y luego se elimina el contenido.
do $$
begin
  if to_regclass('public.plan_cuentas_contables') is not null then
    update public.plan_cuentas_contables set cuenta_padre_id = null;
    delete from public.plan_cuentas_contables;
  end if;
end $$;

-- 6) Datos maestros operativos del tenant.
--    Los comprobantes ya fueron eliminados, por lo que productos/clientes/
--    proveedores ya no tienen el bloqueo que originó 23503.
do $$
declare
  t text;
  tablas text[] := array[
    'public.productos',
    'public.clientes',
    'public.proveedores'
  ];
begin
  foreach t in array tablas loop
    if to_regclass(t) is not null then
      execute format('delete from %s', t);
    end if;
  end loop;
end $$;

-- 7) SaaS operativo. Se conservan planes_suscripcion y proveedores_admin.
do $$
declare
  t text;
  tablas text[] := array[
    'public.facturas_saas',
    'public.contribuyentes_cliente_saas',
    'public.cuentas_cliente_saas',
    'public.pagos_suscripcion',
    'public.suscripciones',
    'public.solicitudes_registro_saas',
    'public.auditoria_saas',
    'public.sesiones'
  ];
begin
  foreach t in array tablas loop
    if to_regclass(t) is not null then
      execute format('delete from %s', t);
    end if;
  end loop;
end $$;

-- 8) Configuración/relaciones operativas asociadas al emisor.
--    Solo se limpian filas; nunca se elimina la tabla ni su definición.
do $$
declare
  t text;
  tablas text[] := array[
    'public.usuarios_permisos',
    'public.usuarios_emisor',
    'public.notificaciones_leidas',
    'public.ats_compras',
    'public.ats_retenciones',
    'public.ats_generaciones',
    'public.historial_configuracion_iva',
    'public.configuracion_iva',
    'public.configuracion_sistema',
    'public.configuracion_documentos_notificaciones'
  ];
begin
  foreach t in array tablas loop
    if to_regclass(t) is not null then
      execute format('delete from %s', t);
    end if;
  end loop;
end $$;

-- 9) Establecimientos, puntos y cajas antes del emisor.
do $$
declare
  t text;
  tablas text[] := array[
    'public.puntos_emision',
    'public.establecimientos_emisor',
    'public.cajas'
  ];
begin
  foreach t in array tablas loop
    if to_regclass(t) is not null then
      execute format('delete from %s', t);
    end if;
  end loop;
end $$;

-- 10) Emisores. Si alguna FK existente no fue contemplada, PostgreSQL
--     aborta la transaccion y revierte TODO lo anterior.
do $$
begin
  if to_regclass('public.emisores') is not null then
    delete from public.emisores;
  end if;
end $$;

-- 11) Verificación. Solo consulta; no modifica estructura.
do $$
declare
  r text;
  n bigint;
  nombres text[] := array[
    'emisores','clientes','productos','proveedores','comprobantes',
    'log_firmas','comprobante_items','comprobante_formas_pago','movimientos_inventario',
    'proforma_items','cajas','movimientos_caja','establecimientos_emisor',
    'puntos_emision','documentos_sri_borrador','cuentas_por_cobrar',
    'cuentas_por_pagar','pagos_cuentas_por_cobrar','pagos_cuentas_por_pagar',
    'asientos_contables','asiento_lineas_contables','plan_cuentas_contables',
    'nomina_empleados','nomina_periodos','nomina_detalles','nomina_pagos',
    'facturas_saas','cuentas_cliente_saas','contribuyentes_cliente_saas',
    'suscripciones','pagos_suscripcion','solicitudes_registro_saas',
    'sesiones','auditoria_saas','usuarios_emisor','usuarios_permisos'
  ];
begin
  raise notice '============================================';
  raise notice 'CONTSERTRIB v9.9.50 - VERIFICACION';
  raise notice '============================================';
  foreach r in array nombres loop
    if to_regclass('public.' || r) is not null then
      execute format('select count(*) from public.%I', r) into n;
      raise notice '% = %', r, n;
    else
      raise notice '% = TABLA NO EXISTE (no se creo ni elimino)', r;
    end if;
  end loop;
  raise notice 'Se conservaron estructura, funcionalidades, RLS/politicas, Auth, planes y proveedores_admin.';
end $$;

notify pgrst, 'reload schema';
commit;
