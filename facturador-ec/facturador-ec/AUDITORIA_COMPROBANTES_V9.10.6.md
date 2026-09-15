# Auditoría de emisión electrónica — CONTSERTRIB v9.10.6

## Alcance
Revisión y mejora de Factura, Nota de Crédito, Nota de Débito, Liquidación de Compra, Guía de Remisión y Comprobante de Retención.

## Automatización incorporada
- Selector de comprobante autorizado como sustento con búsqueda por número, identificación, razón social o clave de acceso.
- Autollenado de identificación, razón social, número, fecha y clave de acceso.
- Nota de crédito: copia los detalles de la factura sustento para poder ajustar cantidades/valores antes de emitir.
- Nota de débito: copia datos del sustento, pero mantiene el importe de la nueva modificación en cero para evitar trasladar accidentalmente el total completo de la factura.
- Guía de remisión: selector de factura de sustento por destinatario, con autollenado de destinatario, dirección, número, fecha, clave y bienes cuando están disponibles.
- Retenciones: al seleccionar el comprobante, se autocompletan total sin impuestos, total, clave, fecha y pago. Para Renta se propone como base el total sin impuestos; para IVA se propone el IVA causado.
- Retenciones: el código, porcentaje y valor retenido se recalculan a partir del concepto SRI seleccionado.
- Liquidación de compra: mantiene cálculo automático por línea y totales según tarifa de IVA seleccionada, con descripción normalizada para preflight.

## Referencia normativa
El catálogo de porcentajes de Impuesto a la Renta se basa en la Resolución NAC-DGERCGC26-00000009, aplicable desde el 1 de marzo de 2026. Los porcentajes de IVA se mantienen sujetos a la Resolución NAC-DGERCGC20-00000061 y sus reformas. La ficha técnica vigente de comprobantes electrónicos publicada por el SRI corresponde al esquema Off-line versión 2.34 actualizado en julio de 2026.

## Integridad
No se eliminan comprobantes ni columnas existentes. La selección de sustento se valida contra el mismo emisor y contra estado autorizado cuando se usa `comprobanteSustentoId`.
