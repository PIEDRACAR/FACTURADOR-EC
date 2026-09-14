# CONTSERTRIB v9.9.56 — Planes comerciales

Se incorpora una estructura comercial por volumen y periodicidad sin eliminar funcionalidades existentes.

## BÁSICO — solo facturación
Anual: 25=$5, 50=$10, 100=$15, 200=$20, 300=$25, 500=$35.
Mensual: 5=$2.99, 10=$3.49, 20=$3.99, 30=$4.49, 50=$4.99, 100=$6.99, 150=$7.99, 200=$8.99, 300=$10.99, 500=$13.99.

## Profesional / Empresarial
Escalas mensuales y anuales con límites progresivos y módulos según plan.

## Compatibilidad
- No se borran planes ni suscripciones históricas.
- Los planes antiguos se desactivan solo para nuevas contrataciones.
- Los planes anuales consumen el límite de comprobantes durante su período de suscripción.
- ROOT puede editar precios, modalidad, límites y módulos.
- El registro público carga el catálogo activo mediante `/planes-publicos`.

## Supabase
Ejecutar una sola vez `sql/migracion_planes_comerciales_v956.sql`.
