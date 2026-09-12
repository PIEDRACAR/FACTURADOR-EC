-- CONTSERTRIB v9.9.18 — integridad de nómina + soporte operativo de reportes.
-- No elimina información histórica.

-- Algunas instalaciones antiguas crearon nomina_empleados con empresa_id.
-- La aplicación actual es multiempresa mediante emisor_id. Si la columna
-- heredada existe, no debe bloquear el alta de empleados nuevos.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='nomina_empleados' and column_name='empresa_id'
  ) then
    execute 'alter table public.nomina_empleados alter column empresa_id drop not null';
  end if;
exception when undefined_column then null;
end $$;

-- Refuerza que el identificador y emisor de la nómina sean siempre trazables.
alter table if exists public.nomina_empleados add column if not exists emisor_id uuid;
alter table if exists public.nomina_empleados add column if not exists identificacion varchar(20);
alter table if exists public.nomina_empleados add column if not exists nombres varchar(200);
alter table if exists public.nomina_empleados add column if not exists fecha_ingreso date;
alter table if exists public.nomina_empleados add column if not exists sueldo_base numeric(14,2) default 0;
alter table if exists public.nomina_empleados add column if not exists activo boolean default true;

create index if not exists idx_nomina_empleados_emisor_ident_9918
  on public.nomina_empleados(emisor_id, identificacion);

create index if not exists idx_movimientos_caja_fecha_9918
  on public.movimientos_caja(created_at desc);

create index if not exists idx_cajas_emisor_cierre_9918
  on public.cajas(emisor_id, fecha_apertura desc, fecha_cierre desc);

-- Solicita a PostgREST recargar el esquema inmediatamente después de la migración.
notify pgrst, 'reload schema';

-- Edición segura de asientos MANUALES mientras el período permanezca abierto.
create or replace function editar_asiento_contable_atomico(
  p_emisor_id uuid, p_asiento_id uuid, p_fecha date, p_concepto text,
  p_referencia text, p_lineas jsonb
) returns uuid language plpgsql as $$
declare v_estado text; v_old_tipo text; v_linea jsonb; v_cuenta uuid; v_d numeric:=0; v_h numeric:=0; vd numeric; vh numeric;
begin
  select estado,tipo into v_estado,v_old_tipo from asientos_contables where id=p_asiento_id and emisor_id=p_emisor_id for update;
  if not found then raise exception 'asiento_no_encontrado'; end if;
  if v_estado<>'CONTABILIZADO' then raise exception 'asiento_no_contabilizado'; end if;
  if v_old_tipo not in ('MANUAL','AJUSTE') then raise exception 'solo_se_pueden_editar_asientos_manuales'; end if;
  if not periodo_contable_abierto(p_emisor_id,p_fecha) then raise exception 'periodo_contable_cerrado:%',to_char(p_fecha,'YYYY-MM'); end if;
  if coalesce(trim(p_concepto),'')='' or coalesce(p_lineas,'[]'::jsonb)='[]'::jsonb then raise exception 'datos_asiento_incompletos'; end if;
  delete from asiento_lineas_contables where asiento_id=p_asiento_id;
  for v_linea in select * from jsonb_array_elements(p_lineas) loop
    select id into v_cuenta from plan_cuentas_contables where emisor_id=p_emisor_id and codigo=v_linea->>'codigo' and activa=true and acepta_movimientos=true;
    if v_cuenta is null then raise exception 'cuenta_no_configurada:%',v_linea->>'codigo'; end if;
    vd:=round(coalesce((v_linea->>'debe')::numeric,0),2); vh:=round(coalesce((v_linea->>'haber')::numeric,0),2);
    if vd<0 or vh<0 or (vd>0 and vh>0) then raise exception 'linea_contable_invalida:%',v_linea->>'codigo'; end if;
    v_d:=v_d+vd; v_h:=v_h+vh;
    insert into asiento_lineas_contables(asiento_id,cuenta_id,descripcion,debe,haber,tercero_tipo,tercero_id)
    values(p_asiento_id,v_cuenta,v_linea->>'descripcion',vd,vh,v_linea->>'tercero_tipo',nullif(v_linea->>'tercero_id','')::uuid);
  end loop;
  if round(v_d,2)<>round(v_h,2) or v_d<=0 then raise exception 'asiento_no_cuadrado:debe=% haber=%',v_d,v_h; end if;
  update asientos_contables set fecha=p_fecha,concepto=p_concepto,referencia=p_referencia,total_debe=round(v_d,2),total_haber=round(v_h,2),diferencia=0,updated_at=now() where id=p_asiento_id and emisor_id=p_emisor_id;
  return p_asiento_id;
end $$;

notify pgrst, 'reload schema';
