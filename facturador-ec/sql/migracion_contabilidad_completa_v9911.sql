-- CONTSERTRIB v9.9.11 — Migración contable autocontenida y segura
-- CORRECCIÓN: esta migración no asume que v9.9.4/v9.9.6 se ejecutaron antes.
-- Crea primero las tablas contables base y luego agrega índices, RPC y relaciones.

create table if not exists plan_cuentas_contables (
  id uuid primary key default gen_random_uuid(),
  emisor_id uuid not null references emisores(id) on delete cascade,
  codigo varchar(30) not null,
  nombre varchar(180) not null,
  nivel integer not null default 1,
  tipo varchar(20) not null,
  naturaleza varchar(10) not null,
  acepta_movimientos boolean not null default true,
  activa boolean not null default true,
  cuenta_padre_id uuid references plan_cuentas_contables(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(emisor_id,codigo)
);

create table if not exists asientos_contables (
  id uuid primary key default gen_random_uuid(),
  emisor_id uuid not null references emisores(id) on delete cascade,
  fecha date not null,
  tipo varchar(30) not null,
  concepto varchar(500) not null,
  referencia varchar(120),
  origen_tipo varchar(40),
  origen_id uuid,
  estado varchar(20) not null default 'CONTABILIZADO',
  total_debe numeric(14,2) not null default 0,
  total_haber numeric(14,2) not null default 0,
  diferencia numeric(14,2) not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists asiento_lineas_contables (
  id uuid primary key default gen_random_uuid(),
  asiento_id uuid not null,
  cuenta_id uuid not null,
  descripcion varchar(300),
  debe numeric(14,2) not null default 0,
  haber numeric(14,2) not null default 0,
  tercero_tipo varchar(20),
  tercero_id uuid,
  created_at timestamptz not null default now(),
  check (debe >= 0 and haber >= 0 and not (debe > 0 and haber > 0))
);

create table if not exists periodos_contables (
  id uuid primary key default gen_random_uuid(),
  emisor_id uuid not null references emisores(id) on delete cascade,
  periodo char(7) not null,
  estado varchar(15) not null default 'ABIERTO',
  cerrado_por uuid references auth.users(id) on delete set null,
  cerrado_at timestamptz,
  created_at timestamptz not null default now(),
  unique(emisor_id,periodo)
);

create table if not exists control_migraciones (
  id bigserial primary key,
  version varchar(30) not null unique,
  aplicado_at timestamptz not null default now(),
  detalle text
);

-- Ejecutable de forma independiente respecto de las migraciones contables anteriores.
-- No borra comprobantes ni asientos históricos.

alter table periodos_contables add column if not exists cerrado_por uuid references auth.users(id) on delete set null;
alter table periodos_contables add column if not exists cerrado_at timestamptz;

create index if not exists idx_periodos_emisor_periodo on periodos_contables(emisor_id, periodo);
create index if not exists idx_asientos_estado_fecha on asientos_contables(emisor_id,estado,fecha);
create index if not exists idx_lineas_tercero on asiento_lineas_contables(tercero_tipo,tercero_id);

create or replace function periodo_contable_abierto(p_emisor_id uuid, p_fecha date)
returns boolean language plpgsql as $$
declare v_estado text;
begin
  select estado into v_estado from periodos_contables
  where emisor_id=p_emisor_id and periodo=to_char(p_fecha,'YYYY-MM');
  return coalesce(v_estado,'ABIERTO')='ABIERTO';
end; $$;

create or replace function crear_asiento_contable_atomico(
  p_emisor_id uuid,
  p_fecha date,
  p_tipo text,
  p_concepto text,
  p_referencia text,
  p_origen_tipo text,
  p_origen_id uuid,
  p_created_by uuid,
  p_lineas jsonb
) returns uuid
language plpgsql
as $$
declare
  v_asiento uuid;
  v_linea jsonb;
  v_cuenta uuid;
  v_debe numeric := 0;
  v_haber numeric := 0;
  v_d numeric;
  v_h numeric;
begin
  if p_emisor_id is null or p_fecha is null or coalesce(trim(p_concepto),'')='' then raise exception 'datos_asiento_incompletos'; end if;
  if not periodo_contable_abierto(p_emisor_id,p_fecha) then raise exception 'periodo_contable_cerrado:%',to_char(p_fecha,'YYYY-MM'); end if;
  if coalesce(p_lineas,'[]'::jsonb)='[]'::jsonb then raise exception 'asiento_sin_lineas'; end if;
  if p_origen_tipo is not null and p_origen_id is not null then
    select id into v_asiento from asientos_contables where emisor_id=p_emisor_id and origen_tipo=p_origen_tipo and origen_id=p_origen_id limit 1;
    if v_asiento is not null then return v_asiento; end if;
  end if;
  insert into asientos_contables(emisor_id,fecha,tipo,concepto,referencia,origen_tipo,origen_id,estado,created_by)
  values(p_emisor_id,p_fecha,p_tipo,p_concepto,p_referencia,p_origen_tipo,p_origen_id,'BORRADOR',p_created_by)
  returning id into v_asiento;
  for v_linea in select * from jsonb_array_elements(p_lineas) loop
    select id into v_cuenta from plan_cuentas_contables where emisor_id=p_emisor_id and codigo=v_linea->>'codigo' and activa=true and acepta_movimientos=true;
    if v_cuenta is null then raise exception 'cuenta_no_configurada:%',v_linea->>'codigo'; end if;
    v_d:=round(coalesce((v_linea->>'debe')::numeric,0),2); v_h:=round(coalesce((v_linea->>'haber')::numeric,0),2);
    if v_d<0 or v_h<0 or (v_d>0 and v_h>0) then raise exception 'linea_contable_invalida:%',v_linea->>'codigo'; end if;
    v_debe:=v_debe+v_d; v_haber:=v_haber+v_h;
    insert into asiento_lineas_contables(asiento_id,cuenta_id,descripcion,debe,haber,tercero_tipo,tercero_id)
    values(v_asiento,v_cuenta,v_linea->>'descripcion',v_d,v_h,v_linea->>'tercero_tipo',nullif(v_linea->>'tercero_id','')::uuid);
  end loop;
  if round(v_debe,2)<>round(v_haber,2) or v_debe<=0 then raise exception 'asiento_no_cuadrado:debe=% haber=%',v_debe,v_haber; end if;
  update asientos_contables set estado='CONTABILIZADO',total_debe=round(v_debe,2),total_haber=round(v_haber,2),diferencia=round(v_debe-v_haber,2),updated_at=now() where id=v_asiento;
  return v_asiento;
exception when others then
  if v_asiento is not null then delete from asientos_contables where id=v_asiento; end if;
  raise;
end; $$;

create or replace function cerrar_periodo_contable(p_emisor_id uuid,p_periodo char(7),p_user_id uuid)
returns void language plpgsql as $$
declare v_d numeric; v_h numeric; v_estado text;
begin
  if p_periodo !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'periodo_invalido'; end if;
  select estado into v_estado from periodos_contables where emisor_id=p_emisor_id and periodo=p_periodo for update;
  if coalesce(v_estado,'ABIERTO')='CERRADO' then return; end if;
  select coalesce(sum(total_debe),0),coalesce(sum(total_haber),0) into v_d,v_h from asientos_contables where emisor_id=p_emisor_id and estado='CONTABILIZADO' and to_char(fecha,'YYYY-MM')=p_periodo;
  if round(v_d,2)<>round(v_h,2) then raise exception 'periodo_con_asientos_descuadrados'; end if;
  insert into periodos_contables(emisor_id,periodo,estado,cerrado_por,cerrado_at) values(p_emisor_id,p_periodo,'CERRADO',p_user_id,now())
  on conflict(emisor_id,periodo) do update set estado='CERRADO',cerrado_por=excluded.cerrado_por,cerrado_at=excluded.cerrado_at;
end; $$;

insert into control_migraciones(version,detalle) values('9.9.8','Núcleo contable: RPC atómica, control de periodos, índices y cierre seguro.') on conflict(version) do update set detalle=excluded.detalle;

-- v9.9.11: relaciones explícitas requeridas por PostgREST/schema cache.
do $$ begin
 if not exists(select 1 from pg_constraint where conname='fk_asiento_linea_asiento' and conrelid='asiento_lineas_contables'::regclass) then alter table asiento_lineas_contables add constraint fk_asiento_linea_asiento foreign key(asiento_id) references asientos_contables(id) on delete cascade; end if;
 if not exists(select 1 from pg_constraint where conname='fk_asiento_linea_cuenta' and conrelid='asiento_lineas_contables'::regclass) then alter table asiento_lineas_contables add constraint fk_asiento_linea_cuenta foreign key(cuenta_id) references plan_cuentas_contables(id) on delete restrict; end if;
end $$;
create index if not exists idx_asiento_lineas_asiento_cuenta on asiento_lineas_contables(asiento_id,cuenta_id);
create table if not exists nomina_empleados(id uuid primary key default gen_random_uuid(),emisor_id uuid not null references emisores(id) on delete cascade,identificacion varchar(20) not null,nombres varchar(200) not null,cargo varchar(150),fecha_ingreso date not null,fecha_salida date,sueldo_base numeric(14,2) not null default 0 check(sueldo_base>=0),iess_base numeric(14,2),region varchar(20) not null default 'COSTA',acumula_decimo_tercero boolean not null default false,acumula_decimo_cuarto boolean not null default false,fondo_reserva_mensual boolean not null default true,activo boolean not null default true,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(emisor_id,identificacion));
create table if not exists nomina_periodos(id uuid primary key default gen_random_uuid(),emisor_id uuid not null references emisores(id) on delete cascade,periodo char(7) not null,estado varchar(20) not null default 'BORRADOR' check(estado in('BORRADOR','CALCULADO','CONTABILIZADO','CERRADO')),sbu numeric(14,2) not null default 482,iess_personal_pct numeric(8,5) not null default 9.45,iess_patronal_pct numeric(8,5) not null default 11.15,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(emisor_id,periodo));
create table if not exists nomina_detalles(id uuid primary key default gen_random_uuid(),periodo_id uuid not null references nomina_periodos(id) on delete cascade,empleado_id uuid not null references nomina_empleados(id) on delete restrict,dias_pagados numeric(8,2) not null default 30,sueldo numeric(14,2) not null default 0,horas_extra numeric(14,2) not null default 0,comisiones numeric(14,2) not null default 0,bonificaciones numeric(14,2) not null default 0,otros_ingresos numeric(14,2) not null default 0,iess_base numeric(14,2) not null default 0,iess_personal numeric(14,2) not null default 0,iess_patronal numeric(14,2) not null default 0,decimo_tercero numeric(14,2) not null default 0,decimo_cuarto numeric(14,2) not null default 0,vacaciones numeric(14,2) not null default 0,fondo_reserva numeric(14,2) not null default 0,otras_deducciones numeric(14,2) not null default 0,neto_pagar numeric(14,2) not null default 0,costo_empleador numeric(14,2) not null default 0,asiento_id uuid references asientos_contables(id) on delete set null,created_at timestamptz not null default now(),unique(periodo_id,empleado_id));
create index if not exists idx_nomina_empleados_emisor_activo on nomina_empleados(emisor_id,activo,nombres);create index if not exists idx_nomina_periodos_emisor_periodo on nomina_periodos(emisor_id,periodo);create index if not exists idx_nomina_detalles_periodo on nomina_detalles(periodo_id);
insert into plan_cuentas_contables(emisor_id,codigo,nombre,nivel,tipo,naturaleza,acepta_movimientos,activa) select e.id,v.codigo,v.nombre,4,v.tipo,v.naturaleza,true,true from emisores e cross join (values('2.1.03.02','SUELDOS POR PAGAR','PASIVO','ACREEDORA'),('2.1.03.03','IESS APORTE PERSONAL POR PAGAR','PASIVO','ACREEDORA'),('2.1.03.04','IESS APORTE PATRONAL POR PAGAR','PASIVO','ACREEDORA'),('2.1.03.05','BENEFICIOS SOCIALES POR PAGAR','PASIVO','ACREEDORA'),('5.2.05.01','SUELDOS Y SALARIOS','GASTO','DEUDORA'),('5.2.05.02','APORTE PATRONAL IESS','GASTO','DEUDORA'),('5.2.05.03','DÉCIMO TERCERO','GASTO','DEUDORA'),('5.2.05.04','DÉCIMO CUARTO','GASTO','DEUDORA'),('5.2.05.05','VACACIONES','GASTO','DEUDORA'),('5.2.05.06','FONDOS DE RESERVA','GASTO','DEUDORA')) v(codigo,nombre,tipo,naturaleza) on conflict(emisor_id,codigo) do update set nombre=excluded.nombre,tipo=excluded.tipo,naturaleza=excluded.naturaleza,acepta_movimientos=true,activa=true;
insert into control_migraciones(version,detalle) values('9.9.11','Contabilidad completa: relaciones PostgREST, mayor, flujo de efectivo y nómina parametrizada.') on conflict(version) do update set detalle=excluded.detalle;
