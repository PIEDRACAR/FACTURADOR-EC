# CONTSERTRIB v9.10.8 — Auditoría de navegación, ventas y compras

## Implementado
- Menú lateral colapsable/expandible con un clic en escritorio.
- Estado persistente por navegador mediante localStorage.
- En modo colapsado se mantienen iconos y tooltips; no se eliminan funciones.
- En móvil se conserva el comportamiento existente.

## Recomendación funcional
Crear un Centro Comercial con dos entradas visibles: Ventas y Compras.

### Ventas
- Ventas emitidas/autorizadas.
- Facturas, notas y proformas.
- Importación histórica de XML de facturas de venta para conciliación, sin reemitir al SRI.
- Alta automática de clientes desde XML cuando la identificación no exista.

### Compras
- Compras y cuentas por pagar.
- Importación de XML SRI de facturas/retenciones recibidas.
- Alta automática de proveedores desde XML cuando la identificación no exista.
- Detección de duplicados por emisor + RUC + establecimiento + punto + secuencial + autorización/clave.
- Vista previa y validación antes de contabilizar.

### Regla contable recomendada
La importación XML NO debe contabilizar automáticamente en el primer paso. Debe seguir: XML → validación → tercero → documento pendiente → revisión → contabilización. Así se evita crear asientos duplicados o incorrectos.

## No implementado todavía
No se inventó un módulo de importación contable de XML que no tenga respaldo en el esquema actual. La implementación completa debe incorporar almacenamiento del XML original, trazabilidad, deduplicación, mapeo tributario y confirmación antes de afectar contabilidad/inventario.
