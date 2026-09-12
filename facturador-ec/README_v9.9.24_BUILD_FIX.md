# CONTSERTRIB FACTURACIÓN v9.9.28 — Corrección de build sin regresión

Esta versión parte íntegramente de v9.9.23 y conserva sus funcionalidades.

## Corrección aplicada
Railway reportó dos errores TypeScript en PDFKit:
- `src/services/documentoSriPdf.ts`: `align: 'left'` no es aceptado por los tipos de imagen de PDFKit.
- `src/services/ride.ts`: mismo problema.

La posición izquierda ya estaba determinada por las coordenadas `x/y`, por lo que se eliminó únicamente la opción de tipado incompatible. El logo, tamaño y posición visual se conservan.

## Se conserva
- Logo personalizado por contribuyente en RIDE.
- Configuración de logo PNG/JPEG.
- IVA parametrizado y selector por línea.
- 8% turismo sujeto a vigencia.
- XML/RIDE de comprobantes complementarios.
- Descarga XML/PDF y reenvío por correo.
- Formas de pago y valor por forma.
- Precio editable y descuentos.
- Contabilidad, POS, inventario, reportes, SaaS y demás módulos existentes.

## Validación
Se debe ejecutar `npm install` y `npm run build` en un entorno con dependencias para confirmar el build completo antes de producción.
