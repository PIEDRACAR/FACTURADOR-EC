-- Centro profesional de notificaciones: lectura persistente por usuario y negocio.
create table if not exists notificaciones_leidas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  emisor_id uuid not null references emisores(id) on delete cascade,
  notificacion_key text not null,
  read_at timestamptz not null default now(),
  unique(user_id, emisor_id, notificacion_key)
);
create index if not exists idx_notificaciones_leidas_usuario on notificaciones_leidas(user_id, emisor_id, read_at desc);
