-- ============================================================================
-- CONTSERTRIB v9.9.46 - RESET DE BASE PARA PRUEBAS DESDE CERO
-- ============================================================================
-- ATENCION: SCRIPT DESTRUCTIVO. BORRA DATOS DE TENANTS/CONTRIBUYENTES.
--
-- CONSERVA INTENCIONALMENTE:
--   * usuarios de Supabase Auth (incluido ROOT/admin)
--   * proveedores_admin (asociacion ROOT)
--   * planes_suscripcion (planes comerciales)
--   * catalogos tributarios maestros
--   * configuracion_proveedor (correo ROOT)
--   * control_migraciones
--   * estructura/tablas, funciones, indices y migraciones
--
-- ELIMINA:
--   * todos los emisores/contribuyentes
--   * todos los clientes de sus emisores
--   * productos, proveedores, inventario, caja y comprobantes de los emisores
--   * contabilidad, nomina y configuracion de cada emisor
--   * cuentas SaaS de clientes y sus facturas/suscripciones asociadas
--   * solicitudes de registro y sesiones activas
--   * auditoria SaaS de la etapa de pruebas
--
-- NO modifica archivos de codigo ni secretos de Railway.
-- Ejecutar UNA SOLA VEZ en Supabase SQL Editor sobre la base de pruebas.
-- ============================================================================

begin;

-- 0) Datos SaaS que no dependen de una fila emisor en cascada.
delete from facturas_saas;
delete from contribuyentes_cliente_saas;
delete from cuentas_cliente_saas;

-- 1) Historial/solicitudes de pruebas y sesiones. Se conserva Auth.
delete from solicitudes_registro_saas;
delete from sesiones;
delete from auditoria_saas;

-- 2) Facturación SaaS/relaciones que pueden impedir eliminar emisores.
delete from pagos_suscripcion;
delete from suscripciones;

-- 3) Contabilidad: se limpian primero asientos y reglas para respetar FK restrict.
delete from asiento_lineas_contables;
delete from asientos_contables;
delete from reglas_clasificacion_contable;
delete from activos_fijos_contables;

-- El plan de cuentas tiene una FK autorreferenciada con ON DELETE RESTRICT.
-- Rompemos temporalmente la jerarquía lógica poniendo el padre en NULL;
-- luego eliminamos todas las cuentas de los emisores.
update plan_cuentas_contables set cuenta_padre_id = null;
delete from plan_cuentas_contables;

-- 4) Eliminación definitiva de todos los contribuyentes/emisores.
-- Las tablas tenant restantes deben tener FK ON DELETE CASCADE hacia emisores
-- según las migraciones de CONTSERTRIB.
delete from emisores;

-- 5) Limpieza de cualquier dato independiente que pueda haber quedado de pruebas.
-- Los catálogos maestros NO se borran.
delete from solicitudes_registro_saas;
delete from sesiones;
delete from auditoria_saas;

-- 6) Comprobación final. Si algo no quedó en cero, el script falla y hace ROLLBACK.
do $$
declare
  n_emisores bigint;
  n_clientes bigint;
  n_comprobantes bigint;
  n_productos bigint;
  n_proveedores bigint;
  n_cuentas_saas bigint;
begin
  select count(*) into n_emisores from emisores;
  select count(*) into n_clientes from clientes;
  select count(*) into n_comprobantes from comprobantes;
  select count(*) into n_productos from productos;
  select count(*) into n_proveedores from proveedores;
  select count(*) into n_cuentas_saas from cuentas_cliente_saas;

  if n_emisores <> 0 or n_clientes <> 0 or n_comprobantes <> 0 or
     n_productos <> 0 or n_proveedores <> 0 or n_cuentas_saas <> 0 then
    raise exception 'RESET INCOMPLETO: emisores=%, clientes=%, comprobantes=%, productos=%, proveedores=%, cuentas_saas=%',
      n_emisores, n_clientes, n_comprobantes, n_productos, n_proveedores, n_cuentas_saas;
  end if;

  raise notice 'CONTSERTRIB: base de pruebas limpia. Emisores=0, clientes=0, comprobantes=0, productos=0, proveedores=0, cuentas SaaS=0.';
end $$;

notify pgrst, 'reload schema';

commit;
