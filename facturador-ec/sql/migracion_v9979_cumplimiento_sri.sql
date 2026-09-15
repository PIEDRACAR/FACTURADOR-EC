-- CONTSERTRIB v9.9.79 — Integridad de direcciones SRI
-- No elimina historial. Repara datos existentes y deja detectables los pendientes.

UPDATE public.puntos_emision p
SET direccion = COALESCE(
  NULLIF(BTRIM(p.direccion), ''),
  NULLIF(BTRIM(e.direccion), ''),
  NULLIF(BTRIM(m.direccion_matriz), '')
)
FROM public.emisores m
LEFT JOIN public.establecimientos_emisor e
  ON e.emisor_id = m.id AND e.codigo = p.establecimiento
WHERE p.emisor_id = m.id
  AND COALESCE(BTRIM(p.direccion), '') = ''
  AND COALESCE(NULLIF(BTRIM(e.direccion), ''), NULLIF(BTRIM(m.direccion_matriz), '')) IS NOT NULL;

-- Actualiza puntos cuyo establecimiento sí tiene dirección y el punto no.
UPDATE public.puntos_emision p
SET direccion = BTRIM(e.direccion)
FROM public.establecimientos_emisor e
WHERE e.emisor_id = p.emisor_id
  AND e.codigo = p.establecimiento
  AND COALESCE(BTRIM(p.direccion), '') = ''
  AND COALESCE(BTRIM(e.direccion), '') <> '';

-- Reporte de datos que todavía requieren intervención manual.
SELECT p.id, p.emisor_id, p.establecimiento, p.punto_emision, p.direccion
FROM public.puntos_emision p
WHERE p.activo = true
  AND COALESCE(BTRIM(p.direccion), '') = ''
ORDER BY p.emisor_id, p.establecimiento, p.punto_emision;
