begin;

-- Bloque C: nómina, aprobación, snapshots, contabilización y pagos.
-- Migración aditiva; NO ejecutar automáticamente.

-- Integrado desde migracion_fase2a_05_nomina_parametros_contratos.sql
create extension if not exists pgcrypto;
create extension if not exists btree_gist;

create table if not exists centros_costo(id uuid primary key default gen_random_uuid(),emisor_id uuid not null references emisores(id) on delete restrict,codigo text not null,nombre text not null,activo boolean not null default true,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(emisor_id,codigo));
create table if not exists nomina_contratos(id uuid primary key default gen_random_uuid(),emisor_id uuid not null references emisores(id) on delete restrict,empleado_id uuid not null references nomina_empleados(id) on delete restrict,tipo_contrato text not null,cargo text,jornada text,fecha_desde date not null,fecha_hasta date,centro_costo_id uuid references centros_costo(id) on delete restrict,cuenta_bancaria text,estado text not null default 'ACTIVO',snapshot jsonb not null default '{}'::jsonb,created_by uuid,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),check(fecha_hasta is null or fecha_hasta>=fecha_desde));
create table if not exists nomina_historial_salarial(id uuid primary key default gen_random_uuid(),emisor_id uuid not null references emisores(id) on delete restrict,empleado_id uuid not null references nomina_empleados(id) on delete restrict,valor numeric(14,2) not null check(valor>=0),vigencia_desde date not null,vigencia_hasta date,motivo text,created_by uuid,created_at timestamptz not null default now(),check(vigencia_hasta is null or vigencia_hasta>=vigencia_desde));
create table if not exists nomina_parametros(id uuid primary key default gen_random_uuid(),emisor_id uuid references emisores(id) on delete restrict,codigo text not null,nombre text not null,valor numeric(18,6) not null,tipo text not null,vigencia_desde date not null,vigencia_hasta date,fuente text,observacion text,activo boolean not null default true,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),check(vigencia_hasta is null or vigencia_hasta>=vigencia_desde));

do $$ begin
 if exists(select 1 from nomina_parametros a join nomina_parametros b on a.id<b.id and a.codigo=b.codigo and coalesce(a.emisor_id,'00000000-0000-0000-0000-000000000000')=coalesce(b.emisor_id,'00000000-0000-0000-0000-000000000000') and a.activo and b.activo and daterange(a.vigencia_desde,coalesce(a.vigencia_hasta,'infinity'::date),'[]')&&daterange(b.vigencia_desde,coalesce(b.vigencia_hasta,'infinity'::date),'[]')) then raise exception 'NOMINA_FASE2A05: parámetros vigentes solapados; corrija manualmente antes de aplicar.'; end if;
end $$;
create unique index if not exists ux_nomina_parametro_inicio on nomina_parametros(coalesce(emisor_id,'00000000-0000-0000-0000-000000000000'::uuid),codigo,vigencia_desde) where activo;
create index if not exists idx_nomina_contratos_empleado on nomina_contratos(emisor_id,empleado_id,fecha_desde);
create index if not exists idx_nomina_salarios_empleado on nomina_historial_salarial(emisor_id,empleado_id,vigencia_desde);
insert into control_migraciones(version,detalle) values('fase2a.05','Nómina: parámetros por vigencia, contratos, salarios y centros de costo.') on conflict(version) do update set detalle=excluded.detalle;

