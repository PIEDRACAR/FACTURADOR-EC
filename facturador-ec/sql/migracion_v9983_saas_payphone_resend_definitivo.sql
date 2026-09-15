-- CONTSERTRIB v9.9.83 - SaaS / PayPhone / Resend robusto
-- Ejecutar una sola vez en Supabase.

create index if not exists idx_solicitudes_saas_pago_estado
  on solicitudes_registro_saas(pago_estado, creado_at desc);

create index if not exists idx_pagos_saas_activacion
  on pagos_solicitud_saas(estado, activacion_at);

alter table pagos_solicitud_saas add column if not exists activacion_at timestamptz;
alter table pagos_solicitud_saas add column if not exists activacion_detalle jsonb;

notify pgrst, 'reload schema';
