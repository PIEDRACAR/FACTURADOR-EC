# CONTSERTRIB v9.7.5 — Motor de impuestos configurable

## Objetivo
La tarifa del IVA ya no debe estar grabada como una decisión permanente del código. El sistema usa perfiles tributarios y un catálogo de reglas con fecha de vigencia y código SRI.

## Qué cambia
- `reglas_iva`: catálogo versionado por vigencia.
- `productos.perfil_iva`: GENERAL, TURISMO, FIJA_5, CERO, EXENTO, NO_OBJETO.
- `emisores.actividad_turistica`, `registro_turismo`, `luaf_vigente`, `numero_registro_turismo`.
- POS y conversión de proformas resuelven la tarifa en servidor según fecha, perfil y elegibilidad.
- El XML usa el código SRI y tarifa que resulten de la regla vigente.
- Las facturas históricas conservan la tarifa aplicada en `comprobante_items.tarifa_iva` y no se recalculan.
- RIDE calcula los subtotales por tarifa directamente desde los ítems históricos, evitando mostrar siempre “15%” si la tarifa general cambia.
- Pantalla `/impuestos-admin` para el administrador de CONTSERTRIB: publicar, activar y desactivar reglas.
- Configuración del contribuyente permite marcar actividad turística, Registro Nacional de Turismo y LUAF.

## Reglas cargadas
- IVA general 15% desde 2024-04-01, código SRI 4.
- IVA 5% para el perfil especial correspondiente, código SRI 5.
- IVA 0%, exento y no objeto.
- Periodos turísticos 2026 conocidos: 14–17 de febrero y 23–25 de mayo, código SRI 8.

La tarifa turística no queda abierta todo el año: solo se aplica si existe una regla TURISMO vigente para la fecha y el emisor tiene actividad turística, Registro de Turismo y LUAF configurados.

## Si el SRI cambia el IVA
No se modifica la regla histórica ni las facturas emitidas. El administrador publica una nueva regla, por ejemplo:
- clave: `IVA_GENERAL_2027`
- porcentaje: `16`
- código SRI: el que corresponda según la ficha técnica vigente
- fecha de inicio: fecha legal de aplicación
- norma: resolución/decreto correspondiente

Desde esa fecha los productos con perfil `GENERAL` usarán automáticamente la nueva tarifa. Los productos con perfiles especiales conservan sus propias reglas.

## Migración
Ejecutar en Supabase SQL Editor:
`sql/migracion_motor_impuestos_v975.sql`

La migración es idempotente para las reglas iniciales y mantiene la trazabilidad histórica.

## Verificación
- Integridad del ZIP: verificar antes de publicar.
- Sintaxis JavaScript de HTML: verificar con script de extracción.
- TypeScript: el build completo requiere instalar dependencias (`node_modules`); no afirmar build local completo si no se dispone de ellas.
