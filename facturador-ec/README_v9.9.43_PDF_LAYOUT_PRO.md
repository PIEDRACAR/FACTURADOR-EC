# CONTSERTRIB v9.9.43 — PDF RIDE LAYOUT PRO

## Objetivo
Optimización visual de los RIDE A4 de los seis comprobantes electrónicos: factura, nota de crédito, nota de débito, liquidación de compra, guía de remisión y comprobante de retención.

## Cambios
- Zona reservada al logo uniforme en todos los RIDE.
- Encabezado compacto y centrado, inspirado en la composición de referencia del SRI.
- Código de barras Code128 ubicado únicamente en la caja superior derecha, junto con la clave de acceso.
- Eliminada la repetición inferior del código de barras y de la clave de acceso en los RIDE complementarios.
- En factura también se elimina la repetición inferior de la clave; la clave y código quedan en el bloque superior.
- Márgenes A4 conservados mediante coordenadas dentro del área segura.
- Tipografías, tablas y bloques compactados para reducir espacio desperdiciado.
- Se mantiene el RUC del proveedor del sistema en Información adicional cuando está configurado y habilitado.
- No se modifica XML, firma, clave de acceso, secuencial, autorización ni transmisión SRI.

## Validación
El entorno de trabajo no contiene `node_modules`, por lo que no se declara un build TypeScript completo como aprobado. Se verifican estructuralmente los cambios y la integridad del ZIP.
