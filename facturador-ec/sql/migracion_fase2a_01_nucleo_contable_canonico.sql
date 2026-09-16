-- CONTSERTRIB Fase 2B - nucleo contable canonico
-- ADITIVA E IDEMPOTENTE. NO EJECUTAR sin validar antes el esquema de destino.
-- No elimina tablas, columnas, asientos ni lineas historicas.
begin;

create extension if not exists pgcrypto;

alter table public.asientos_contables add column if not exists numero_asiento bigint;
alter table public.asientos_contables add column if not exists tipo_diario varchar(30) not null default 'GENERAL';
alter table public.asientos_contables add column if not exists documento_origen varchar(160);
alter table public.asientos_contables add column if not exists establecimiento_id uuid;
alter table public.asientos_contables add column if not exists moneda char(3) not null default 'USD';
alter table public.asientos_contables add column if not exists tipo_cambio numeric(18,8) not null default 1;
alter table public.asientos_contables add column if not exists aprobado_por uuid references auth.users(id) on delete set null;
alter table public.asientos_contables add column if not exists aprobado_at timestamptz;
alter table public.asientos_contables add column if not exists reversa_de_id uuid references public.asientos_contables(id) on delete restrict;
alter table public.asientos_contables add column if not exists reversado_por_asiento_id uuid references public.asientos_contables(id) on delete restrict;
alter table public.asientos_contables add column if not exists motivo_reverso text;
-- Se conserva `estado` por compatibilidad con instalaciones cuyo CHECK historico
-- solo admite BORRADOR/CONTABILIZADO/ANULADO. El nucleo nuevo usa esta columna.
alter table public.asientos_contables add column if not exists estado_canonico varchar(20);

update public.asientos_contables
set estado_canonico=case
  when upper(coalesce(estado,''))='BORRADOR' then 'BORRADOR'
  when upper(coalesce(estado,''))='ANULADO' then 'REVERSADO'
  else 'CONTABILIZADO'
end
where estado_canonico is null;
alter table public.asientos_contables alter column estado_canonico set default 'CONTABILIZADO';

do $$ begin
  if not exists(select 1 from pg_constraint where conname='asientos_estado_canonico_chk' and conrelid='public.asientos_contables'::regclass) then
    alter table public.asientos_contables add constraint asientos_estado_canonico_chk
      check (estado_canonico in ('BORRADOR','APROBADO','CONTABILIZADO','REVERSADO')) not valid;
  end if;
end $$;

-- No se alteran silenciosamente origenes historicos incompletos. La migracion
-- se detiene con el total afectado para que sean auditados fuera de este script.
do $$ declare v_inconsistentes bigint;
begin
  select count(*) into v_inconsistentes from public.asientos_contables
  where (origen_tipo is null)<>(origen_id is null);
  if v_inconsistentes>0 then
    raise exception 'fase2b_origen_historico_incompleto: % asiento(s); auditar sin borrar ni corregir automaticamente',v_inconsistentes;
  end if;
  if not exists(select 1 from pg_constraint where conname='asientos_origen_completo_chk' and conrelid='public.asientos_contables'::regclass) then
    alter table public.asientos_contables add constraint asientos_origen_completo_chk
      check ((origen_tipo is null and origen_id is null) or (origen_tipo is not null and origen_id is not null));
  end if;
end $$;

do $$ declare v_inconsistentes bigint;
begin
  select count(*) into v_inconsistentes from public.asiento_lineas_contables
  where (nullif(trim(tercero_tipo),'') is null)<>(tercero_id is null);
  if v_inconsistentes>0 then
    raise exception 'fase2b_tercero_historico_incompleto: % linea(s); auditar sin borrar ni corregir automaticamente',v_inconsistentes;
  end if;
  if not exists(select 1 from pg_constraint where conname='lineas_tercero_completo_chk' and conrelid='public.asiento_lineas_contables'::regclass) then
    alter table public.asiento_lineas_contables add constraint lineas_tercero_completo_chk
      check ((nullif(trim(tercero_tipo),'') is null and tercero_id is null) or (nullif(trim(tercero_tipo),'') is not null and tercero_id is not null));
  end if;
end $$;

create table if not exists public.contabilidad_secuencias (
  emisor_id uuid primary key references public.emisores(id) on delete cascade,
  ultimo_numero bigint not null default 0,
  updated_at timestamptz not null default now()
);

-- Numera historicos que aun no tienen correlativo sin modificar ningun numero
-- preexistente. El orden queda determinado por empresa, fecha y creacion.
with maximos as (
  select emisor_id,coalesce(max(numero_asiento),0) maximo
  from public.asientos_contables group by emisor_id
), faltantes as (
  select a.id,a.emisor_id,m.maximo+row_number() over(partition by a.emisor_id order by a.fecha,a.created_at,a.id) numero
  from public.asientos_contables a join maximos m on m.emisor_id=a.emisor_id
  where a.numero_asiento is null
)
update public.asientos_contables a set numero_asiento=f.numero
from faltantes f where a.id=f.id and a.numero_asiento is null;

