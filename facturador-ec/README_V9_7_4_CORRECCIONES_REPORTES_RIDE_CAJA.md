# CONTSERTRIB v9.7.4 — Reportes, Caja, RIDE y Ticket

Correcciones aplicadas sobre v9.7.3:

- RIDE PDF: el RUC del proveedor del sistema ya no aparece en el encabezado del emisor; se presenta en el bloque `INFORMACIÓN ADICIONAL` inferior, coherente con la estructura del comprobante.
- RIDE PDF: se reforzó encabezado con ambiente/emisión y se conserva clave de acceso y código de barras.
- Ticket: botón de impresión explícito, autoimpresión más robusta y RUC del proveedor en `INFORMACIÓN ADICIONAL`, no en encabezado.
- Caja: corregido el filtro de comprobantes autorizados (`autorizado`), que impedía considerar ventas en efectivo al arqueo/cierre.
- Reporte de caja: ahora muestra efectivo esperado, contado y diferencia, y resumen de ventas en efectivo/otros medios e ingresos/egresos manuales.
- Reportes: corregida llamada del botón de anulación que apuntaba a una función inexistente.
- Exportación PDF/Excel de caja actualizada.

Migración: `sql/migracion_reportes_ride_caja_v974.sql`.

Nota: la representación impresa (RIDE) debe mantener la información consistente con el XML autorizado.
