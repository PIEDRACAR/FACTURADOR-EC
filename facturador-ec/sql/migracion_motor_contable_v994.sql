-- CONTSERTRIB v9.9.4 — Motor Contable Automático
-- Esta migración es ADITIVA. No elimina ni modifica tablas existentes.
-- Debe ejecutarse después de las migraciones actuales.

create table if not exists plan_cuentas_contables (
  id uuid primary key default gen_random_uuid(),
  emisor_id uuid not null references emisores(id) on delete cascade,
  codigo varchar(30) not null,
  nombre varchar(180) not null,
  nivel integer not null default 1 check (nivel between 1 and 8),
  tipo varchar(20) not null check (tipo in ('ACTIVO','PASIVO','PATRIMONIO','INGRESO','COSTO','GASTO')),
  naturaleza varchar(10) not null check (naturaleza in ('DEUDORA','ACREEDORA')),
  acepta_movimientos boolean not null default true,
  activa boolean not null default true,
  cuenta_padre_id uuid references plan_cuentas_contables(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(emisor_id,codigo)
);
create index if not exists idx_plan_cuentas_emisor on plan_cuentas_contables(emisor_id,activo,codigo);

create table if not exists asientos_contables (
  id uuid primary key default gen_random_uuid(),
  emisor_id uuid not null references emisores(id) on delete cascade,
  fecha date not null,
  tipo varchar(30) not null,
  concepto varchar(500) not null,
  referencia varchar(120),
  origen_tipo varchar(40),
  origen_id uuid,
  estado varchar(20) not null default 'CONTABILIZADO' check (estado in ('BORRADOR','CONTABILIZADO','ANULADO')),
  total_debe numeric(14,2) not null default 0,
  total_haber numeric(14,2) not null default 0,
  diferencia numeric(14,2) not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(emisor_id,origen_tipo,origen_id)
);
create index if not exists idx_asientos_emisor_fecha on asientos_contables(emisor_id,fecha desc);
create index if not exists idx_asientos_origen on asientos_contables(origen_tipo,origen_id);

create table if not exists asiento_lineas_contables (
  id uuid primary key default gen_random_uuid(),
  asiento_id uuid not null references asientos_contables(id) on delete cascade,
  cuenta_id uuid not null references plan_cuentas_contables(id) on delete restrict,
  descripcion varchar(300),
  debe numeric(14,2) not null default 0 check (debe >= 0),
  haber numeric(14,2) not null default 0 check (haber >= 0),
  tercero_tipo varchar(20),
  tercero_id uuid,
  created_at timestamptz not null default now(),
  check ((debe > 0 and haber = 0) or (haber > 0 and debe = 0) or (debe = 0 and haber = 0))
);
create index if not exists idx_asiento_lineas_asiento on asiento_lineas_contables(asiento_id);
create index if not exists idx_asiento_lineas_cuenta on asiento_lineas_contables(cuenta_id);

create table if not exists reglas_clasificacion_contable (
  id uuid primary key default gen_random_uuid(),
  emisor_id uuid not null references emisores(id) on delete cascade,
  tipo varchar(20) not null check (tipo in ('PROVEEDOR','CLIENTE','PALABRA_CLAVE','CATEGORIA_SRI','PRODUCTO')),
  clave varchar(200) not null,
  cuenta_id uuid not null references plan_cuentas_contables(id) on delete restrict,
  prioridad integer not null default 100,
  activa boolean not null default true,
  created_at timestamptz not null default now(),
  unique(emisor_id,tipo,clave)
);

create table if not exists periodos_contables (
  id uuid primary key default gen_random_uuid(),
  emisor_id uuid not null references emisores(id) on delete cascade,
  periodo char(7) not null,
  estado varchar(15) not null default 'ABIERTO' check (estado in ('ABIERTO','CERRADO')),
  cerrado_por uuid references auth.users(id) on delete set null,
  cerrado_at timestamptz,
  created_at timestamptz not null default now(),
  unique(emisor_id,periodo)
);

create table if not exists activos_fijos_contables (
  id uuid primary key default gen_random_uuid(),
  emisor_id uuid not null references emisores(id) on delete cascade,
  codigo varchar(50) not null,
  nombre varchar(200) not null,
  fecha_adquisicion date not null,
  costo numeric(14,2) not null default 0,
  valor_residual numeric(14,2) not null default 0,
  vida_util_meses integer,
  tasa_fiscal numeric(7,4),
  tasa_contable numeric(7,4),
  cuenta_activo_id uuid references plan_cuentas_contables(id),
  cuenta_depreciacion_id uuid references plan_cuentas_contables(id),
  cuenta_depreciacion_acumulada_id uuid references plan_cuentas_contables(id),
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  unique(emisor_id,codigo)
);

-- Valores fiscales 2026 usados por el motor: la tarifa general publicada por SRI es 13%.
-- 5% corresponde a materiales de construcción; 0% sigue vigente para operaciones aplicables.
-- Las tarifas históricas se conservan en comprobante_impuestos y no se recalculan.
comment on table plan_cuentas_contables is 'Plan contable por empresa para automatización y estados financieros.';
comment on table asientos_contables is 'Libro diario automático/manual con trazabilidad al documento origen.';