-- Integrado desde migracion_fase2a_06_nomina_rubros_novedades.sql
create table if not exists nomina_rubros(id uuid primary key default gen_random_uuid(),emisor_id uuid references emisores(id) on delete restrict,codigo text not null,nombre text not null,tipo text not null check(tipo in('INGRESO','DESCUENTO','PROVISION','APORTE')),modalidad text not null check(modalidad in('FIJO','VARIABLE','FORMULA')),formula text,metodo_calculo text,afecta_iess boolean not null default false,afecta_beneficios boolean not null default false,cuenta_debito_clave text,cuenta_credito_clave text,centro_costo_id uuid references centros_costo(id) on delete restrict,vigencia_desde date not null,vigencia_hasta date,activo boolean not null default true,metadatos jsonb not null default '{}'::jsonb,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),check(vigencia_hasta is null or vigencia_hasta>=vigencia_desde));
create table if not exists nomina_novedades(id uuid primary key default gen_random_uuid(),emisor_id uuid not null references emisores(id) on delete restrict,empleado_id uuid not null references nomina_empleados(id) on delete restrict,periodo char(7) not null,rubro_id uuid references nomina_rubros(id) on delete restrict,tipo text not null,cantidad numeric(14,4),valor numeric(14,2) not null default 0 check(valor>=0),fecha date,descripcion text,centro_costo_id uuid references centros_costo(id) on delete restrict,idempotencia_clave text not null,estado text not null default 'REGISTRADA',snapshot jsonb not null default '{}'::jsonb,created_by uuid,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(emisor_id,idempotencia_clave));
create table if not exists nomina_prestamos(id uuid primary key default gen_random_uuid(),emisor_id uuid not null references emisores(id) on delete restrict,empleado_id uuid not null references nomina_empleados(id) on delete restrict,fecha date not null,monto numeric(14,2) not null check(monto>0),saldo numeric(14,2) not null check(saldo>=0),numero_cuotas integer not null check(numero_cuotas>0),estado text not null default 'VIGENTE',referencia text,created_by uuid,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table if not exists nomina_prestamo_cuotas(id uuid primary key default gen_random_uuid(),emisor_id uuid not null references emisores(id) on delete restrict,prestamo_id uuid not null references nomina_prestamos(id) on delete restrict,periodo char(7) not null,numero integer not null,monto numeric(14,2) not null check(monto>0),estado text not null default 'PENDIENTE',novedad_id uuid references nomina_novedades(id) on delete restrict,created_at timestamptz not null default now(),unique(prestamo_id,numero),unique(prestamo_id,periodo));
create index if not exists idx_nomina_novedades_periodo on nomina_novedades(emisor_id,periodo,empleado_id,estado);
insert into control_migraciones(version,detalle) values('fase2a.06','Nómina: catálogo de rubros, novedades, anticipos y préstamos.') on conflict(version) do update set detalle=excluded.detalle;

-- Integrado desde migracion_fase2a_07_nomina_roles_historicos.sql
alter table nomina_periodos add column if not exists parametros_snapshot jsonb not null default '{}'::jsonb;
alter table nomina_periodos add column if not exists configuracion_snapshot jsonb not null default '{}'::jsonb;
alter table nomina_periodos add column if not exists total_nomina numeric(14,2) not null default 0;
alter table nomina_periodos add column if not exists total_pagado numeric(14,2) not null default 0;
alter table nomina_periodos add column if not exists saldo_pendiente numeric(14,2) not null default 0;
alter table nomina_periodos add column if not exists revisado_por uuid;
alter table nomina_periodos add column if not exists revisado_at timestamptz;
alter table nomina_periodos add column if not exists aprobado_por uuid;
alter table nomina_periodos add column if not exists aprobado_at timestamptz;
alter table nomina_periodos add column if not exists contabilizado_at timestamptz;
alter table nomina_periodos add column if not exists cerrado_at timestamptz;
alter table nomina_detalles add column if not exists rubros_snapshot jsonb not null default '[]'::jsonb;
alter table nomina_detalles add column if not exists parametros_snapshot jsonb not null default '{}'::jsonb;
alter table nomina_detalles add column if not exists empleado_snapshot jsonb not null default '{}'::jsonb;
alter table nomina_detalles add column if not exists centro_costo_id uuid references centros_costo(id) on delete restrict;
alter table nomina_detalles add column if not exists total_ingresos numeric(14,2) not null default 0;
alter table nomina_detalles add column if not exists total_descuentos numeric(14,2) not null default 0;
alter table nomina_detalles add column if not exists saldo_pendiente numeric(14,2) not null default 0;
create table if not exists nomina_aprobaciones(id uuid primary key default gen_random_uuid(),emisor_id uuid not null references emisores(id) on delete restrict,periodo_id uuid not null references nomina_periodos(id) on delete restrict,estado_anterior text not null,estado_nuevo text not null,observacion text,usuario_id uuid,created_at timestamptz not null default now());
create table if not exists nomina_auditoria(id uuid primary key default gen_random_uuid(),emisor_id uuid not null references emisores(id) on delete restrict,entidad_tipo text not null,entidad_id uuid not null,accion text not null,antes jsonb,despues jsonb,usuario_id uuid,created_at timestamptz not null default now());
create table if not exists nomina_provisiones(id uuid primary key default gen_random_uuid(),emisor_id uuid not null references emisores(id) on delete restrict,periodo_id uuid not null references nomina_periodos(id) on delete restrict,empleado_id uuid not null references nomina_empleados(id) on delete restrict,rubro_codigo text not null,saldo_inicial numeric(14,2) not null default 0,provision_periodo numeric(14,2) not null default 0,utilizado numeric(14,2) not null default 0,saldo_final numeric(14,2) generated always as (saldo_inicial+provision_periodo-utilizado) stored,snapshot jsonb not null default '{}'::jsonb,asiento_id uuid references asientos_contables(id) on delete restrict,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(periodo_id,empleado_id,rubro_codigo));
do $$ begin if exists(select 1 from nomina_periodos where estado not in('ABIERTO','BORRADOR','CALCULADO','REVISADO','APROBADO','CONTABILIZADO','PAGADO','CERRADO')) then raise exception 'NOMINA_FASE2A07: existen estados históricos no reconocidos; revise antes de aplicar la restricción.'; end if; end $$;
insert into control_migraciones(version,detalle) values('fase2a.07','Nómina: roles históricos, snapshots, provisiones, aprobaciones y auditoría.') on conflict(version) do update set detalle=excluded.detalle;

-- Integrado desde migracion_fase2a_08_nomina_pagos_liquidaciones.sql
alter table nomina_pagos add column if not exists idempotencia_clave text;
alter table nomina_pagos add column if not exists cuenta_contable_id uuid references plan_cuentas_contables(id) on delete restrict;
alter table nomina_pagos add column if not exists observacion text;
alter table nomina_pagos add column if not exists saldo_anterior numeric(14,2);
alter table nomina_pagos add column if not exists saldo_posterior numeric(14,2);
alter table nomina_pagos add column if not exists created_by uuid;
alter table nomina_pagos add column if not exists updated_at timestamptz not null default now();
alter table nomina_pagos add column if not exists estado text not null default 'REGISTRADO';
alter table nomina_pagos add column if not exists reverso_asiento_id uuid references asientos_contables(id) on delete restrict;
do $$ begin if exists(select 1 from nomina_pagos where idempotencia_clave is not null group by emisor_id,idempotencia_clave having count(*)>1) then raise exception 'NOMINA_FASE2A08: pagos históricos con clave de idempotencia duplicada.'; end if; end $$;
create unique index if not exists ux_nomina_pago_idempotencia on nomina_pagos(emisor_id,idempotencia_clave) where idempotencia_clave is not null;
create table if not exists nomina_vacaciones(id uuid primary key default gen_random_uuid(),emisor_id uuid not null references emisores(id) on delete restrict,empleado_id uuid not null references nomina_empleados(id) on delete restrict,fecha_desde date not null,fecha_hasta date not null,dias numeric(8,2) not null check(dias>0),estado text not null default 'SOLICITADA',valor_utilizado numeric(14,2) not null default 0,periodo_id uuid references nomina_periodos(id) on delete restrict,created_by uuid,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),check(fecha_hasta>=fecha_desde));
create table if not exists nomina_liquidaciones(id uuid primary key default gen_random_uuid(),emisor_id uuid not null references emisores(id) on delete restrict,empleado_id uuid not null references nomina_empleados(id) on delete restrict,contrato_id uuid references nomina_contratos(id) on delete restrict,fecha_salida date not null,motivo text not null,estado text not null default 'BORRADOR',rubros_snapshot jsonb not null default '[]'::jsonb,parametros_snapshot jsonb not null default '{}'::jsonb,total_ingresos numeric(14,2) not null default 0,total_descuentos numeric(14,2) not null default 0,neto_pagar numeric(14,2) not null default 0,asiento_id uuid references asientos_contables(id) on delete restrict,created_by uuid,aprobado_por uuid,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create index if not exists idx_nomina_pagos_periodo on nomina_pagos(emisor_id,periodo_id,fecha_pago);
insert into control_migraciones(version,detalle) values('fase2a.08','Nómina: pagos idempotentes, vacaciones y liquidaciones.') on conflict(version) do update set detalle=excluded.detalle;

commit;
