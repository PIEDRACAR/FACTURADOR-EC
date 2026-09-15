-- CONTSERTRIB v9.10.11 — Motor contable integrado, idempotencia y auditoría
-- ADITIVA: no elimina ni reescribe datos históricos.
begin;

create extension if not exists pgcrypto;

alter table cuentas_por_pagar add column if not exists documento_sri_id uuid references documentos_sri_borrador(id) on delete set null;
alter table cuentas_por_cobrar add column if not exists documento_sri_id uuid references documentos_sri_borrador(id) on delete set null;
alter table nomina_detalles add column if not exists beneficios_acumulados numeric(14,2) not null default 0;
alter table nomina_periodos add column if not exists asiento_id uuid references asientos_contables(id) on delete set null;

alter table documentos_sri_borrador add column if not exists contabilidad_estado varchar(30) not null default 'NO_APLICA';
alter table documentos_sri_borrador add column if not exists contabilidad_asiento_id uuid references asientos_contables(id) on delete set null;
alter table documentos_sri_borrador add column if not exists contabilidad_error text;

create index if not exists idx_cxp_documento_sri_emisor on cuentas_por_pagar(emisor_id,documento_sri_id);
create index if not exists idx_cxc_documento_sri_emisor on cuentas_por_cobrar(emisor_id,documento_sri_id);
create index if not exists idx_docs_sri_contabilidad on documentos_sri_borrador(emisor_id,estado,contabilidad_estado,created_at desc);
create index if not exists idx_asientos_origen_emisor on asientos_contables(emisor_id,origen_tipo,origen_id);

create table if not exists contabilidad_sincronizaciones (
  id uuid primary key default gen_random_uuid(),
  emisor_id uuid not null references emisores(id) on delete cascade,
  iniciado_por uuid references auth.users(id) on delete set null,
  iniciado_at timestamptz not null default now(),
  terminado_at timestamptz,
  estado varchar(20) not null default 'EJECUTANDO',
  resumen jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_contab_sync_emisor_fecha on contabilidad_sincronizaciones(emisor_id,iniciado_at desc);

-- RPC atómica: además del cuadre, protege la idempotencia contra dos procesos
-- simultáneos que intenten contabilizar el mismo origen.
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
    -- Bloqueo transaccional determinista por empresa + origen.
    perform pg_advisory_xact_lock(hashtext(coalesce(p_emisor_id::text,'') || ':' || coalesce(p_origen_tipo,'')), hashtext(p_origen_id::text));
    select id into v_asiento
      from asientos_contables
      where emisor_id=p_emisor_id and origen_tipo=p_origen_tipo and origen_id=p_origen_id
      order by created_at
      limit 1;
    if v_asiento is not null then return v_asiento; end if;
  end if;

  insert into asientos_contables(emisor_id,fecha,tipo,concepto,referencia,origen_tipo,origen_id,estado,created_by)
  values(p_emisor_id,p_fecha,p_tipo,p_concepto,p_referencia,p_origen_tipo,p_origen_id,'BORRADOR',p_created_by)
  returning id into v_asiento;

  for v_linea in select * from jsonb_array_elements(p_lineas) loop
    select id into v_cuenta
      from plan_cuentas_contables
      where emisor_id=p_emisor_id and codigo=v_linea->>'codigo' and activa=true and acepta_movimientos=true;
    if v_cuenta is null then raise exception 'cuenta_no_configurada:%',v_linea->>'codigo'; end if;
    v_d:=round(coalesce((v_linea->>'debe')::numeric,0),2);
    v_h:=round(coalesce((v_linea->>'haber')::numeric,0),2);
    if v_d<0 or v_h<0 or (v_d>0 and v_h>0) then raise exception 'linea_contable_invalida:%',v_linea->>'codigo'; end if;
    v_debe:=v_debe+v_d; v_haber:=v_haber+v_h;
    insert into asiento_lineas_contables(asiento_id,cuenta_id,descripcion,debe,haber,tercero_tipo,tercero_id)
    values(v_asiento,v_cuenta,v_linea->>'descripcion',v_d,v_h,v_linea->>'tercero_tipo',nullif(v_linea->>'tercero_id','')::uuid);
  end loop;

  if round(v_debe,2)<>round(v_haber,2) or v_debe<=0 then raise exception 'asiento_no_cuadrado:debe=% haber=%',v_debe,v_haber; end if;
  update asientos_contables
     set estado='CONTABILIZADO',total_debe=round(v_debe,2),total_haber=round(v_haber,2),diferencia=round(v_debe-v_haber,2),updated_at=now()
   where id=v_asiento;
  return v_asiento;
exception when others then
  if v_asiento is not null then delete from asientos_contables where id=v_asiento; end if;
  raise;
end; $$;

insert into control_migraciones(version,detalle)
values('9.10.11','Motor contable integrado: documentos SRI, nómina persistida, idempotencia concurrente, sincronización y auditoría.')
on conflict(version) do update set detalle=excluded.detalle, aplicado_at=now();

notify pgrst, 'reload schema';
commit;
