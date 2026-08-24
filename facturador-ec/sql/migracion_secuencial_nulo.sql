-- ============================================
-- MIGRACIÓN: secuencial nulo hasta el momento de la emisión
-- Ejecutar en el SQL Editor de Supabase (una sola vez).
--
-- POR QUÉ: el secuencial real de un comprobante lo asigna de forma
-- atómica `SupabaseSequenceProvider` (vía la función `increment_secuencial`)
-- en el momento exacto en que la librería arma y firma el XML — no antes.
-- Si se inventa un secuencial al crear la fila en estado 'generado' (como
-- se hizo a mano durante las primeras pruebas), ese número casi nunca
-- coincide con el que termina realmente en el comprobante autorizado, y
-- además puede chocar con el de otra venta simultánea.
--
-- Con esta migración, el comprobante se crea con secuencial en NULL, y
-- services/facturacion.ts lo completa con el valor real devuelto por el
-- SRI justo después de la emisión.
-- ============================================

alter table comprobantes
  alter column secuencial drop not null;
