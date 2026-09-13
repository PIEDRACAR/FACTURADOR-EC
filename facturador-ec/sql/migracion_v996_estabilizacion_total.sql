-- CONTSERTRIB v9.9.6 — ESTABILIZACIÓN TOTAL DE MIGRACIONES
-- Objetivo: dejar la base compatible tanto con instalaciones existentes como nuevas.
-- No borra tablas, comprobantes, inventario ni configuración histórica.
-- Ejecutar DESPUÉS de las migraciones anteriores y antes de producción.

begin;

-- ============================================================
-- 1. Catálogo IVA: completar estructura de instalaciones antiguas
-- ============================================================
create table if not exists catalogo_iva_sri (
  id uuid primary key default gen_random_uuid(),
  codigo_porcentaje varchar(10) not null,
  descripcion varchar(120) not null,
  tarifa numeric(7,4) not null default 0,
  tipo varchar(20) not null default 'TARIFA',
  sector varchar(40),
  fecha_desde date,
  fecha_hasta date,
  base_legal varchar(250),
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table catalogo_iva_sri
  add column if not exists descripcion varchar(120),
  add column if not exists tarifa numeric(7,4),
  add column if not exists tipo varchar(20),
  add column if not exists sector varchar(40),
  add column if not exists fecha_desde date,
  add column if not exists fecha_hasta date,
  add column if not exists base_legal varchar(250),
  add column if not exists activo boolean,
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz;

update catalogo_iva_sri set descripcion=coalesce(nullif(descripcion,''),'IVA'), tarifa=coalesce(tarifa,0), tipo=coalesce(nullif(tipo,''),'TARIFA'), activo=coalesce(activo,true), created_at=coalesce(created_at,now()), updated_at=coalesce(updated_at,now());
alter table catalogo_iva_sri alter column descripcion set default 'IVA';
alter table catalogo_iva_sri alter column tarifa set default 0;
alter table catalogo_iva_sri alter column tipo set default 'TARIFA';
alter table catalogo_iva_sri alter column activo set default true;
alter table catalogo_iva_sri alter column created_at set default now();
alter table catalogo_iva_sri alter column updated_at set default now();

-- Evita depender de un constraint UNIQUE que quizá no exista en una instalación previa.
create index if not exists idx_catalogo_iva_codigo_vigencia
  on catalogo_iva_sri(codigo_porcentaje, fecha_desde);
create index if not exists idx_catalogo_iva_sri_vigencia
  on catalogo_iva_sri(codigo_porcentaje, fecha_desde, fecha_hasta, activo);

-- ============================================================
-- 2. Configuración IVA: completar estructura y dejar 15% como valor general
-- ============================================================
create table if not exists configuracion_iva (
  emisor_id uuid primary key references emisores(id) on delete cascade,
  tarifa_general numeric(7,4) not null default 15,
  codigo_general varchar(10) not null default '4',
  tarifa_reducida numeric(7,4) not null default 5,
  codigo_reducida varchar(10) not null default '5',
  tarifa_turismo numeric(7,4) not null default 8,
  codigo_turismo varchar(10) not null default '8',
  activo boolean not null default true,
  actualizado_por uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table configuracion_iva
  add column if not exists tarifa_general numeric(7,4),
  add column if not exists codigo_general varchar(10),
  add column if not exists tarifa_reducida numeric(7,4),
  add column if not exists codigo_reducida varchar(10),
  add column if not exists tarifa_turismo numeric(7,4),
  add column if not exists codigo_turismo varchar(10),
  add column if not exists activo boolean,
  add column if not exists actualizado_por uuid references auth.users(id) on delete set null,
  add column if not exists updated_at timestamptz;

update configuracion_iva set
  tarifa_general=coalesce(tarifa_general,15),
  codigo_general=coalesce(nullif(trim(codigo_general),''),'4'),
  tarifa_reducida=coalesce(tarifa_reducida,5),
  codigo_reducida=coalesce(nullif(trim(codigo_reducida),''),'5'),
  tarifa_turismo=coalesce(tarifa_turismo,8),
  codigo_turismo=coalesce(nullif(trim(codigo_turismo),''),'8'),
  activo=coalesce(activo,true),
  updated_at=coalesce(updated_at,now());

alter table configuracion_iva alter column tarifa_general set default 15;
alter table configuracion_iva alter column codigo_general set default '4';
alter table configuracion_iva alter column tarifa_reducida set default 5;
alter table configuracion_iva alter column codigo_reducida set default '5';
alter table configuracion_iva alter column tarifa_turismo set default 8;
alter table configuracion_iva alter column codigo_turismo set default '8';
alter table configuracion_iva alter column activo set default true;
alter table configuracion_iva alter column updated_at set default now();

insert into configuracion_iva(emisor_id)
select id from emisores
on conflict(emisor_id) do nothing;

-- Las configuraciones que quedaron en 13 por la migración defectuosa v9.9.0
-- se corrigen a 15; antes se registra el snapshot en el historial.
create table if not exists historial_configuracion_iva (
  id uuid primary key default gen_random_uuid(),
  emisor_id uuid not null references emisores(id) on delete cascade,
  tarifa_general numeric(7,4), codigo_general varchar(10),
  tarifa_reducida numeric(7,4), codigo_reducida varchar(10),
  tarifa_turismo numeric(7,4), codigo_turismo varchar(10),
  motivo varchar(500), actualizado_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

insert into historial_configuracion_iva(emisor_id,tarifa_general,codigo_general,tarifa_reducida,codigo_reducida,tarifa_turismo,codigo_turismo,motivo,actualizado_por)
select c.emisor_id,c.tarifa_general,c.codigo_general,c.tarifa_reducida,c.codigo_reducida,c.tarifa_turismo,c.codigo_turismo,
       'v9.9.6: normalización de IVA general 13% -> 15%',c.actualizado_por
from configuracion_iva c
where c.tarifa_general=13
  and not exists (select 1 from historial_configuracion_iva h where h.emisor_id=c.emisor_id and h.motivo='v9.9.6: normalización de IVA general 13% -> 15%');

update configuracion_iva set tarifa_general=15, codigo_general=coalesce(nullif(trim(codigo_general),''),'4'), updated_at=now() where tarifa_general=13;

-- ============================================================
-- 3. Plan contable: corregir compatibilidad activa/activo
-- ============================================================
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

alter table plan_cuentas_contables add column if not exists activa boolean;
update plan_cuentas_contables set activa=true where activa is null;
alter table plan_cuentas_contables alter column activa set default true;
create index if not exists idx_plan_cuentas_emisor_activa_codigo on plan_cuentas_contables(emisor_id,activa,codigo);

-- ============================================================
-- 4. Inventario: no tocar activo; solo garantizar índices esperados
-- ============================================================
create index if not exists idx_productos_alertas_stock
  on productos(emisor_id,activo,stock_actual,stock_critico,stock_minimo,stock_maximo);

-- ============================================================
-- 5. Asientos: idempotencia real para documentos con origen no nulo.
-- ============================================================
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
create unique index if not exists ux_asientos_origen_no_nulo
  on asientos_contables(emisor_id,origen_tipo,origen_id)
  where origen_tipo is not null and origen_id is not null;
create index if not exists idx_asientos_emisor_fecha on asientos_contables(emisor_id,fecha desc);

-- ============================================================
-- 6. Ventas: eliminar sobrecargas conocidas y dejar UNA firma canónica.
-- ============================================================
-- La aplicación actual envía 14 parámetros: 0,5,8,15 + descuento + IVA + propina + total + items + pagos.
drop function if exists crear_venta(uuid,uuid,uuid,text,numeric,numeric,numeric,numeric,numeric,numeric,jsonb,jsonb);
drop function if exists crear_venta(uuid,uuid,uuid,text,numeric,numeric,numeric,numeric,numeric,numeric,numeric,jsonb,jsonb);
drop function if exists crear_venta(uuid,uuid,uuid,text,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,jsonb,jsonb);

create or replace function crear_venta(
  p_emisor_id uuid,
  p_punto_emision_id uuid,
  p_cliente_id uuid,
  p_tipo text,
  p_subtotal_0 numeric,
  p_subtotal_5 numeric,
  p_subtotal_8 numeric,
  p_subtotal_15 numeric,
  p_total_descuento numeric,
  p_total_iva numeric,
  p_propina numeric,
  p_importe_total numeric,
  p_items jsonb,
  p_pagos jsonb
) returns uuid
language plpgsql
as $$
declare
  v_comprobante_id uuid;
  v_item jsonb;
  v_pago jsonb;
  v_producto_id uuid;
  v_cantidad numeric;
  v_stock_resultante numeric;
  v_costo_promedio numeric;
  v_tarifa text;
begin
  if p_emisor_id is null or p_punto_emision_id is null then raise exception 'emisor_y_punto_emision_son_obligatorios'; end if;
  if coalesce(p_items,'[]'::jsonb) = '[]'::jsonb then raise exception 'venta_sin_items'; end if;
  if p_importe_total < 0 or p_total_iva < 0 or p_total_descuento < 0 or p_propina < 0 then raise exception 'valores_monetarios_invalidos'; end if;

  insert into comprobantes(emisor_id,punto_emision_id,tipo,secuencial,cliente_id,subtotal_0,subtotal_5,subtotal_8,subtotal_15,total_descuento,total_iva,propina,importe_total,estado)
  values(p_emisor_id,p_punto_emision_id,p_tipo,null,p_cliente_id,coalesce(p_subtotal_0,0),coalesce(p_subtotal_5,0),coalesce(p_subtotal_8,0),coalesce(p_subtotal_15,0),coalesce(p_total_descuento,0),coalesce(p_total_iva,0),coalesce(p_propina,0),coalesce(p_importe_total,0),'generado')
  returning id into v_comprobante_id;

  for v_item in select * from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) loop
    if coalesce((v_item->>'cantidad')::numeric,0) <= 0 then raise exception 'cantidad_invalida'; end if;
    v_producto_id := nullif(v_item->>'producto_id','')::uuid;
    v_cantidad := (v_item->>'cantidad')::numeric;
    v_tarifa := lower(trim(coalesce(v_item->>'tarifa_iva','15')));
    if v_tarifa not in ('0','5','8','15','exento','no_objeto') then
      -- Se permiten tarifas futuras configuradas por el motor, pero deben ser numéricas.
      if v_tarifa !~ '^[0-9]+(\.[0-9]+)?$' or (v_tarifa::numeric < 0 or v_tarifa::numeric > 100) then raise exception 'tarifa_iva_invalida:%',v_tarifa; end if;
    end if;

    insert into comprobante_items(comprobante_id,producto_id,descripcion,cantidad,precio_unitario,descuento,precio_total_sin_impuesto,costo_unitario_momento,tarifa_iva,valor_iva)
    values(v_comprobante_id,v_producto_id,v_item->>'descripcion',v_cantidad,coalesce((v_item->>'precio_unitario')::numeric,0),coalesce((v_item->>'descuento')::numeric,0),coalesce((v_item->>'precio_total_sin_impuesto')::numeric,0),coalesce((v_item->>'costo_unitario_momento')::numeric,0),v_tarifa,coalesce((v_item->>'valor_iva')::numeric,0));

    if v_producto_id is not null then
      update productos set stock_actual=stock_actual-v_cantidad
      where id=v_producto_id and emisor_id=p_emisor_id and activo=true and stock_actual>=v_cantidad
      returning stock_actual,costo_promedio into v_stock_resultante,v_costo_promedio;
      if not found then raise exception 'stock_insuficiente:%',v_producto_id; end if;
      insert into movimientos_inventario(emisor_id,producto_id,tipo,cantidad,costo_unitario,saldo_cantidad,saldo_costo_promedio,referencia_tipo,referencia_id)
      values(p_emisor_id,v_producto_id,'salida',v_cantidad,coalesce((v_item->>'costo_unitario_momento')::numeric,0),v_stock_resultante,v_costo_promedio,'comprobante',v_comprobante_id);
    end if;
  end loop;

  for v_pago in select * from jsonb_array_elements(coalesce(p_pagos,'[]'::jsonb)) loop
    if coalesce((v_pago->>'valor')::numeric,0) < 0 then raise exception 'pago_invalido'; end if;
    insert into comprobante_formas_pago(comprobante_id,forma_pago_codigo,valor)
    values(v_comprobante_id,v_pago->>'forma_pago_codigo',(v_pago->>'valor')::numeric);
  end loop;

  return v_comprobante_id;
end;
$$;

-- ============================================================
-- 7. Marcador de versión de esquema
-- ============================================================
create table if not exists control_migraciones (
  id bigserial primary key,
  version varchar(30) not null unique,
  aplicado_at timestamptz not null default now(),
  detalle text
);
insert into control_migraciones(version,detalle)
values('9.9.6','Estabilización total: IVA 15%, columnas compatibles, índices y RPC crear_venta canónica.')
on conflict(version) do update set detalle=excluded.detalle;

commit;
