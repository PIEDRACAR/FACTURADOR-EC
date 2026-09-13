-- CONTSERTRIB v9.9.8 — Núcleo contable completo y seguro (ADITIVO)
-- Ejecutar después de v9.9.7 / v9.9.6. No borra comprobantes ni asientos históricos.

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
