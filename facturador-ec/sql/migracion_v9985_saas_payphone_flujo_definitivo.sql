-- CONTSERTRIB v9.9.86
-- No crea tablas nuevas. Refuerza índices para el flujo de solicitudes/pagos.
create index if not exists idx_solicitudes_saas_pago_estado_creado
  on public.solicitudes_registro_saas(pago_estado, creado_at desc);
create index if not exists idx_pagos_saas_solicitud_estado
  on public.pagos_solicitud_saas(solicitud_id, estado, updated_at desc);
notify pgrst, 'reload schema';

-- La promoción de 30 días deja de aplicarse a nuevos registros.
-- No modifica suscripciones/clientes existentes. ROOT puede crear otra promoción después.
update public.promociones_saas
set activa = false, dias_prueba = 0, aplicar_automaticamente = false, updated_at = now()
where codigo = 'TRIAL_PUBLICO';
