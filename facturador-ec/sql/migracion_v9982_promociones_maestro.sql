-- CONTSERTRIB v9.9.82
-- Promociones comerciales SaaS administrables desde Panel Maestro ROOT.
-- ADITIVA: no elimina planes, clientes, suscripciones ni historial.

CREATE TABLE IF NOT EXISTS public.promociones_saas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo text NOT NULL UNIQUE,
  nombre text NOT NULL DEFAULT 'Promoción de prueba gratuita',
  activa boolean NOT NULL DEFAULT false,
  dias_prueba integer NOT NULL DEFAULT 0 CHECK (dias_prueba >= 0 AND dias_prueba <= 365),
  texto_publico text NOT NULL DEFAULT '',
  fecha_desde date,
  fecha_hasta date,
  aplicar_automaticamente boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT promociones_saas_fechas_chk CHECK (fecha_hasta IS NULL OR fecha_desde IS NULL OR fecha_hasta >= fecha_desde)
);

INSERT INTO public.promociones_saas
  (codigo,nombre,activa,dias_prueba,texto_publico,aplicar_automaticamente)
VALUES
  ('TRIAL_PUBLICO','Prueba gratuita',false,0,'',false)
ON CONFLICT (codigo) DO NOTHING;

-- La promoción queda DESACTIVADA inicialmente para eliminar la oferta de 30 días
-- sin borrar la configuración: ROOT podrá volver a activarla y editarla desde el panel.
