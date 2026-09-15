-- CONTSERTRIB v9.9.20 — estabilidad contable, nómina y proformas
-- ADITIVA: no elimina comprobantes, asientos, empleados ni proformas.

-- 1) Proformas: algunas instalaciones antiguas no tenían created_at en las líneas.
alter table if exists public.proforma_items
  add column if not exists created_at timestamptz not null default now();
create index if not exists idx_proforma_items_proforma_created_9920
  on public.proforma_items(proforma_id, created_at);

-- 2) Nómina: compatibilidad con el esquema legado que exigía empresa_id.
alter table if exists public.nomina_empleados
  add column if not exists empresa_id uuid;

-- La empresa activa del SaaS es el emisor. Para filas históricas, si existe
-- empresa_id y falta emisor_id, se intenta recuperar la relación sin borrar nada.
update public.nomina_empleados
set emisor_id = empresa_id
where emisor_id is null and empresa_id is not null;

-- Los empleados nuevos se trazan por emisor_id. empresa_id queda opcional para
-- permitir instalaciones antiguas y no volver a bloquear altas.
alter table if exists public.nomina_empleados
  alter column empresa_id drop not null;

create index if not exists idx_nomina_empleados_emisor_ident_9920
  on public.nomina_empleados(emisor_id, identificacion);

-- 3) Integridad mínima de proforma_items para que los PDF puedan ordenar sin
-- depender de columnas ausentes en instalaciones antiguas.
notify pgrst, 'reload schema';

insert into control_migraciones(version,detalle)
values('9.9.20','Estabilidad: proforma_items.created_at, compatibilidad empresa_id/emisor_id de nómina y soporte de exportaciones/importaciones contables.')
on conflict(version) do update set detalle=excluded.detalle;

create or replace function public.periodo_contable_abierto(p_emisor_id uuid, p_fecha date)
returns boolean language plpgsql as $$
declare v_estado text;
begin
  select estado into v_estado from public.periodos_contables
    where emisor_id=p_emisor_id and periodo=to_char(p_fecha,'YYYY-MM');
  return coalesce(v_estado,'ABIERTO')='ABIERTO';
end; $$;

-- 4) Reafirma la RPC atómica utilizada por la sincronización de ventas.
-- Si ya existe, CREATE OR REPLACE conserva la firma y reemplaza solo la lógica.
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
  v_asiento uuid;
  v_linea jsonb;
  v_cuenta uuid;
  v_debe numeric := 0;
  v_haber numeric := 0;
  v_d numeric;
  v_h numeric;
begin
  if p_emisor_id is null or p_fecha is null or coalesce(trim(p_concepto),'')='' then
    raise exception 'datos_asiento_incompletos';
  end if;
  if not public.periodo_contable_abierto(p_emisor_id,p_fecha) then
    raise exception 'periodo_contable_cerrado:%',to_char(p_fecha,'YYYY-MM');
  end if;
  if coalesce(p_lineas,'[]'::jsonb)='[]'::jsonb then raise exception 'asiento_sin_lineas'; end if;
  if p_origen_tipo is not null and p_origen_id is not null then
    select id into v_asiento from public.asientos_contables
      where emisor_id=p_emisor_id and origen_tipo=p_origen_tipo and origen_id=p_origen_id limit 1;
    if v_asiento is not null then return v_asiento; end if;
  end if;
  insert into public.asientos_contables(emisor_id,fecha,tipo,concepto,referencia,origen_tipo,origen_id,estado,created_by)
  values(p_emisor_id,p_fecha,p_tipo,p_concepto,p_referencia,p_origen_tipo,p_origen_id,'BORRADOR',p_created_by)
  returning id into v_asiento;
  for v_linea in select * from jsonb_array_elements(p_lineas) loop
    select id into v_cuenta from public.plan_cuentas_contables
      where emisor_id=p_emisor_id and codigo=v_linea->>'codigo' and activa=true and acepta_movimientos=true;
    if v_cuenta is null then raise exception 'cuenta_no_configurada:%',v_linea->>'codigo'; end if;
    v_d:=round(coalesce((v_linea->>'debe')::numeric,0),2);
    v_h:=round(coalesce((v_linea->>'haber')::numeric,0),2);
    if v_d<0 or v_h<0 or (v_d>0 and v_h>0) then raise exception 'linea_contable_invalida:%',v_linea->>'codigo'; end if;
    v_debe:=v_debe+v_d; v_haber:=v_haber+v_h;
    insert into public.asiento_lineas_contables(asiento_id,cuenta_id,descripcion,debe,haber,tercero_tipo,tercero_id)
    values(v_asiento,v_cuenta,v_linea->>'descripcion',v_d,v_h,v_linea->>'tercero_tipo',nullif(v_linea->>'tercero_id','')::uuid);
  end loop;
  if round(v_debe,2)<>round(v_haber,2) or v_debe<=0 then
    raise exception 'asiento_no_cuadrado:debe=% haber=%',v_debe,v_haber;
  end if;
  update public.asientos_contables
    set estado='CONTABILIZADO',total_debe=round(v_debe,2),total_haber=round(v_haber,2),diferencia=round(v_debe-v_haber,2),updated_at=now()
    where id=v_asiento;
  return v_asiento;
exception when others then
  if v_asiento is not null then delete from public.asientos_contables where id=v_asiento; end if;
  raise;
end;
$$;

notify pgrst, 'reload schema';
