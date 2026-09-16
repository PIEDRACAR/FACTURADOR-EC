# Auditoría v9.10.12 — Nómina y Contabilidad

## Alcance
- Roles individuales y generales en PDF y Excel.
- Firmas de responsabilidad en ambos formatos.
- Filtros de lectura en todas las pestañas contables.
- Exportación Excel/PDF consistente.
- Pestaña de asientos descuadrados.
- Eliminación segura de asientos MANUAL/AJUSTE únicamente en períodos abiertos.
- Asistente inteligente de auditoría contable.

## Criterio de integridad
Los reportes derivados (Balance, Resultados, Flujo, Diario, Mayor, Balanza) no se modifican físicamente desde su reporte. La modificación se realiza en el origen: asiento manual, documento SRI, inventario, cartera o nómina. Los asientos automáticos no se eliminan desde el reporte.

## Nómina
El rol individual toma el detalle persistido de `nomina_detalles` del período y el trabajador correspondiente. El rol general utiliza todos los detalles del período. Se incluyen sueldos, IESS, décimos, vacaciones, reserva, beneficios acumulados, neto y costo empleador, más espacios de firma.

## Asistente
El asistente no ejecuta cambios automáticamente. Analiza descuadres, documentos SRI pendientes, estado de nómina y empleados activos, y devuelve recomendaciones para revisión humana.

## Migración
`sql/migracion_v91012_nomina_reportes_asientos.sql` es aditiva y crea la RPC para eliminación segura de asientos manuales/ajustes.
