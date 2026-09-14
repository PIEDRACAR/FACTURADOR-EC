# v9.9.76 — Corrección definitiva de validación XSD de facturas

## Problema corregido
La emisión podía fallar con `El XML no pasó la validación XSD local: [object Object]`.
La causa técnica era que el SDK `facturacion-electronica-ec` estaba ejecutando su propia validación XSD interna durante `buildXml()` (`validateXsd: true`) antes de que CONTSERTRIB pudiera procesar los errores y mostrar el detalle.

## Solución
- El SDK ya no ejecuta esa validación interna opaca (`validateXsd: false`).
- CONTSERTRIB construye el XML, inserta `RUC Proveedor` en la única sección `infoAdicional`, y después ejecuta explícitamente `validateXmlAgainstXsd()`.
- Los errores XSD se convierten a mensajes legibles con código, mensaje, línea y columna cuando la librería los proporciona.
- Se mantiene la validación tributaria previa del POS, incluido `codigoPrincipal` máximo 25 caracteres.
- No se firma ni transmite al SRI un XML que no pase la validación local.
- Se mantiene el RUC del proveedor conforme al nuevo requisito SRI.

## SQL
No requiere migración SQL.
