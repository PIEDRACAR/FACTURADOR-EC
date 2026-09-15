# CONTSERTRIB Facturación v9.4.4 — Railway Build Fix

## Corrección aplicada

Se corrigió el fallo de compilación TypeScript reportado por Railway en `src/services/facturacion.ts`.

### Error de Railway
- `DEVUELTA` no era aceptado por el tipo `EmissionEstado` de `facturacion-electronica-ec@1.0.1` (la librería declara `DEVUELTO`).
- `pruebas/produccion` no era compatible con el tipo `Ambiente` de la librería.
- `EN PROCESAMIENTO` no era compatible con `EmissionEstado`.
- `fechaAutorizacion` de la librería podía ser `Date | null`, mientras el código la trataba como `string | null`.

## Solución

Se desacopló el resultado interno del facturador de las uniones restrictivas de la librería y se creó `ResultadoFacturacion` propio del sistema.

Además:
- Se normaliza `DEVUELTO` → `DEVUELTA` sin perder la respuesta real del SRI.
- Se conserva la extracción de mensajes anidados del SRI.
- Se conserva el código 70 y su tratamiento.
- Se conserva el campo `RUC Proveedor` antes de firmar.
- Se conserva la validación XSD local.
- Se conserva el sondeo de autorización y el estado `EN PROCESAMIENTO`.
- Se conserva el archivo permanente de comprobantes autorizados.
- No se revierte ninguna mejora funcional de v9.4.3.

## Validación local

La sintaxis TypeScript de `facturacion.ts`, `pos.ts` y `documentosSri.ts` fue comprobada con el compilador TypeScript mediante transpilación.

La compilación completa local no se usa como criterio final porque el entorno local no pudo completar la instalación de dependencias. Railway debe ejecutar `npm install && npm run build` con el `package-lock.json` incluido.
