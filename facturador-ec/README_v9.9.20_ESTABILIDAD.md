# CONTSERTRIB v9.9.20 — Estabilidad contable y SRI

## Correcciones críticas
- Nota de crédito: `totalConImpuestos` ahora usa la estructura plana requerida por `facturacion-electronica-ec@1.0.1`, evitando `toFixed(undefined)`.
- Proforma PDF: ya no consulta `proforma_items.created_at` antes de que exista; además la migración 9.9.20 agrega la columna para instalaciones actuales.
- RIDE: recuadro de autorización ampliado; número de autorización de 49 dígitos dividido en líneas y fecha/ambiente separados para evitar superposición.
- Contabilidad: sincronización de ventas tolerante con instalaciones históricas; si faltan tablas de impuestos/pagos usa los campos legacy sin inventar cobros.
- Nómina: alta compatible con esquemas que aún tienen `empresa_id NOT NULL`; se envían `emisor_id` y `empresa_id` cuando corresponde. Se agregan PATCH y DELETE para que editar/desactivar funcionen.
- Contabilidad: cada pestaña tiene Excel, PDF e Importar Excel. Los reportes derivados importan asientos MANUAL; Plan y Nómina importan sus datos propios.

## Migración obligatoria
Ejecutar en Supabase:
`sql/migracion_contsertrib_v9920_estabilidad.sql`

## Validación
Se revisa sintaxis JavaScript/TypeScript. No se afirma un deploy real hasta que Railway termine `npm run build` y arranque `npm start`.
