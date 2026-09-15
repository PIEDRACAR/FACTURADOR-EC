-- v9.9.98 — Reparación definitiva del estado de Ticket POS
-- Corrige: comprobantes_estado_check al finalizar un ticket.
-- No modifica ni elimina comprobantes históricos.

DO $$
declare
  v_def text;
  v_expr text;
begin
  SELECT pg_get_constraintdef(oid)
    INTO v_def
  FROM pg_constraint
  WHERE conrelid = 'public.comprobantes'::regclass
    AND conname = 'comprobantes_estado_check';

  IF v_def IS NOT NULL AND position('registrado' in lower(v_def)) = 0 THEN
    v_expr := regexp_replace(v_def, '^CHECK\s*\((.*)\)$', '\1');
    ALTER TABLE public.comprobantes DROP CONSTRAINT comprobantes_estado_check;
    EXECUTE format(
      'ALTER TABLE public.comprobantes ADD CONSTRAINT comprobantes_estado_check CHECK ((%s) OR estado = ''registrado'')',
      v_expr
    );
  END IF;
END $$;

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
  values(p_emisor_id,p_punto_emision_id,p_tipo,null,p_cliente_id,coalesce(p_subtotal_0,0),coalesce(p_subtotal_5,0),coalesce(p_subtotal_8,0),coalesce(p_subtotal_15,0),coalesce(p_total_descuento,0),coalesce(p_total_iva,0),coalesce(p_propina,0),coalesce(p_importe_total,0),case when lower(trim(coalesce(p_tipo,'')))='ticket' then 'registrado' else 'generado' end)
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

