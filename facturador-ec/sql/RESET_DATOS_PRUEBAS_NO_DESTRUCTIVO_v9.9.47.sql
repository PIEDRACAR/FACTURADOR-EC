-- ============================================================================
-- CONTSERTRIB v9.9.47 - LIMPIEZA DE DATOS PARA PRUEBAS DESDE CERO
-- ============================================================================
-- OBJETIVO:
--   Dejar los DATOS OPERATIVOS de prueba limpios, conservando íntegramente
--   el sistema, su estructura, funcionalidades y seguridad.
--
-- NO BORRA NI MODIFICA:
--   * código ni archivos del sistema
--   * tablas, columnas, índices, funciones, triggers, RLS ni políticas
--   * usuarios de Supabase Auth
--   * proveedores_admin / acceso ROOT
--   * planes_suscripcion y configuración maestra del proveedor
--   * catálogos tributarios maestros
--   * configuración del proveedor
--
-- LIMPIA DATOS DE PRUEBA:
--   * emisores/empresas y sus datos dependientes (si las FK tienen CASCADE)
--   * clientes, productos, proveedores, inventario, caja y comprobantes
--   * contabilidad, nómina y configuraciones dependientes de emisor
--   * cuentas/suscripciones/facturas SaaS de prueba
--   * solicitudes de registro, sesiones y auditoría de pruebas
--
-- SEGURIDAD:
--   * No se elimina ningún usuario de Auth.
--   * No se elimina proveedores_admin.
--   * Se limpian sesiones de aplicación para obligar a iniciar sesión de nuevo.
--
-- SEGURIDAD OPERATIVA:
--   * Todas las operaciones están dentro de una transacción.
--   * Las tablas opcionales se comprueban antes de usarlas.
--   * Si una FK impide la limpieza, PostgreSQL revierte TODA la transacción.
--   * Este script NO crea ni elimina estructura.
--
-- IMPORTANTE: ejecutar solo en la base de PRUEBAS que se desea dejar limpia.
-- ============================================================================

begin;

-- Ejecuta DELETE solamente si la tabla existe.
-- No usa DROP, TRUNCATE ni ALTER.
do $$
declare
  t text;
  tablas text[] := array[
    'public.facturas_saas',
    'public.contribuyentes_cliente_saas',
    'public.cuentas_cliente_saas',
    'public.solicitudes_registro_saas',
    'public.sesiones',
    'public.auditoria_saas',
    'public.pagos_suscripcion',
    'public.suscripciones',
    'public.asiento_lineas_contables',
    'public.asientos_contables',
    'public.reglas_clasificacion_contable',
    'public.activos_fijos_contables',
    'public.nomina_detalles',
    'public.nomina_periodos',
    'public.nomina_empleados',
    'public.plan_cuentas_contables'
  ];
begin
  foreach t in array tablas loop
    if to_regclass(t) is not null then
      execute format('delete from %s', t);
    end if;
  end loop;
end $$;

-- Las cuentas contables tienen una FK autorreferenciada. Esto es una
-- ACTUALIZACIÓN DE DATOS, no de estructura, y únicamente afecta cuentas
-- contables que acabamos de limpiar; después se eliminan.
do $$
begin
  if to_regclass('public.plan_cuentas_contables') is not null then
    update public.plan_cuentas_contables
       set cuenta_padre_id = null;
    delete from public.plan_cuentas_contables;
  end if;
end $$;

-- El emisor es el punto raíz de los datos operativos. Las migraciones del
-- sistema definen las relaciones tenant con ON DELETE CASCADE. Si alguna
-- relación no permite el borrado, PostgreSQL aborta y revierte todo.
do $$
begin
  if to_regclass('public.emisores') is not null then
    delete from public.emisores;
  end if;
end $$;

-- Limpieza adicional de tablas SaaS independientes que pudieran existir y
-- que no dependan de emisores.
do $$
declare
  t text;
  tablas text[] := array[
    'public.facturas_saas',
    'public.contribuyentes_cliente_saas',
    'public.cuentas_cliente_saas',
    'public.solicitudes_registro_saas',
    'public.sesiones',
    'public.auditoria_saas',
    'public.pagos_suscripcion',
    'public.suscripciones'
  ];
begin
  foreach t in array tablas loop
    if to_regclass(t) is not null then
      execute format('delete from %s', t);
    end if;
  end loop;
end $$;

-- Verificación NO destructiva: solo cuenta lo que exista.
do $$
declare
  r record;
  n bigint;
  nombres text[] := array[
    'emisores','clientes','productos','proveedores','comprobantes',
    'facturas_saas','cuentas_cliente_saas','contribuyentes_cliente_saas',
    'suscripciones','pagos_suscripcion','asientos_contables',
    'asiento_lineas_contables','nomina_empleados','nomina_periodos',
    'plan_cuentas_contables','solicitudes_registro_saas','sesiones','auditoria_saas'
  ];
begin
  raise notice '============================================';
  raise notice 'CONTSERTRIB v9.9.47 - VERIFICACION DE LIMPIEZA';
  raise notice '============================================';
  foreach r in array nombres loop
    if to_regclass('public.' || r) is not null then
      execute format('select count(*) from public.%I', r) into n;
      raise notice '% = %', r, n;
    else
      raise notice '% = TABLA NO EXISTE (se conserva el esquema actual)', r;
    end if;
  end loop;
  raise notice 'Usuarios Supabase Auth y proveedores_admin NO fueron eliminados.';
end $$;

notify pgrst, 'reload schema';
commit;

-- Si se llega aquí, la transacción terminó correctamente.
