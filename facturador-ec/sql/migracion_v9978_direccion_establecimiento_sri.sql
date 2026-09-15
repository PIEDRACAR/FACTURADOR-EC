-- CONTSERTRIB v9.9.78
-- Corrige puntos de emisión históricos con dirección vacía.
-- Cascada: punto_emision -> establecimiento_emisor -> direccion_matriz.
-- No elimina ni modifica comprobantes históricos.

UPDATE public.puntos_emision p
SET direccion = COALESCE(
  NULLIF(BTRIM(p.direccion), ''),
  NULLIF(BTRIM(e.direccion), ''),
  NULLIF(BTRIM(m.direccion_matriz), '')
)
FROM public.emisores m
LEFT JOIN public.establecimientos_emisor e
  ON e.emisor_id = m.id
 AND e.codigo = p.establecimiento
WHERE p.emisor_id = m.id
  AND COALESCE(BTRIM(p.direccion), '') = ''
  AND COALESCE(BTRIM(e.direccion), BTRIM(m.direccion_matriz), '') <> '';

-- Detecta registros que todavía impedirían una emisión SRI.
-- No falla la migración: solo deja constancia mediante una consulta final.
SELECT p.id, p.emisor_id, p.establecimiento, p.punto_emision, p.direccion
FROM public.puntos_emision p
WHERE p.activo = true
  AND COALESCE(BTRIM(p.direccion), '') = ''
ORDER BY p.emisor_id, p.establecimiento, p.punto_emision;
