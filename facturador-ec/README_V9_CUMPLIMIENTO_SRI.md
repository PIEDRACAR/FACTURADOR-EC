# V9 — Cumplimiento SRI y emisión de los 6 comprobantes

Esta versión toma V8 como base y agrega el pipeline real de emisión para los documentos complementarios usando `facturacion-electronica-ec@1.0.1`:

- Factura (pipeline existente, con RUC proveedor).
- Nota de crédito.
- Nota de débito.
- Liquidación de compra.
- Guía de remisión.
- Comprobante de retención.

Para los cinco documentos complementarios se ejecuta: secuencial atómico → clave de acceso → construcción XML → inserción del RUC del proveedor en `infoAdicional` → validación XSD local → firma XAdES-BES → transmisión al SRI → consulta de autorización → almacenamiento de XML/clave/autorización/estado.

## Migración obligatoria

Ejecutar `sql/migracion_sri_cumplimiento_v9.sql` en Supabase. Esta migración:

1. crea el secuencial independiente de liquidación de compra;
2. actualiza `increment_secuencial` con la nueva columna;
3. agrega XML original y fecha de autorización a borradores;
4. crea `auditoria_sri`;
5. crea `solicitudes_anulacion_sri` para controlar el flujo de anulación;
6. obliga a que un RUC de proveedor válido mantenga activo el campo `RUC Proveedor`.

## Importante sobre el RUC del proveedor

El RUC configurado en el sistema debe ser **el RUC real del proveedor del sistema**, registrado ante el SRI conforme a la Resolución NAC-DGERCGC26-00000027. No se debe colocar el RUC del cliente/emisor como sustituto.

La interfaz ya no permite desactivar el campo: si existe un RUC de proveedor válido, `incluir_ruc_proveedor` se fuerza a `true`.

## Anulación

La V9 incorpora las tablas y reglas de control para evitar anulaciones inválidas. La transmisión automática de una solicitud de anulación al portal autenticado de SRI no se inventa ni se implementa mediante scraping: el SRI gestiona este trámite en SRI en Línea. El sistema debe registrar la solicitud, plazo, aceptación requerida y evidencia; la operación fiscal final debe quedar respaldada por la respuesta oficial del SRI.

## Estado de cumplimiento

Esta versión mejora sustancialmente la parte técnica, pero **no convierte por sí sola al propietario del software en proveedor registrado ante el SRI**. El registro RUC, establecimiento exclusivo y actividad económica exigidos por la Resolución NAC-DGERCGC26-00000027 son trámites del contribuyente.

Antes de producción se debe probar cada tipo de documento en SRI PRUEBAS con un certificado de pruebas válido y realizar una revisión final contra la ficha técnica vigente del SRI. El SRI mantiene la autoridad final sobre la autorización de los comprobantes.
