# CONTSERTRIB v9.9.87 — correcciones de despliegue

## Corregido
- Error de TypeScript en `src/routes/emisores.ts`: `emisorId` podía quedar como `undefined` en el análisis estricto. Se agregó una comprobación explícita antes de usarlo como `string`.
- `package-lock.json` sincronizado con la versión `0.1.9-v9.9.87` del `package.json`.
- `packageManager` declarado como `npm@11.19.0` para que Railway/Railpack no tenga que inferir la versión de npm.
- Cookies de sesión y selección de negocio mantienen `httpOnly` y `SameSite=Lax`, y ahora usan `Secure` automáticamente cuando `NODE_ENV=production`.

## Diagnóstico del log de Railway
El entorno de Railway sí está seleccionando Node `24.20.0`, que satisface `>=24.18.0`.
La instalación terminó y reportó 0 vulnerabilidades en ese build.
El fallo que detuvo el despliegue fue exclusivamente el TypeScript:
`src/routes/emisores.ts(210,15): TS2322`.

## Nota
La compilación local del contenedor de auditoría no se puede usar como prueba definitiva porque este contenedor dispone de Node 22 y el proyecto exige Node >=24.18.0. Railway ya mostró Node 24.20.0 en el log proporcionado.
