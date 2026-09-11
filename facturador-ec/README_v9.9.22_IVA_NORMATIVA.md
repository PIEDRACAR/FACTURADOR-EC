# CONTSERTRIB v9.9.22 — IVA conforme normativa SRI

## Cambios de esta versión
- IVA general parametrizado en 13% con código electrónico SRI 10.
- Selector de IVA por cada línea del carrito: general, turismo 8%, construcción 5%, 0%, exento y no objeto.
- El cajero puede cambiar la tarifa de la línea antes de emitir.
- El backend usa la tarifa elegida y no confía en el navegador para el cálculo.
- El 8% turismo queda condicionado a una vigencia registrada en `catalogo_iva_sri`; no es una tarifa permanente.
- Se registra la vigencia del Decreto Ejecutivo 391 (23–25 mayo 2026) como antecedente y la estructura permite agregar nuevos decretos sin alterar comprobantes históricos.
- XML agrupa impuestos por las tarifas reales de las líneas y utiliza los códigos SRI correspondientes.
- RIDE calcula los subtotales por tarifa desde las líneas para no rotular 13% como 15%.
- Productos activos que tenían 15% como configuración actual se normalizan a 13%; comprobantes históricos no se modifican.

## Migración
Ejecutar en Supabase SQL Editor:
`sql/migracion_contsertrib_v9922_iva_normativa.sql`

## Importante
El 8% turístico solo puede usarse cuando exista un decreto vigente para la fecha de emisión y el emisor cumpla las condiciones del sector turístico. La aplicación bloquea el 8% cuando no existe una vigencia activa en el catálogo.