insert into public.contabilidad_secuencias(emisor_id,ultimo_numero)
select emisor_id,coalesce(max(numero_asiento),0) from public.asientos_contables group by emisor_id
on conflict(emisor_id) do update set ultimo_numero=greatest(public.contabilidad_secuencias.ultimo_numero,excluded.ultimo_numero),updated_at=now();

-- Si existen origenes duplicados, el indice aborta de forma segura y obliga a
-- auditarlos manualmente; nunca borra ni fusiona asientos historicos.
create unique index if not exists ux_asientos_origen_canonico
  on public.asientos_contables(emisor_id,origen_tipo,origen_id)
  where origen_tipo is not null and origen_id is not null;
create unique index if not exists ux_asientos_numero_canonico
  on public.asientos_contables(emisor_id,numero_asiento)
  where numero_asiento is not null;
create unique index if not exists ux_asientos_reversa_unica
  on public.asientos_contables(emisor_id,reversa_de_id)
  where reversa_de_id is not null;
create index if not exists idx_asientos_diario_fecha
  on public.asientos_contables(emisor_id,tipo_diario,fecha,numero_asiento);
create index if not exists idx_lineas_tercero_canonico
  on public.asiento_lineas_contables(tercero_tipo,tercero_id,cuenta_id);

create or replace function public.siguiente_numero_asiento(p_emisor_id uuid)
returns bigint language plpgsql as $$
declare v_numero bigint;
begin
  insert into public.contabilidad_secuencias(emisor_id,ultimo_numero)
  values(p_emisor_id,1)
  on conflict(emisor_id) do update
    set ultimo_numero=public.contabilidad_secuencias.ultimo_numero+1,updated_at=now()
  returning ultimo_numero into v_numero;
  return v_numero;
end $$;

-- tercero_id es polimorfico: no corresponde una FK generica. Esta funcion usa
-- las tablas reales del sistema y exige que el tercero pertenezca al emisor.
create or replace function public.validar_tercero_contable(p_emisor_id uuid,p_tipo text,p_id uuid)
returns void language plpgsql as $$
declare v_tipo text:=upper(nullif(trim(p_tipo),'')); v_existe boolean:=false;
begin
  if (v_tipo is null)<>(p_id is null) then raise exception 'tercero_incompleto'; end if;
  if v_tipo is null then return; end if;
  case v_tipo
    when 'CLIENTE' then select exists(select 1 from public.clientes where id=p_id and emisor_id=p_emisor_id) into v_existe;
    when 'PROVEEDOR' then select exists(select 1 from public.proveedores where id=p_id and emisor_id=p_emisor_id) into v_existe;
    when 'EMPLEADO' then select exists(select 1 from public.nomina_empleados where id=p_id and emisor_id=p_emisor_id) into v_existe;
    else raise exception 'tercero_tipo_no_soportado:%',v_tipo;
  end case;
  if not v_existe then raise exception 'tercero_no_pertenece_emisor:tipo=% id=%',v_tipo,p_id; end if;
end $$;

