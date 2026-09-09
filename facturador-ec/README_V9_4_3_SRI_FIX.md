# CONTSERTRIB FACTURACIÓN v9.4.3 — SRI diagnostics + build fix

## Qué se corrigió
- Se corrigió el error TypeScript de Railway causado por `EmissionResult` de la librería, que no declara `mensaje`, aunque el sistema sí lo genera para mostrar el detalle del SRI.
- Se creó el tipo interno `ResultadoFacturacion`, compatible con la librería y con los campos adicionales del sistema.
- La extracción de mensajes SRI ahora soporta mensajes directos y mensajes anidados dentro de `comprobantes.comprobante`, incluso cuando el parser devuelve un arreglo.
- En estado `DEVUELTA` se conserva y muestra el código, mensaje e `informacionAdicional` entregados por el SRI.
- El código 70 se detecta también cuando viene anidado; no se trata como un rechazo normal.
- El log de firmas guarda el detalle real del SRI, no solo `Estado SRI: ...`.
- El POS mejora el mensaje de rechazo/devolución sin alterar el flujo de facturas autorizadas.

## UI
- Se conserva el centro de notificaciones y el menú de usuario de v9.4.2.
- Se conserva la búsqueda, selector de negocio, sidebar, exportaciones, email, archivo XML/RIDE, semáforo de inventario, caja y demás módulos.
- No se eliminó ni sustituyó ninguna funcionalidad anterior.

## Despliegue
Railway debe ejecutar `npm install && npm run build`. El error reportado en el log era:
`src/routes/pos.ts(553,28): Property 'mensaje' does not exist on type 'EmissionResult'`
`src/services/facturacion.ts(443,68): Property 'mensaje' does not exist on type 'EmissionResult'`

Esta versión elimina esas dos causas de compilación.

## Comportamiento esperado ante DEVUELTA
Ejemplo de respuesta documentada por el SRI: código `35`, mensaje `DOCUMENTO INVÁLIDO` e `informacionAdicional` con la explicación estructural. El sistema debe presentar ese detalle, no un mensaje genérico.
