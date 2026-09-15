# CONTSERTRIB v9.5.2 — Corrección de emisión y documentos SRI

- Corrige el falso `Unexpected token '<'` del POS cuando el servidor responde HTML en una ruta API.
- API responde JSON en 404/500 para rutas `/pos`, `/api`, `/comprobantes` y `/documentos`.
- POS valida `Content-Type` antes de ejecutar `response.json()`.
- Se corrige el secuencial atómico de liquidaciones de compra en `increment_secuencial.sql`.
- Documentos SRI ahora validan campos mínimos por tipo antes de firmar/enviar.
- Se conserva `DEVUELTA` correctamente en la tabla de documentos.
- Se normalizan campos genéricos del formulario (`sustento`, `motivo`, identificación/razón social) hacia los campos SRI.

## Tipos cubiertos
Factura, nota de crédito, nota de débito, liquidación de compra, guía de remisión y comprobante de retención.

La implementación se basa en los tipos y esquemas que el SRI publica para estos seis documentos y en la transmisión inmediata vigente desde 2026.


## v9.5.4 — Corrección de compilación TypeScript

- Corregido `TS18046` en `src/index.ts`: el `error` recibido por `setErrorHandler` se trata como `unknown` bajo TypeScript estricto.
- El manejador ahora obtiene de forma segura `statusCode` y el mensaje/detalle sin acceder directamente a propiedades de un `unknown`.
- Se mantiene la respuesta JSON para rutas API, evitando nuevamente respuestas HTML que provoquen `Unexpected token <` en el POS.
- Versión del paquete: `0.1.3`.
