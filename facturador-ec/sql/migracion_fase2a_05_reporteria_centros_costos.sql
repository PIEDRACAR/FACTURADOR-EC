begin;

-- Bloque E: dimensión analítica y presentación financiera.
-- ADITIVA / REEJECUTABLE. NO ejecutar automáticamente.

-- centros_costo nace en la migración 04 de Nómina. Aquí se amplía de forma
-- compatible para instalaciones existentes y para instalaciones desde cero.
create table if not exists public.centros_costo(
  id uuid primary key default gen_random_uuid(),
  emisor_id uuid not null references public.emisores(id) on delete restrict,
  codigo text not null,
  nombre text not null,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(emisor_id,codigo)
);
alter table public.centros_costo add column if not exists padre_id uuid references public.centros_costo(id) on delete restrict;
alter table public.centros_costo add column if not exists vigente_desde date not null default current_date;
alter table public.centros_costo add column if not exists vigente_hasta date;
do $$
begin
  if not exists(select 1 from pg_constraint where conname='centros_costo_vigencia_chk' and conrelid='public.centros_costo'::regclass) then
    alter table public.centros_costo add constraint centros_costo_vigencia_chk check(vigente_hasta is null or vigente_hasta>=vigente_desde);
  end if;
end $$;
create index if not exists idx_centros_costo_emisor_activo on public.centros_costo(emisor_id,activo,codigo);

-- El modelo real usa una sola dimensión de centro por línea; no se crea una
-- tabla de distribución que introduciría una cardinalidad distinta.
alter table public.asiento_lineas_contables
  add column if not exists centro_costo_id uuid references public.centros_costo(id) on delete restrict;
create index if not exists idx_lineas_centro_costo on public.asiento_lineas_contables(centro_costo_id,cuenta_id);

create table if not exists public.mapeos_estados_financieros(
  id uuid primary key default gen_random_uuid(),
  emisor_id uuid not null references public.emisores(id) on delete restrict,
  estado_tipo text not null check(estado_tipo in('SITUACION','RESULTADOS','PATRIMONIO')),
  rubro_codigo text not null,
  rubro_nombre text not null,
  cuenta_id uuid references public.plan_cuentas_contables(id) on delete restrict,
  patron_codigo text,
  orden integer not null default 0,
  signo_presentacion smallint not null default 1 check(signo_presentacion in(-1,1)),
  padre_rubro text,
  vigente_desde date not null default current_date,
  vigente_hasta date,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  check((cuenta_id is not null) <> (patron_codigo is not null)),
  check(vigente_hasta is null or vigente_hasta>=vigente_desde)
);
create index if not exists idx_mapeos_estado_emisor_vigencia on public.mapeos_estados_financieros(emisor_id,estado_tipo,activo,vigente_desde,vigente_hasta);
create unique index if not exists uq_mapeo_estado_cuenta_vigencia
  on public.mapeos_estados_financieros(emisor_id,estado_tipo,rubro_codigo,cuenta_id,vigente_desde)
  where cuenta_id is not null;
create unique index if not exists uq_mapeo_estado_patron_vigencia
  on public.mapeos_estados_financieros(emisor_id,estado_tipo,rubro_codigo,patron_codigo,vigente_desde)
  where patron_codigo is not null;

create table if not exists public.mapeos_flujo_efectivo(
  id uuid primary key default gen_random_uuid(),
  emisor_id uuid not null references public.emisores(id) on delete restrict,
  cuenta_id uuid references public.plan_cuentas_contables(id) on delete restrict,
  patron_codigo text,
  actividad text not null check(actividad in('OPERACION','INVERSION','FINANCIAMIENTO')),
  rubro text not null,
  es_efectivo_equivalente boolean not null default false,
  signo_presentacion smallint not null default 1 check(signo_presentacion in(-1,1)),
  vigente_desde date not null default current_date,
  vigente_hasta date,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  check((cuenta_id is not null) <> (patron_codigo is not null)),
  check(vigente_hasta is null or vigente_hasta>=vigente_desde)
);
create index if not exists idx_mapeos_flujo_emisor_vigencia on public.mapeos_flujo_efectivo(emisor_id,actividad,activo,vigente_desde,vigente_hasta);

-- Diagnóstico: una línea jamás puede apuntar a un centro de otra empresa.
do $$
begin
  if exists(
    select 1
    from public.asiento_lineas_contables l
    join public.asientos_contables a on a.id=l.asiento_id
    join public.centros_costo c on c.id=l.centro_costo_id
    where c.emisor_id<>a.emisor_id
  ) then
    raise exception 'Existen líneas con centro de costo perteneciente a otra empresa; corregir antes de continuar.';
  end if;
end $$;

commit;
