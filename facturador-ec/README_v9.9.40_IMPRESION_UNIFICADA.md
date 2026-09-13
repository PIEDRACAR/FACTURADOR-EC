# CONTSERTRIB v9.9.40 — Impresión unificada de los 6 comprobantes

## Objetivo
Unificar el flujo de impresión para los seis comprobantes electrónicos que maneja CONTSERTRIB: factura, nota de crédito, nota de débito, liquidación de compra, guía de remisión y comprobante de retención.

## Cambios
- Se incorpora un selector global y único: **RIDE A4** o **Ticket térmico**.
- El selector intercepta los enlaces existentes de RIDE/PDF/Ticket para evitar que una pantalla salte el selector.
- Factura: RIDE A4 `/comprobantes/:id/ride` y ticket `/comprobantes/:id/ticket`.
- Documentos SRI complementarios: RIDE A4 `/api/documentos/:id/pdf` y ticket `/api/documentos/:id/ticket`.
- `documentos.html` usa el selector global.
- La vista previa de factura conserva su función, pero el botón de impresión pasa por el selector único.
- El selector declara explícitamente que es una operación de solo lectura: no firma, no transmite, no consulta al SRI y no modifica XML, clave de acceso ni estado.
- Se actualizan referencias de caché a v9.9.40.

## Integridad tributaria
La impresión se basa en datos ya persistidos y no ejecuta ninguna operación de emisión. El XML firmado/autorizado y la transmisión al SRI permanecen fuera del flujo de impresión.

El RIDE es la representación impresa del documento electrónico. El diseño busca una composición profesional alineada con la estructura de los RIDE publicados por el SRI; no se afirma que sea una copia pixel-perfect del PDF generado por el SRI.

## Verificación
- ZIP íntegro y sin `node_modules`, `dist`, `.git`, caches ni temporales.
- Se realizará validación sintáctica de los archivos JavaScript modificados.
- La compilación TypeScript completa requiere instalar las dependencias del proyecto; no se debe declarar como pasada si el entorno no contiene `node_modules`.
