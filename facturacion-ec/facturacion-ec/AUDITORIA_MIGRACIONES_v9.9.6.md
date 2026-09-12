# Auditoría SQL CONTSERTRIB v9.9.6

## Resultado
Se revisaron las migraciones SQL incluidas en v9.9.5 y se corrigieron incompatibilidades detectadas para instalaciones nuevas y existentes.

### Correcciones críticas
- `plan_cuentas_contables`: índice corregido de `activo` a `activa`.
- IVA general: defaults y semillas normalizados a 15%; se eliminó la regresión 15% -> 13% de v9.9.0.
- `crear_venta`: se consolidan las firmas legacy conocidas y queda una RPC canónica de 14 parámetros (0/5/8/15 + descuentos + impuestos + propina + total + items + pagos).
- Catálogo IVA: se garantiza la columna `activo`, columnas históricas y un índice único explícito para evitar fallos de `ON CONFLICT`.
- Configuración IVA: se completan columnas faltantes y se audita la normalización 13% -> 15%.
- Idempotencia contable: índice único parcial para origen no nulo.
- Plantilla/importación de productos y formulario de productos: default general 15%.
- Tipos TypeScript del POS: aceptan 0/5/8/15/exento/no_objeto.

### Regla de despliegue
En una base ya existente, ejecutar la migración de estabilización después de las migraciones históricas; no borrar tablas ni recrear el proyecto Supabase.

### Validación
Se verificó que el paquete no contiene `dist/`, `node_modules/`, `.git` ni cachés. Se hizo revisión estática de referencias SQL/TypeScript/HTML. La compilación TypeScript completa depende de instalar las dependencias del proyecto y debe ejecutarse en CI/Railway antes de producción.
