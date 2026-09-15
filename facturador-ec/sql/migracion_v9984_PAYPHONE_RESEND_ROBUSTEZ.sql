-- CONTSERTRIB v9.9.84 — Robustez PayPhone + Resend
-- Aditiva. No elimina ni modifica datos existentes.
create index if not exists idx_pagos_saas_notificacion_cliente
  on public.pagos_solicitud_saas(notificacion_cliente_estado, updated_at desc);

create index if not exists idx_solicitudes_saas_notificacion_admin
  on public.solicitudes_registro_saas(notificacion_admin_estado, creado_at desc);

notify pgrst, 'reload schema';
