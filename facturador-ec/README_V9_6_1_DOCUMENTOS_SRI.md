# CONTSERTRIB v9.6.1 — Formularios SRI de documentos complementarios

## Objetivo
Se reemplazó el formulario genérico de documentos por formularios estructurados para nota de crédito, nota de débito, liquidación de compra, guía de remisión y comprobante de retención.

## Cambios
- Fecha de emisión y fechas de sustento con selector de fecha.
- Nota de crédito: factura sustentada, motivo, valor de modificación, detalle, cantidades, precios, descuentos e IVA.
- Nota de débito: factura sustentada, motivos, valores, base, impuestos y total.
- Liquidación de compra: proveedor, detalle de bienes/servicios, cantidad, precio, descuento, IVA, importe total y forma de pago.
- Guía de remisión: origen, fechas de transporte, transportista, placa, ruta, destinatarios, motivo, sustento y bienes transportados.
- Retención: período fiscal, sujeto retenido, documento de sustento, clave de acceso, importe, forma de pago y retenciones por impuesto/código/porcentaje/valor.
- Selección de facturas autorizadas como sustento para notas de crédito/débito.
- Validación server-side de montos y consistencia básica antes de firmar/transmitir.
- Se conserva validación XSD local y transmisión al SRI existente.

## Normativa/técnica de referencia
El SRI mantiene como esquema actual la Ficha Técnica de Comprobantes Electrónicos Esquema Off-line versión 2.32 y publica los XSD correspondientes a factura, nota de crédito, nota de débito, liquidación, guía y retención. La implementación no sustituye la validación del SRI.

## Base de datos
No requiere una migración nueva: los datos estructurados se almacenan en el JSON de `documentos_sri_borrador` existente.

## Verificaciones realizadas
- Sintaxis JavaScript del formulario: OK.
- ZIP integrity: OK.
- No se incluyeron `node_modules` ni `dist`.
- El build completo de TypeScript debe ejecutarse en Railway con dependencias instaladas.
