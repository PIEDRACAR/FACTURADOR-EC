# CONTSERTRIB v9.9.21 — Comprobantes SRI, correo, archivos y POS

- Todos los comprobantes SRI complementarios autorizados (nota de crédito, nota de débito, liquidación de compra, guía de remisión y retención) generan PDF profesional y permiten descargar XML firmado.
- Al autorizarse, se envían automáticamente PDF + XML al correo obligatorio del documento. El fallo del correo no revierte la autorización SRI y queda registrado en `email_estado` / `email_detalle`.
- Se habilita reenvío manual desde el historial de documentos.
- POS permite modificar precio unitario de catálogo y aplicar descuento por línea; el backend valida montos y registra auditoría cuando existe precio manual o descuento.
- Formas de pago muestran un campo de valor con ancho fijo y usable en escritorio/móvil.
- SQL: ejecutar `sql/migracion_contsertrib_v9921_comprobantes_sri_archivos_email.sql`.

Validación local realizada: JavaScript inline de todas las páginas HTML sin errores de sintaxis. El `tsc --noEmit` del entorno no puede completarse porque este paquete no contiene `node_modules`; por ello no se declara build/deploy en Railway validado.
