# CONTSERTRIB v9.9.79 — Cumplimiento SRI integral

## Correcciones principales
- Corrige `dirEstablecimiento` con cascada punto -> establecimiento -> matriz.
- Bloquea antes de firmar cualquier XML con dirección de establecimiento vacía.
- Valida RUC emisor y RUC Proveedor de 13 dígitos.
- Valida establecimiento y punto de emisión de 3 dígitos.
- Valida límites SRI de razón social/direcciones (300), códigoPrincipal (25), descripción (300).
- Valida `claveAcceso` de 49 dígitos en el XML.
- Garantiza exactamente un `RUC Proveedor` en `infoAdicional`.
- Respeta máximo 15 `campoAdicional` y no duplica el RUC del proveedor.
- Preflight de factura antes de construir XML: fecha, identificación, totales, detalles, cantidades, precios y pagos.
- Mantiene firma XAdES-BES, transmisión y consulta de autorización SRI.
- Mantiene validación XSD local opcional con `VALIDAR_XSD_LOCAL=true`; por defecto no depende de XSD empaquetado antiguo para decidir la transmisión.
- Conserva Resend, XML/RIDE, almacenamiento, contabilidad automática y toda la funcionalidad ERP.

## SQL
Ejecutar una vez `sql/migracion_v9979_cumplimiento_sri.sql` en Supabase para reparar puntos de emisión históricos.

## Base técnica
La implementación se alinea con la Ficha Técnica Off-line vigente publicada por SRI y con la resolución NAC-DGERCGC26-00000027 sobre RUC del proveedor en información adicional.
