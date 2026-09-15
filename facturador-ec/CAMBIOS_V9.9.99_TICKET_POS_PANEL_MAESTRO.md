# CONTSERTRIB v9.9.99 — Ticket/POS administrable desde Panel Maestro

- Agrega `configuracion_proveedor.ticket_pos_habilitado` para control global ROOT.
- Agrega `planes_suscripcion.incluye_ticket_pos` para control por plan.
- El endpoint `/pos/venta` valida ambos controles en backend cuando `modo=ticket`.
- Panel Maestro permite activar/desactivar Ticket/POS globalmente y por cada plan.
- Facturación electrónica permanece intacta.
- No elimina datos ni comprobantes históricos.
