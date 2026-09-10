-- ============================================
-- MIGRACIÓN: sistema de sesiones (login / cerrar sesión)
-- Ejecutar en el SQL Editor de Supabase (una sola vez).
--
-- POR QUÉ una tabla propia de sesiones, en vez de usar el JWT de Supabase
-- Auth directamente en el navegador: el frontend de este sistema son
-- páginas HTML sueltas que ya hacen `fetch()` a nuestras propias rutas sin
-- ningún encabezado de autorización. Usar una cookie de sesión (que el
-- navegador manda sola en cada petición al mismo dominio) permite proteger
-- todas esas peticiones sin tener que reescribir cada `fetch()` existente
-- para adjuntar un token — el backend valida la cookie contra esta tabla.
-- ============================================

create table if not exists sesiones (
  token text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  creado_en timestamptz not null default now(),
  expira_en timestamptz not null,
  ultimo_uso timestamptz not null default now()
);

create index if not exists sesiones_user_id_idx on sesiones(user_id);

-- Índice para limpiar sesiones vencidas periódicamente (opcional, manual):
-- delete from sesiones where expira_en < now();
