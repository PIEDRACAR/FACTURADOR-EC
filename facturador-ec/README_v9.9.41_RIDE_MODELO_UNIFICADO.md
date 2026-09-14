# CONTSERTRIB v9.9.41 — RIDE UNIFICADO A4 PARA LOS 6 COMPROBANTES

## Objetivo
Se establece un sistema visual único para la representación RIDE A4 de los seis comprobantes electrónicos del sistema: factura, nota de crédito, nota de débito, liquidación de compra, guía de remisión y comprobante de retención.

## Diseño
- Composición inspirada en el RIDE de referencia del SRI: marca/logo a la izquierda, bloque del emisor debajo y caja del documento/autorización a la derecha.
- Dos tonos de azul sobrios para bordes, títulos y encabezados.
- Recuadro de receptor/sujeto.
- Tablas y totales compactos.
- Código de barras Code128 de la clave de acceso cuando existe.
- Clave de acceso en texto.
- Estado AUTORIZADO o BORRADOR claramente visible.
- Logo por emisor desde configuracion_sistema; si no existe, se muestra marca neutra de CONTSERTRIB sin inventar un logo del cliente.

## RUC del proveedor del sistema
El RUC del proveedor de facturación se mantiene fuera del encabezado del emisor. Se obtiene de `RUC_PROVEEDOR_FACTURACION` o de `configuracion_sistema.ruc_proveedor_facturacion` y se presenta en el bloque **INFORMACIÓN ADICIONAL** del RIDE. La configuración permanece administrada centralmente.

## Integridad tributaria
La impresión solo lee información ya almacenada. No firma, no genera una nueva clave, no incrementa secuenciales, no transmite ni retransmite al SRI y no modifica XML/estado.

## Validación
El `tsc` global del entorno no puede completar un build limpio porque este entorno de revisión no tiene `node_modules` instalados. Los errores reportados corresponden a dependencias/tipos ausentes y errores preexistentes; no se detectaron errores sintácticos en los archivos RIDE modificados.
