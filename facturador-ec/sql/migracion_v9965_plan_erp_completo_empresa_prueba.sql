-- CONTSERTRIB v9.9.65
-- Empresa de prueba interna + plan ERP COMPLETO anual USD 350.
-- ADITIVA: no elimina planes, suscripciones ni datos existentes.
-- Ejecutar después de que planes_suscripcion exista.

ALTER TABLE IF EXISTS public.planes_suscripcion
  ADD COLUMN IF NOT EXISTS modulos_incluidos jsonb NOT NULL DEFAULT '{}'::jsonb;

INSERT INTO public.planes_suscripcion
(
  codigo,
  nombre,
  descripcion,
  precio_mensual,
  precio_anual,
  periodicidad,
  orden,
  activo,
  max_documentos_mes,
  max_documentos_anio,
  max_contribuyentes,
  max_establecimientos,
  max_puntos_emision,
  max_usuarios,
  incluye_inventario,
  incluye_ats,
  incluye_carga_electronica,
  incluye_reportes_avanzados,
  descripcion_comercial,
  modulos_incluidos
)
VALUES
(
  'ERP_COMPLETO_A_350',
  'ERP Completo',
  'CONTSERTRIB ERP integral: facturación electrónica, SRI, contabilidad, inventario multibodega, POS, caja, compras, ventas, cuentas por cobrar y pagar, nómina, activos fijos, conciliación bancaria, reportes y ATS.',
  0,
  350,
  'anual',
  900,
  true,
  NULL,
  NULL,
  999999,
  999999,
  999999,
  999999,
  true,
  true,
  true,
  true,
  'ERP completo · facturación + SRI + contabilidad + inventario multibodega + POS + caja + compras + CxC/CxP + nómina + activos fijos + conciliación + reportes + ATS',
  jsonb_build_object(
    'facturacion_electronica', true,
    'sri', true,
    'contabilidad', true,
    'inventario', true,
    'bodegas', true,
    'kardex', true,
    'lotes_caducidad', true,
    'transferencias_bodega', true,
    'reservas_inventario', true,
    'compras', true,
    'ventas', true,
    'caja', true,
    'punto_de_venta', true,
    'cuentas_por_cobrar', true,
    'cuentas_por_pagar', true,
    'nomina', true,
    'activos_fijos', true,
    'conciliacion_bancaria', true,
    'reportes', true,
    'reportes_financieros', true,
    'ats', true,
    'retenciones', true,
    'notas_credito_debito', true,
    'guias_remision', true,
    'liquidaciones_compra', true,
    'multiempresa', true,
    'multiestablecimiento', true,
    'multipunto_emision', true,
    'usuarios_permisos', true,
    'auditoria', true,
    'exportaciones', true,
    'importaciones', true,
    'soporte_saas', true
  )
)
ON CONFLICT (codigo) DO UPDATE SET
  nombre=EXCLUDED.nombre,
  descripcion=EXCLUDED.descripcion,
  precio_mensual=EXCLUDED.precio_mensual,
  precio_anual=EXCLUDED.precio_anual,
  periodicidad=EXCLUDED.periodicidad,
  orden=EXCLUDED.orden,
  activo=true,
  max_documentos_mes=EXCLUDED.max_documentos_mes,
  max_documentos_anio=EXCLUDED.max_documentos_anio,
  max_contribuyentes=EXCLUDED.max_contribuyentes,
  max_establecimientos=EXCLUDED.max_establecimientos,
  max_puntos_emision=EXCLUDED.max_puntos_emision,
  max_usuarios=EXCLUDED.max_usuarios,
  incluye_inventario=EXCLUDED.incluye_inventario,
  incluye_ats=EXCLUDED.incluye_ats,
  incluye_carga_electronica=EXCLUDED.incluye_carga_electronica,
  incluye_reportes_avanzados=EXCLUDED.incluye_reportes_avanzados,
  descripcion_comercial=EXCLUDED.descripcion_comercial,
  modulos_incluidos=EXCLUDED.modulos_incluidos,
  updated_at=now();

-- El plan es anual: 365 días. La empresa de prueba creada desde ROOT
-- usa ambiente='pruebas' y 30 días, sin PayPhone.
