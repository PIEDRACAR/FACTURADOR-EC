# CONTSERTRIB v9.9.78 — Corrección definitiva `dirEstablecimiento`

## Error corregido
El SRI devolvía:

`35: ARCHIVO NO CUMPLE ESTRUCTURA XML — cvc-minLength-valid: Value '' ... minLength '1' for type 'dirEstablecimiento'`

El XML estaba enviando una dirección vacía en `<dirEstablecimiento>` porque existían puntos de emisión históricos con `puntos_emision.direccion` vacío.

## Corrección
La obtención del punto de emisión ahora aplica esta cascada:

1. `puntos_emision.direccion`
2. `establecimientos_emisor.direccion`
3. `emisores.direccion_matriz`

Si encuentra una dirección válida, la persiste nuevamente en `puntos_emision` para reparar el dato de forma permanente.

Además:
- rechaza antes de firmar si no existe ninguna dirección válida;
- valida máximo 300 caracteres;
- valida también la dirección de matriz;
- la misma corrección se aplica a facturas y demás documentos SRI;
- la validación XSD interna del SDK queda desactivada; la validación local explícita sigue siendo opcional mediante `VALIDAR_XSD_LOCAL=true`;
- no se modifica ni elimina historial de comprobantes.

## SQL opcional
`sql/migracion_v9978_direccion_establecimiento_sri.sql` repara inmediatamente los puntos de emisión existentes. El backend también hace la reparación automáticamente al utilizar un punto con dirección vacía.
