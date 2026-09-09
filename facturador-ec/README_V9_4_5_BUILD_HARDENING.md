# CONTSERTRIB FACTURACIÓN v9.4.5 — Build Hardening

Esta versión es acumulativa sobre v9.4.4 y no revierte funcionalidades.

## Correcciones

- Se eliminó la dependencia de los tipos `EmissionResult` del SDK para los resultados de documentos SRI.
- Se creó un tipo de dominio propio para evitar que cambios o uniones restrictivas del SDK vuelvan a romper el build.
- Se normaliza `DEVUELTO` → `DEVUELTA`.
- Se normaliza el ambiente interno a `pruebas | produccion`.
- `fechaAutorizacion` se normaliza a `Date | null`.
- Los mensajes SRI se extraen tanto de `mensajes` como de `comprobantes.comprobante.mensajes`, incluyendo respuestas con arreglo.
- Documentos SRI mantienen estado `EN PROCESAMIENTO` cuando el SRI todavía no termina.
- Se amplió el sondeo de autorización de documentos a 10 consultas con espera entre consultas.
- Facturas y documentos conservan el detalle real entregado por SRI.

## Validación local realizada

Se verificó la sintaxis TypeScript de los archivos modificados principales con el compilador TypeScript instalado en el entorno de trabajo.

El build completo contra el registro npm no se ejecutó en este entorno porque el acceso al registro de dependencias no está disponible. Railway debe ejecutar `npm install && npm run build` con las dependencias declaradas en `package-lock.json`.
