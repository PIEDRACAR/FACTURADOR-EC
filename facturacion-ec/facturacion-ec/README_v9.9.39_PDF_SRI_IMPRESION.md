# CONTSERTRIB v9.9.39 — RIDE estilo SRI + selector de impresión

## Cambios
- RIDE/PDF de comprobantes complementarios reorganizado con composición inspirada en la representación impresa RIDE publicada por el SRI: emisor, bloque del comprobante/autorización, ambiente/emisión, receptor, detalle, totales e información de acceso.
- Mantiene estado BORRADOR SIN VALIDEZ TRIBUTARIA cuando no existe autorización.
- Antes de imprimir documentos desde el módulo de comprobantes aparece un selector: RIDE A4 o ticket térmico.
- Nuevo endpoint `/api/documentos/:id/ticket` para impresión térmica compacta, sin modificar XML ni estado SRI.
- La factura POS conserva su selector previo de formatos y RIDE.
- No se elimina ninguna funcionalidad previa.

## Referencia normativa/visual
El diseño se inspira en la estructura de los RIDE que el SRI publica en sus fichas técnicas. No se presenta como reproducción gráfica oficial pixel-perfect ni como documento emitido por el SRI.
