-- ============================================================
-- CONTSERTRIB v9.7.5 - MOTOR DE IMPUESTOS / IVA CONFIGURABLE
-- ============================================================
-- Objetivo: que una reforma de la tarifa del IVA no obligue a
-- modificar el código del sistema ni a tocar facturas históricas.
--
-- El producto conserva tarifa_iva por compatibilidad histórica, pero
-- desde esta migración se utiliza perfil_iva para resolver la tarifa
-- vigente a la fecha de emisión.
-- ============================================================

create table if not exists reglas_iva (
  id uuid primary key default gen_random_uuid(),
  clave text not null,
  nombre text not null,
  porcentaje numeric(6,3) not null check (porcentaje >= 0 and porcentaje <= 100),
  codigo_sri text not null,
  tipo text not null check (tipo in ('GENERAL','FIJA','TURISMO','CERO','EXENTO','NO_OBJETO')),
  fecha_inicio date not null,
  fecha_fin date,
  activo boolean not null default true,
  prioridad integer not null default 100,
  norma_referencia text,
  descripcion text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clave, fecha_inicio),
  check (fecha_fin is null or fecha_fin >= fecha_inicio)
);

create index if not exists idx_reglas_iva_vigencia on reglas_iva(tipo, activo, fecha_inicio, fecha_fin);

alter table productos add column if not exists perfil_iva text;
alter table emisores add column if not exists actividad_turistica boolean not null default false;
alter table emisores add column if not exists registro_turismo boolean not null default false;
alter table emisores add column if not exists luaf_vigente boolean not null default false;
alter table emisores add column if not exists numero_registro_turismo text;

update productos set perfil_iva = case
  when tarifa_iva = '15' then 'GENERAL'
  when tarifa_iva = '8' then 'TURISMO'
  when tarifa_iva = '5' then 'FIJA_5'
  when tarifa_iva = '0' then 'CERO'
  when tarifa_iva = 'exento' then 'EXENTO'
  when tarifa_iva = 'no_objeto' then 'NO_OBJETO'
  else 'GENERAL'
end
where perfil_iva is null;

alter table productos drop constraint if exists productos_perfil_iva_check;
alter table productos add constraint productos_perfil_iva_check
  check (perfil_iva in ('GENERAL','TURISMO','FIJA_5','CERO','EXENTO','NO_OBJETO'));

-- Tarifas/códigos actuales conocidos. Las nuevas reformas se agregan
-- como nuevas filas con su fecha de inicio; no se modifica el historial.
insert into reglas_iva (clave,nombre,porcentaje,codigo_sri,tipo,fecha_inicio,prioridad,norma_referencia,descripcion)
select 'IVA_GENERAL','IVA general vigente',15,'4','GENERAL','2024-04-01',10,
       'Normativa tributaria vigente / Ficha Técnica SRI',
       'Tarifa general. Si el SRI modifica la tarifa, se agrega una nueva regla con su nueva vigencia y código SRI.'
where not exists (select 1 from reglas_iva where clave='IVA_GENERAL' and fecha_inicio='2024-04-01');

insert into reglas_iva (clave,nombre,porcentaje,codigo_sri,tipo,fecha_inicio,prioridad,norma_referencia,descripcion)
select 'IVA_5_CONSTRUCCION','IVA 5% materiales de construcción',5,'5','FIJA','2024-04-01',20,
       'Normativa tributaria vigente / SRI',
       'Tarifa especial para los bienes que legalmente correspondan.'
where not exists (select 1 from reglas_iva where clave='IVA_5_CONSTRUCCION' and fecha_inicio='2024-04-01');


-- Periodos turísticos 2026 publicados/verificados. Son datos de vigencia,
-- no lógica de código: en el futuro el proveedor solo agrega nuevas filas.
insert into reglas_iva (clave,nombre,porcentaje,codigo_sri,tipo,fecha_inicio,fecha_fin,prioridad,norma_referencia,descripcion)
select 'IVA_TURISMO_2026_CARNAVAL','Turismo Carnaval 2026',8,'8','TURISMO','2026-02-14','2026-02-17',1,
       'Decreto Ejecutivo 304 / SRI', 'Reducción temporal para actividades turísticas elegibles.'
where not exists (select 1 from reglas_iva where clave='IVA_TURISMO_2026_CARNAVAL' and fecha_inicio='2026-02-14');

insert into reglas_iva (clave,nombre,porcentaje,codigo_sri,tipo,fecha_inicio,fecha_fin,prioridad,norma_referencia,descripcion)
select 'IVA_TURISMO_2026_MAYO','Turismo mayo 2026',8,'8','TURISMO','2026-05-23','2026-05-25',1,
       'Decreto Ejecutivo 391 / SRI', 'Reducción temporal para actividades turísticas elegibles.'
where not exists (select 1 from reglas_iva where clave='IVA_TURISMO_2026_MAYO' and fecha_inicio='2026-05-23');

-- Reemplaza la función de venta con la firma más reciente usada por v9.7.4.
-- No cambia su lógica: solo deja preparada la persistencia de perfil_iva.
drop function if exists crear_venta(uuid, uuid, uuid, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, jsonb, jsonb);

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
begin
  insert into comprobantes (emisor_id,punto_emision_id,tipo,secuencial,cliente_id,subtotal_0,subtotal_5,subtotal_8,subtotal_15,total_descuento,total_iva,propina,importe_total,estado)
  values (p_emisor_id,p_punto_emision_id,p_tipo,null,p_cliente_id,p_subtotal_0,p_subtotal_5,p_subtotal_8,p_subtotal_15,p_total_descuento,p_total_iva,p_propina,p_importe_total,'generado')
  returning id into v_comprobante_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_producto_id := nullif(v_item->>'producto_id','')::uuid;
    v_cantidad := (v_item->>'cantidad')::numeric;
    insert into comprobante_items (comprobante_id,producto_id,descripcion,cantidad,precio_unitario,descuento,precio_total_sin_impuesto,costo_unitario_momento,tarifa_iva,valor_iva)
    values (v_comprobante_id,v_producto_id,v_item->>'descripcion',v_cantidad,(v_item->>'precio_unitario')::numeric,(v_item->>'descuento')::numeric,(v_item->>'precio_total_sin_impuesto')::numeric,(v_item->>'costo_unitario_momento')::numeric,v_item->>'tarifa_iva',(v_item->>'valor_iva')::numeric);
    if v_producto_id is not null then
      update productos set stock_actual=stock_actual-v_cantidad
      where id=v_producto_id and stock_actual>=v_cantidad
      returning stock_actual,costo_promedio into v_stock_resultante,v_costo_promedio;
      if not found then raise exception 'stock_insuficiente:%',v_producto_id; end if;
      insert into movimientos_inventario (emisor_id,producto_id,tipo,cantidad,costo_unitario,saldo_cantidad,saldo_costo_promedio,referencia_tipo,referencia_id)
      values (p_emisor_id,v_producto_id,'salida',v_cantidad,(v_item->>'costo_unitario_momento')::numeric,v_stock_resultante,v_costo_promedio,'comprobante',v_comprobante_id);
    end if;
  end loop;
  for v_pago in select * from jsonb_array_elements(p_pagos) loop
    insert into comprobante_formas_pago (comprobante_id,forma_pago_codigo,valor) values (v_comprobante_id,v_pago->>'forma_pago_codigo',(v_pago->>'valor')::numeric);
  end loop;
  return v_comprobante_id;
end;
$$;
