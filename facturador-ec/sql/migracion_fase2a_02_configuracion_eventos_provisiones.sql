-- CONTSERTRIB Bloque A: configuracion, eventos y provisiones contables.
-- Aditiva e idempotente. NO EJECUTAR sin validacion previa en sandbox.
begin;
create extension if not exists pgcrypto;
create extension if not exists btree_gist;

create table if not exists public.configuracion_cuentas_contables(
 id uuid primary key default gen_random_uuid(), emisor_id uuid not null references public.emisores(id) on delete cascade,
 clave text not null, cuenta_id uuid not null references public.plan_cuentas_contables(id) on delete restrict,
 vigente_desde date not null default date '1900-01-01', vigente_hasta date, metadatos jsonb not null default '{}'::jsonb,
 activa boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 constraint configuracion_vigencia_chk check(vigente_hasta is null or vigente_hasta>=vigente_desde)
);
create index if not exists idx_config_cuentas_emisor_clave_fecha on public.configuracion_cuentas_contables(emisor_id,clave,vigente_desde,vigente_hasta) where activa;

create table if not exists public.eventos_contabilizacion(
 id uuid primary key default gen_random_uuid(), emisor_id uuid not null references public.emisores(id) on delete cascade,
 tipo_evento text not null, entidad_tipo text not null, entidad_id uuid not null, version_evento integer not null default 1 check(version_evento>0),
 fecha_contable date not null, estado text not null default 'PENDIENTE', asiento_id uuid references public.asientos_contables(id) on delete restrict,
 configuracion_snapshot jsonb not null default '{}'::jsonb, error text, created_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 constraint eventos_estado_chk check(estado in('PENDIENTE','CONTABILIZANDO','CONTABILIZADO','ERROR','REVERSADO')),
 constraint eventos_identidad_uq unique(emisor_id,tipo_evento,entidad_tipo,entidad_id,version_evento)
);
create index if not exists idx_eventos_emisor_estado_fecha on public.eventos_contabilizacion(emisor_id,estado,fecha_contable);

create table if not exists public.provisiones_contables(
 id uuid primary key default gen_random_uuid(), emisor_id uuid not null references public.emisores(id) on delete cascade,
 periodo char(7) not null, tipo_provision text not null, origen_tipo text, origen_id uuid, regla_clave text not null,
 version_provision integer not null default 1 check(version_provision>0), importe numeric(18,2) not null check(importe>0),
 estado text not null default 'PENDIENTE', asiento_id uuid references public.asientos_contables(id) on delete restrict,
 reverso_asiento_id uuid references public.asientos_contables(id) on delete restrict, snapshot jsonb not null default '{}'::jsonb,
 error text, created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 constraint provisiones_periodo_chk check(periodo~'^[0-9]{4}-(0[1-9]|1[0-2])$'),
 constraint provisiones_origen_completo_chk check((origen_tipo is null and origen_id is null) or (origen_tipo is not null and origen_id is not null)),
 constraint provisiones_estado_chk check(estado in('PENDIENTE','CONTABILIZANDO','CONTABILIZADO','ERROR','REVERSADO'))
);
create index if not exists idx_provisiones_emisor_periodo on public.provisiones_contables(emisor_id,periodo,estado);

-- Diagnosticos defensivos: estas tablas son nuevas, pero una instalacion que ya
-- las tuviera con datos inconsistentes debe detenerse sin autocorrecciones.
do $$ declare n bigint; begin
 select count(*) into n from public.configuracion_cuentas_contables a join public.configuracion_cuentas_contables b
  on a.id<b.id and a.emisor_id=b.emisor_id and a.clave=b.clave and a.activa and b.activa
  and daterange(a.vigente_desde,coalesce(a.vigente_hasta,'infinity'::date),'[]') && daterange(b.vigente_desde,coalesce(b.vigente_hasta,'infinity'::date),'[]');
 if n>0 then raise exception 'fase2a02_configuraciones_solapadas:% par(es); auditar manualmente',n; end if;
 select count(*) into n from public.provisiones_contables where (origen_tipo is null)<>(origen_id is null);
 if n>0 then raise exception 'fase2a02_provisiones_origen_incompleto:% registro(s); auditar manualmente',n; end if;
 select count(*) into n from public.eventos_contabilizacion group by emisor_id,tipo_evento,entidad_tipo,entidad_id,version_evento having count(*)>1 limit 1;
 if coalesce(n,0)>1 then raise exception 'fase2a02_eventos_duplicados; auditar manualmente'; end if;
 select count(*) into n from public.provisiones_contables group by emisor_id,periodo,regla_clave,coalesce(origen_tipo,'GLOBAL'),coalesce(origen_id,'00000000-0000-0000-0000-000000000000'::uuid),version_provision having count(*)>1 limit 1;
 if coalesce(n,0)>1 then raise exception 'fase2a02_provisiones_duplicadas; auditar manualmente'; end if;
