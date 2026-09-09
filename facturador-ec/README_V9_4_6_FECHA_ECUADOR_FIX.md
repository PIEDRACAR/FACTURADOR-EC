# CONTSERTRIB FACTURACIÓN v9.4.6 — FIX FECHA SRI 65

## Problema corregido

El SRI devolvió el comprobante con:

- Estado: `DEVUELTA`
- Código: `65`
- `FECHA EMISION EXTEMPORANEA`
- El XML estaba generando la fecha `08/09/2026`.

La causa técnica detectada es que Railway/Node opera en UTC. En las horas posteriores a las 19:00 de Ecuador, UTC ya puede estar en el día siguiente, por lo que `new Date().getDate()` puede generar una fecha tributaria futura respecto de Ecuador/SRI.

## Corrección

Se creó `src/utils/fechaEcuador.ts`, que obtiene la fecha tributaria usando explícitamente:

`America/Guayaquil`

El POS ahora genera la fecha de emisión mediante `fechaEmisionEcuador()` y no mediante `getDate()/getMonth()` del servidor.

También se corrigió el fallback de `documentosSri.ts` para utilizar la misma zona horaria.

## Resultado esperado

Si Railway está en:

`2026-09-08T00:30:00Z`

la aplicación reconoce correctamente que en Ecuador todavía es:

`07/09/2026`

y genera `07/09/2026` en el comprobante.

## Importante

No se modificó ni eliminó ninguna funcionalidad de las versiones anteriores. Este cambio es acumulativo sobre v9.4.5.
