# CONTSERTRIB v9.9.28 — Comprobantes SRI: procesamiento y RIDE imprimible

- Un comprobante que queda en estado `EN PROCESAMIENTO` del SRI ahora permanece como `procesando`, no se marca erróneamente como rechazado.
- Se agregó `Consultar SRI` para consultar el estado real de una transmisión pendiente sin volver a transmitir el comprobante.
- Los comprobantes autorizados muestran `PDF`, `Imprimir`, `XML` y `Reenviar`.
- Al autorizar desde la pantalla, se abre automáticamente el RIDE PDF en una nueva pestaña para imprimirlo inmediatamente.
- `Imprimir` no retransmite ni modifica el comprobante: solamente abre el RIDE ya autorizado.
- Si el navegador bloquea la ventana emergente, se muestra una indicación para permitir ventanas emergentes de CONTSERTRIB.
- No se eliminan las funciones de firma, transmisión SRI, XML, RIDE, correo ni reenvío.