-- Firma historica conservada para no romper backend ni instalaciones actuales.
create or replace function public.crear_asiento_contable_atomico(
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
  v_asiento uuid; v_linea jsonb; v_cuenta uuid; v_numero bigint;
  v_debe numeric:=0; v_haber numeric:=0; v_d numeric; v_h numeric;
  v_origen_tipo text:=nullif(trim(p_origen_tipo),''); v_tercero_tipo text; v_tercero_id uuid;
begin
  if p_emisor_id is null or p_fecha is null or coalesce(trim(p_concepto),'')='' then raise exception 'datos_asiento_incompletos'; end if;
  if (v_origen_tipo is null)<>(p_origen_id is null) then raise exception 'origen_contable_incompleto'; end if;
  if not public.periodo_contable_abierto(p_emisor_id,p_fecha) then raise exception 'periodo_contable_cerrado:%',to_char(p_fecha,'YYYY-MM'); end if;
  if jsonb_typeof(coalesce(p_lineas,'[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_lineas,'[]'::jsonb))=0 then raise exception 'asiento_sin_lineas'; end if;

  if v_origen_tipo is not null and p_origen_id is not null then
    perform pg_advisory_xact_lock(hashtext(p_emisor_id::text||':'||v_origen_tipo),hashtext(p_origen_id::text));
    select id into v_asiento from public.asientos_contables
      where emisor_id=p_emisor_id and origen_tipo=v_origen_tipo and origen_id=p_origen_id
      order by created_at,id limit 1;
    if v_asiento is not null then return v_asiento; end if;
  end if;

  v_numero:=public.siguiente_numero_asiento(p_emisor_id);
  insert into public.asientos_contables(
    emisor_id,numero_asiento,fecha,tipo,tipo_diario,concepto,referencia,
    documento_origen,origen_tipo,origen_id,estado,estado_canonico,moneda,
    tipo_cambio,created_by,created_at,updated_at
  ) values(
    p_emisor_id,v_numero,p_fecha,upper(trim(p_tipo)),'GENERAL',trim(p_concepto),p_referencia,
    coalesce(p_referencia,v_origen_tipo),v_origen_tipo,p_origen_id,'BORRADOR','BORRADOR','USD',
    1,p_created_by,now(),now()
  ) returning id into v_asiento;

  for v_linea in select value from jsonb_array_elements(p_lineas) loop
    select id into v_cuenta from public.plan_cuentas_contables
      where emisor_id=p_emisor_id and codigo=v_linea->>'codigo' and activa=true and acepta_movimientos=true;
    if v_cuenta is null then raise exception 'cuenta_no_configurada:%',v_linea->>'codigo'; end if;
    v_d:=round(coalesce(nullif(v_linea->>'debe','')::numeric,0),2);
    v_h:=round(coalesce(nullif(v_linea->>'haber','')::numeric,0),2);
    if v_d<0 or v_h<0 or (v_d>0 and v_h>0) then raise exception 'linea_contable_invalida:%',v_linea->>'codigo'; end if;
    v_tercero_tipo:=upper(nullif(trim(v_linea->>'tercero_tipo'),''));
    v_tercero_id:=nullif(v_linea->>'tercero_id','')::uuid;
    perform public.validar_tercero_contable(p_emisor_id,v_tercero_tipo,v_tercero_id);
    v_debe:=v_debe+v_d; v_haber:=v_haber+v_h;
    insert into public.asiento_lineas_contables(asiento_id,cuenta_id,descripcion,debe,haber,tercero_tipo,tercero_id,created_at)
    values(v_asiento,v_cuenta,v_linea->>'descripcion',v_d,v_h,v_tercero_tipo,v_tercero_id,now());
  end loop;

  if round(v_debe,2)<>round(v_haber,2) or v_debe<=0 then raise exception 'asiento_no_cuadrado:debe=% haber=%',v_debe,v_haber; end if;
  update public.asientos_contables set estado='CONTABILIZADO',estado_canonico='CONTABILIZADO',
    total_debe=round(v_debe,2),total_haber=round(v_haber,2),diferencia=0,updated_at=now()
    where id=v_asiento and emisor_id=p_emisor_id;
  return v_asiento;
end $$;

create or replace function public.reversar_asiento_contable_atomico(
  p_emisor_id uuid,p_asiento_id uuid,p_fecha date,p_motivo text,p_user_id uuid
) returns uuid language plpgsql as $$
declare v_original record; v_reverso uuid; v_lineas jsonb;
begin
  if coalesce(trim(p_motivo),'')='' then raise exception 'motivo_reverso_obligatorio'; end if;
  perform pg_advisory_xact_lock(hashtext(p_emisor_id::text||':REVERSO'),hashtext(p_asiento_id::text));
  select * into v_original from public.asientos_contables
    where id=p_asiento_id and emisor_id=p_emisor_id for update;
  if not found then raise exception 'asiento_no_encontrado'; end if;
  if v_original.reversa_de_id is not null or upper(coalesce(v_original.tipo,''))='REVERSO' then raise exception 'reverso_de_reverso_no_permitido'; end if;
  select id into v_reverso from public.asientos_contables where emisor_id=p_emisor_id and reversa_de_id=p_asiento_id limit 1;
  if v_reverso is not null then return v_reverso; end if;
  if coalesce(v_original.estado_canonico,v_original.estado)<>'CONTABILIZADO' then raise exception 'asiento_no_reversible:%',coalesce(v_original.estado_canonico,v_original.estado); end if;
  if not public.periodo_contable_abierto(p_emisor_id,p_fecha) then raise exception 'periodo_contable_cerrado:%',to_char(p_fecha,'YYYY-MM'); end if;
  select jsonb_agg(jsonb_build_object('codigo',c.codigo,'descripcion',coalesce(l.descripcion,v_original.concepto),'debe',l.haber,'haber',l.debe,'tercero_tipo',l.tercero_tipo,'tercero_id',l.tercero_id))
    into v_lineas from public.asiento_lineas_contables l join public.plan_cuentas_contables c on c.id=l.cuenta_id and c.emisor_id=p_emisor_id where l.asiento_id=p_asiento_id;
  v_reverso:=public.crear_asiento_contable_atomico(p_emisor_id,p_fecha,'REVERSO',
    'Reverso: '||v_original.concepto,coalesce(v_original.referencia,v_original.numero_asiento::text),
    'REVERSO_CONTABLE',p_asiento_id,p_user_id,v_lineas);
  update public.asientos_contables set reversa_de_id=p_asiento_id,motivo_reverso=trim(p_motivo),
    documento_origen=coalesce(v_original.documento_origen,v_original.referencia,v_original.origen_tipo),updated_at=now()
    where id=v_reverso and emisor_id=p_emisor_id;
  update public.asientos_contables set estado_canonico='REVERSADO',reversado_por_asiento_id=v_reverso,
    motivo_reverso=trim(p_motivo),updated_at=now() where id=p_asiento_id and emisor_id=p_emisor_id;
  return v_reverso;
end $$;

-- Edicion compatible, limitada a manuales/ajustes sin origen. Valida tanto el
-- periodo de la fecha original como el de la nueva fecha.
create or replace function public.editar_asiento_contable_atomico(
  p_emisor_id uuid,p_asiento_id uuid,p_fecha date,p_concepto text,p_referencia text,p_lineas jsonb
) returns uuid language plpgsql as $$
declare v_estado text; v_tipo text; v_origen uuid; v_fecha_anterior date; v_linea jsonb;
  v_cuenta uuid; v_d numeric:=0; v_h numeric:=0; vd numeric; vh numeric;
  v_tercero_tipo text; v_tercero_id uuid;
begin
  select coalesce(estado_canonico,estado),tipo,origen_id,fecha into v_estado,v_tipo,v_origen,v_fecha_anterior
    from public.asientos_contables where id=p_asiento_id and emisor_id=p_emisor_id for update;
  if not found then raise exception 'asiento_no_encontrado'; end if;
  if v_estado<>'CONTABILIZADO' then raise exception 'asiento_no_contabilizado'; end if;
  if upper(coalesce(v_tipo,'')) not in ('MANUAL','AJUSTE') or v_origen is not null then raise exception 'asiento_automatico_no_editable'; end if;
  if not public.periodo_contable_abierto(p_emisor_id,v_fecha_anterior) then raise exception 'periodo_anterior_cerrado:%',to_char(v_fecha_anterior,'YYYY-MM'); end if;
  if not public.periodo_contable_abierto(p_emisor_id,p_fecha) then raise exception 'periodo_nuevo_cerrado:%',to_char(p_fecha,'YYYY-MM'); end if;
  if coalesce(trim(p_concepto),'')='' or jsonb_array_length(coalesce(p_lineas,'[]'::jsonb))=0 then raise exception 'datos_asiento_incompletos'; end if;
  delete from public.asiento_lineas_contables where asiento_id=p_asiento_id;
  for v_linea in select value from jsonb_array_elements(p_lineas) loop
    select id into v_cuenta from public.plan_cuentas_contables where emisor_id=p_emisor_id and codigo=v_linea->>'codigo' and activa=true and acepta_movimientos=true;
    if v_cuenta is null then raise exception 'cuenta_no_configurada:%',v_linea->>'codigo'; end if;
    vd:=round(coalesce(nullif(v_linea->>'debe','')::numeric,0),2); vh:=round(coalesce(nullif(v_linea->>'haber','')::numeric,0),2);
    if vd<0 or vh<0 or (vd>0 and vh>0) then raise exception 'linea_contable_invalida:%',v_linea->>'codigo'; end if;
    v_tercero_tipo:=upper(nullif(trim(v_linea->>'tercero_tipo'),''));
    v_tercero_id:=nullif(v_linea->>'tercero_id','')::uuid;
    perform public.validar_tercero_contable(p_emisor_id,v_tercero_tipo,v_tercero_id);
    v_d:=v_d+vd;v_h:=v_h+vh;
    insert into public.asiento_lineas_contables(asiento_id,cuenta_id,descripcion,debe,haber,tercero_tipo,tercero_id)
    values(p_asiento_id,v_cuenta,v_linea->>'descripcion',vd,vh,v_tercero_tipo,v_tercero_id);
  end loop;
  if round(v_d,2)<>round(v_h,2) or v_d<=0 then raise exception 'asiento_no_cuadrado:debe=% haber=%',v_d,v_h; end if;
  update public.asientos_contables set fecha=p_fecha,concepto=trim(p_concepto),referencia=p_referencia,
    total_debe=round(v_d,2),total_haber=round(v_h,2),diferencia=0,updated_at=now()
    where id=p_asiento_id and emisor_id=p_emisor_id;
  return p_asiento_id;
end $$;

insert into public.control_migraciones(version,detalle)
values('fase2b.01','Nucleo contable canonico: numeracion, metadatos, idempotencia concurrente, reversos y edicion segura.')
on conflict(version) do update set detalle=excluded.detalle,aplicado_at=now();

notify pgrst,'reload schema';
commit;
