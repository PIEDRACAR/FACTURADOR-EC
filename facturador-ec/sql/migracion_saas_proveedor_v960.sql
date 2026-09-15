-- CONTSERTRIB v9.6.0
-- Panel maestro del proveedor + planes + suscripciones + pagos.
-- Ejecutar en Supabase SQL Editor.

create table if not exists planes_suscripcion (
  id uuid primary key default gen_random_uuid(),
  codigo varchar(40) not null unique,
  nombre varchar(100) not null,
  descripcion varchar(500),
  precio_mensual numeric(12,2) not null default 0,
  orden integer not null default 1,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint planes_suscripcion_precio_chk check (precio_mensual >= 0)
);

insert into planes_suscripcion (codigo, nombre, descripcion, precio_mensual, orden, activo)
values
  ('BASICO', 'Básico', 'Facturación electrónica para pequeños negocios.', 10.00, 1, true),
  ('PROFESIONAL', 'Profesional', 'Más usuarios, puntos de emisión y gestión administrativa.', 20.00, 2, true),
  ('EMPRESARIAL', 'Empresarial', 'Operación multiusuario y controles avanzados.', 35.00, 3, true)
on conflict (codigo) do update set
  nombre = excluded.nombre,
  descripcion = excluded.descripcion,
  precio_mensual = excluded.precio_mensual,
  orden = excluded.orden,
  activo = excluded.activo,
  updated_at = now();

create table if not exists suscripciones (
  id uuid primary key default gen_random_uuid(),
  emisor_id uuid not null references emisores(id) on delete cascade,
  plan_id uuid not null references planes_suscripcion(id),
  estado varchar(20) not null default 'activa',
  fecha_inicio date not null default current_date,
  proximo_vencimiento date not null default current_date + 30,
  fecha_cancelacion date,
  nota varchar(500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (emisor_id),
  constraint suscripciones_estado_chk check (estado in ('activa','pendiente','vencida','suspendida','cancelada'))
);
create index if not exists idx_suscripciones_estado_vencimiento on suscripciones(estado, proximo_vencimiento);
create index if not exists idx_suscripciones_emisor on suscripciones(emisor_id);

create table if not exists pagos_suscripcion (
  id uuid primary key default gen_random_uuid(),
  suscripcion_id uuid not null references suscripciones(id) on delete cascade,
  emisor_id uuid not null references emisores(id) on delete cascade,
  monto numeric(12,2) not null,
  fecha_pago date not null default current_date,
  periodo_desde date,
  periodo_hasta date,
  metodo varchar(50),
  referencia varchar(150),
  nota varchar(500),
  created_at timestamptz not null default now(),
  constraint pagos_suscripcion_monto_chk check (monto > 0)
);
create index if not exists idx_pagos_suscripcion_emisor_fecha on pagos_suscripcion(emisor_id, fecha_pago desc);

create table if not exists proveedores_admin (
  user_id uuid primary key references auth.users(id) on delete cascade,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

-- No se insertan usuarios aquí: la cuenta del proveedor pertenece a CONTSERTRIB.
-- Para el primer administrador se puede usar PROVEEDOR_ADMIN_EMAILS en Railway.
