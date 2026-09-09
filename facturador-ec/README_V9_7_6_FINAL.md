# CONTSERTRIB Facturación — v9.7.6 FINAL

## Base integrada
Esta versión parte de **v9.7.5 MOTOR IMPUESTOS** y conserva íntegramente lo incorporado en **v9.7.4 REPORTES / RIDE / CAJA / TICKET**.

No se eliminó ningún archivo ni módulo funcional de las dos entregas.

## Correcciones de cierre
- Se conserva el motor de impuestos configurable por fecha, perfil y emisor.
- Se conserva la resolución automática del IVA para POS y conversión de proformas.
- Se conserva el congelamiento de la tarifa tributaria en los ítems del comprobante antes de emitir.
- Se conserva RIDE/PDF dinámico por tarifa y las mejoras de caja/ticket/reportes de v9.7.4.
- Se conserva la administración de reglas en `/impuestos-admin`.
- Se conserva la configuración turística del emisor.
- Se corrigió la versión inconsistente del `package-lock.json`: ahora coincide con `package.json` (`0.1.10`).
- Se mantienen todas las migraciones SQL anteriores y la nueva `migracion_motor_impuestos_v975.sql`.

## Verificación realizada
- v9.7.5 es un superconjunto de v9.7.4: no había archivos exclusivos de v9.7.4 que faltaran en v9.7.5.
- Se revisaron las diferencias de POS, proformas, comprobantes, configuración, productos, RIDE, protección de sesión e índice principal.
- Se realizó una comprobación de sintaxis/transpilación de los fuentes TypeScript; el único archivo que no aplica a `transpileModule` es la declaración `.d.ts`, por su naturaleza de archivo de tipos.
- El chequeo completo de `tsc` requiere las dependencias instaladas (`@types/node`, `@types/pdfkit`); el entorno de revisión no terminó de instalar `node_modules` antes del límite de ejecución.

## Importante antes de producción
Ejecutar las migraciones SQL pendientes en Supabase, especialmente:
`sql/migracion_motor_impuestos_v975.sql`

Después ejecutar una prueba real en ambiente de pruebas: factura 15%, producto 5%, turismo elegible/no elegible, nota de crédito, RIDE/PDF, cierre de caja y ATS.
