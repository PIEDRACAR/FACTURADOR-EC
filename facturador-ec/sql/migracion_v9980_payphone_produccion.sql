-- CONTSERTRIB v9.9.80 - PayPhone Production Hardening
-- Idempotencia y trazabilidad del webhook. No elimina historial.
create unique index if not exists uq_pago_payphone_transaction_id
  on pagos_solicitud_saas(transaction_id)
  where transaction_id is not null and transaction_id <> '';

create index if not exists idx_pago_payphone_client_tx_estado
  on pagos_solicitud_saas(client_transaction_id, estado);

alter table pagos_solicitud_saas add column if not exists activacion_at timestamptz;
alter table pagos_solicitud_saas add column if not exists activacion_detalle jsonb;

notify pgrst, 'reload schema';
