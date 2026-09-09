# CONTSERTRIB v9.6.2 — BUILD FIX

Corrección puntual sobre v9.6.1.

## Error de Railway corregido

Railway reportó:

`src/routes/proveedor.ts(206,34): error TS18004: No value exists in scope for the shorthand property 'correo'.`

La variable definida en el flujo es `email`, por lo que la respuesta ahora devuelve explícitamente:

`{ ok: true, correo: email, correoEnviado }`

No se modifica la lógica funcional de clientes, suscripciones, pagos, documentos SRI, facturación, POS, inventario, permisos ni panel proveedor.

## Despliegue

Mantener el comando de build:

`npm run build`

No incluye `node_modules` ni `dist`; Railway los genera durante el build.
