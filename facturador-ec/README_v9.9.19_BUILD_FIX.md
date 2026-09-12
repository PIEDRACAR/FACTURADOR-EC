# CONTSERTRIB FACTURACIÓN v9.9.19 — Corrección de compilación Railway

## Motivo
Railway v9.9.18 llegó a la etapa de `npm run build`, pero TypeScript detuvo la compilación por TS2353 en `src/routes/contabilidad.ts`, causado por expresiones ternarias que mezclaban el resultado tipado de Supabase con un objeto `{data: [], error: null}`.

## Corrección
Se eliminaron esas expresiones ternarias y se reemplazaron por variables tipadas/asignaciones explícitas en:
- `src/routes/contabilidad.ts`
- `src/services/motorContable.ts`
- `src/routes/reportes.ts`
- `src/routes/documentos.ts`

Esto evita que TypeScript infiera incorrectamente el tipo de la respuesta y mantiene el manejo de errores de Supabase.

## Validación local
- Parser TypeScript sobre todos los `.ts`: 0 fallos de sintaxis.
- `node --check public/app-shell.js`: OK.
- ZIP sin `node_modules`, `dist`, `.git`, cachés ni logs.

La compilación completa contra las dependencias de producción debe confirmarse en Railway con `npm run build`.
