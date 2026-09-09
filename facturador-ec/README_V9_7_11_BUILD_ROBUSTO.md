# CONTSERTRIB v9.7.11 — BUILD ROBUSTO

Esta versión parte de la versión comercial con la interfaz restaurada de v9.7.4 y **no elimina funcionalidades**.

## Corrección crítica

Se corrigió el bloque de cambio de plan en `src/routes/proveedor.ts` para que exista **una sola consulta/variable de relación SaaS** (`relCuenta`) dentro del alcance de la ruta. Se elimina la consulta redundante posterior y se reutiliza el mismo resultado.

Esto evita el error TypeScript `TS2451: Cannot redeclare block-scoped variable` que aparecía al compilar versiones con dos declaraciones de la misma relación.

## Mejoras de entrega

- Se conserva la interfaz visual de la línea v9.7.4.
- Se conservan los módulos y la lógica SaaS/comercial de la base v9.7.9.
- Se elimina `dist/` obsoleto del paquete para que el despliegue genere el build desde el código fuente actual.
- Se fija Node `24.18.0` mediante `.nvmrc`; además `package.json` mantiene el requisito `>=24.18.0`.
- Versión de aplicación: `0.1.12`.

## Despliegue

Ejecutar en un entorno Node 24.18+:

```bash
npm ci
npm run build
npm start
```

No ejecutar el build con Node 22.x.
