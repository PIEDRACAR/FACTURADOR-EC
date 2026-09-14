# CONTSERTRIB v9.9.77 — Corrección definitiva del bloqueo XSD

- Se elimina el bloqueo por XSD local por defecto.
- `validateXsd` del SDK permanece en `false`.
- `VALIDAR_XSD_LOCAL=true` queda disponible solo para diagnóstico.
- Por defecto: construir XML → insertar RUC Proveedor → firmar → transmitir al SRI.
- Si el SRI rechaza, se muestran sus códigos/mensajes reales.
- Se conserva la validación de negocio, límite de código de producto y UX v9.9.75.
- No requiere migración SQL.