end $$;

do $$ begin
 if not exists(select 1 from pg_constraint where conname='config_cuenta_vigencia_no_solapada' and conrelid='public.configuracion_cuentas_contables'::regclass) then
  alter table public.configuracion_cuentas_contables add constraint config_cuenta_vigencia_no_solapada exclude using gist
   (emisor_id with =,clave with =,daterange(vigente_desde,coalesce(vigente_hasta,'infinity'::date),'[]') with &&) where (activa);
 end if;
end $$;
create unique index if not exists ux_evento_idempotente on public.eventos_contabilizacion(emisor_id,tipo_evento,entidad_tipo,entidad_id,version_evento);
create unique index if not exists ux_provision_idempotente on public.provisiones_contables
 (emisor_id,periodo,regla_clave,coalesce(origen_tipo,'GLOBAL'),coalesce(origen_id,'00000000-0000-0000-0000-000000000000'::uuid),version_provision);

create or replace function public.validar_integridad_multiempresa_contable_fase2a02() returns trigger language plpgsql as $$
begin
 if tg_table_name='configuracion_cuentas_contables' and not exists(select 1 from public.plan_cuentas_contables where id=new.cuenta_id and emisor_id=new.emisor_id and activa and acepta_movimientos) then
  raise exception 'cuenta_configurada_no_pertenece_emisor_o_no_es_movimiento';
 end if;
 if tg_table_name='eventos_contabilizacion' and new.asiento_id is not null and not exists(select 1 from public.asientos_contables where id=new.asiento_id and emisor_id=new.emisor_id) then
  raise exception 'asiento_evento_no_pertenece_emisor';
 end if;
 if tg_table_name='provisiones_contables' then
  if new.asiento_id is not null and not exists(select 1 from public.asientos_contables where id=new.asiento_id and emisor_id=new.emisor_id) then raise exception 'asiento_provision_no_pertenece_emisor'; end if;
  if new.reverso_asiento_id is not null and not exists(select 1 from public.asientos_contables where id=new.reverso_asiento_id and emisor_id=new.emisor_id) then raise exception 'reverso_provision_no_pertenece_emisor'; end if;
 end if;
 return new;
end $$;
do $$ begin
 if not exists(select 1 from pg_trigger where tgname='trg_config_cuenta_multiempresa_fase2a02') then create trigger trg_config_cuenta_multiempresa_fase2a02 before insert or update on public.configuracion_cuentas_contables for each row execute function public.validar_integridad_multiempresa_contable_fase2a02(); end if;
 if not exists(select 1 from pg_trigger where tgname='trg_evento_multiempresa_fase2a02') then create trigger trg_evento_multiempresa_fase2a02 before insert or update on public.eventos_contabilizacion for each row execute function public.validar_integridad_multiempresa_contable_fase2a02(); end if;
 if not exists(select 1 from pg_trigger where tgname='trg_provision_multiempresa_fase2a02') then create trigger trg_provision_multiempresa_fase2a02 before insert or update on public.provisiones_contables for each row execute function public.validar_integridad_multiempresa_contable_fase2a02(); end if;
end $$;

insert into public.control_migraciones(version,detalle) values('fase2a.02','Configuracion de cuentas por vigencia, eventos idempotentes y provisiones trazables.')
on conflict(version) do update set detalle=excluded.detalle;
notify pgrst,'reload schema';
commit;
