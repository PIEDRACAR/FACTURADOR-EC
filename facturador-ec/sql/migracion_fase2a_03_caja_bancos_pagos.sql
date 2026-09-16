-- Fase 2A / Bloque B. ADITIVA. NO ejecutar automáticamente.
create table if not exists public.cuentas_bancarias (
  id uuid primary key default gen_random_uuid(),
  emisor_id uuid not null,
  nombre text not null,
  banco text,
  numero_mascara text,
  tipo text not null default 'CORRIENTE',
  moneda text not null default 'USD',
  cuenta_contable_id uuid not null references public.plan_cuentas_contables(id),
  activa boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_cuentas_bancarias_emisor on public.cuentas_bancarias(emisor_id, activa);

create table if not exists public.movimientos_bancarios (
  id uuid primary key default gen_random_uuid(),
  emisor_id uuid not null,
  cuenta_bancaria_id uuid not null references public.cuentas_bancarias(id),
  fecha date not null,
  tipo text not null check (tipo in ('INGRESO','EGRESO','TRANSFERENCIA')),
  referencia text,
  concepto text not null,
  monto numeric(14,2) not null check (monto > 0),
  tercero_tipo text,
  tercero_id uuid,
  origen_tipo text,
  origen_id uuid,
  idempotency_key text,
  estado_contable text not null default 'PENDIENTE' check (estado_contable in ('PENDIENTE','CONTABILIZADO','ERROR','REVERSADO')),
  asiento_id uuid references public.asientos_contables(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((tercero_tipo is null) = (tercero_id is null)),
  check ((origen_tipo is null) = (origen_id is null))
);
create unique index if not exists uq_mov_banco_idempotencia on public.movimientos_bancarios(emisor_id,idempotency_key) where idempotency_key is not null;
create index if not exists idx_mov_banco_emisor_fecha on public.movimientos_bancarios(emisor_id,fecha desc);
create index if not exists idx_mov_banco_estado on public.movimientos_bancarios(emisor_id,estado_contable);

alter table public.movimientos_caja add column if not exists emisor_id uuid;
alter table public.movimientos_caja add column if not exists estado_contable text default 'PENDIENTE';
alter table public.movimientos_caja add column if not exists asiento_id uuid references public.asientos_contables(id);
alter table public.movimientos_caja add column if not exists cuenta_contrapartida_id uuid references public.plan_cuentas_contables(id);
alter table public.movimientos_caja add column if not exists idempotency_key text;
create unique index if not exists uq_mov_caja_idempotencia on public.movimientos_caja(emisor_id,idempotency_key) where idempotency_key is not null;
create index if not exists idx_mov_caja_emisor_estado on public.movimientos_caja(emisor_id,estado_contable);

-- Las RPC de pago existentes se conservan. Una futura validación sandbox puede
-- envolver pago+saldo+evento en una única transacción sin reescribir históricos.
