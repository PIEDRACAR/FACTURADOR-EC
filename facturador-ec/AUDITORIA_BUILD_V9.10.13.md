# CONTSERTRIB v9.10.13 — Corrección de build Railway

## Incidencias corregidas

1. `src/services/excel.ts`: ExcelJS 4.4.0 no expone `Worksheet.pageMargins`; los márgenes se configuran mediante `Worksheet.pageSetup.margins`.
2. `src/services/nominaReportes.ts`: misma corrección para los reportes de nómina.
3. `src/services/motorContable.ts`: se corrigió una referencia a la variable inexistente `existingCxc`; la variable real es `existenteCxc`.

## Integridad

No se eliminan funcionalidades ni datos. El cambio es compatible con ExcelJS 4.4.0 y conserva la lógica del motor contable y los reportes.

## Validación

- Revisadas todas las referencias a `pageMargins`: ninguna queda en `src/`.
- Revisadas referencias a `existingCxc`: ninguna queda en `src/`.
- `package.json` y `package-lock.json` actualizados a v9.10.13.
- La compilación definitiva debe confirmarse en Railway con Node 24.20.0.
