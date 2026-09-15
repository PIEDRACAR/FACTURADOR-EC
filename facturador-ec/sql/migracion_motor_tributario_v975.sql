-- CONTSERTRIB v9.7.5 — Motor Tributario Ecuador
-- Ejecutar UNA sola vez en Supabase.
-- Diseñado para mantener historial: las reglas nuevas no modifican comprobantes ya emitidos.

create table if not exists reglas_tributarias_ecuador (
  id uuid primary key default gen_random_uuid(),
  codigo varchar(30) not null,
  impuesto varchar(20) not null default 'IVA',
  nombre varchar(200) not null,
  tarifa numeric(8,4) not null,
  codigo_porcentaje varchar(10) not null,
  categoria varchar(30) not null default 'GENERAL',
  fecha_inicio date not null,
  fecha_fin date,
  aplica_feriado boolean not null default false,
  requiere_turismo boolean not null default false,
  requiere_registro_turismo boolean not null default false,
  requiere_luaf boolean not null default false,
  condiciones jsonb not null default '{}'::jsonb,
  base_legal text,
  prioridad integer not null default 100,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reglas_tributarias_fecha_chk check (fecha_fin is null or fecha_fin >= fecha_inicio),
  constraint reglas_tributarias_tarifa_chk check (tarifa >= 0 and tarifa <= 100)
);
create unique index if not exists uq_regla_tributaria_codigo_inicio on reglas_tributarias_ecuador(codigo,fecha_inicio);
create index if not exists idx_regla_tributaria_busqueda on reglas_tributarias_ecuador(impuesto,categoria,fecha_inicio,fecha_fin,activo);

create table if not exists feriados_ecuador (
  id uuid primary key default gen_random_uuid(),
  fecha date not null unique,
  nombre varchar(200) not null,
  tipo varchar(20) not null default 'NACIONAL',
  localidad varchar(120),
  base_legal text,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists idx_feriados_fecha on feriados_ecuador(fecha,activo);

create table if not exists perfil_tributario_emisor (
  emisor_id uuid primary key references emisores(id) on delete cascade,
  actividad_economica_principal text,
  codigo_ciiu varchar(20),
  es_turistico boolean not null default false,
  registro_turismo boolean not null default false,
  numero_registro_turismo varchar(100),
  luaf_vigente boolean not null default false,
  fecha_vencimiento_luaf date,
  actualizado_desde_ruc date,
  fuente varchar(30) not null default 'manual',
  updated_at timestamptz not null default now()
);

alter table productos add column if not exists categoria_tributaria varchar(30) not null default 'GENERAL';
alter table productos drop constraint if exists productos_tarifa_iva_check;
alter table productos add constraint productos_tarifa_iva_check check (
  tarifa_iva in ('general','0','5','8','15','exento','no_objeto')
  or tarifa_iva ~ '^[0-9]+(\\.[0-9]+)?$'
);
-- Los productos actuales con 15% pasan a tarifa GENERAL: así un cambio legal de la tarifa
-- general futura se aplica automáticamente a los productos sin alterar comprobantes históricos.
update productos set tarifa_iva='general', categoria_tributaria='GENERAL' where tarifa_iva='15';

alter table comprobantes add column if not exists subtotal_otros numeric(12,2) not null default 0;
alter table comprobantes add column if not exists impuestos_detalle jsonb not null default '[]'::jsonb;
alter table comprobante_items add column if not exists codigo_porcentaje_iva varchar(10);
alter table comprobante_items add column if not exists regla_tributaria_id uuid references reglas_tributarias_ecuador(id);

-- Reglas base vigentes y reglas especiales conocidas de 2026.
insert into reglas_tributarias_ecuador
(codigo,impuesto,nombre,tarifa,codigo_porcentaje,categoria,fecha_inicio,fecha_fin,aplica_feriado,base_legal,prioridad)
values
('IVA_GENERAL_2026','IVA','IVA tarifa general',15,'4','GENERAL','2026-01-01',null,false,'Ley de Régimen Tributario Interno / normativa SRI vigente',100),
('IVA_CONSTRUCCION_2026','IVA','IVA materiales de construcción',5,'5','CONSTRUCCION','2026-01-01',null,false,'Ley de Régimen Tributario Interno / normativa vigente',110),
('IVA_TURISMO_CARNAVAL_2026','IVA','IVA turismo Carnaval 2026',8,'8','TURISMO','2026-02-14','2026-02-17',true,'Decreto Ejecutivo No. 304',10),
('IVA_TURISMO_PICHINCHA_2026','IVA','IVA turismo Batalla de Pichincha 2026',8,'8','TURISMO','2026-05-23','2026-05-25',true,'Decreto Ejecutivo No. 391',10)
on conflict (codigo,fecha_inicio) do update set
 nombre=excluded.nombre, tarifa=excluded.tarifa, codigo_porcentaje=excluded.codigo_porcentaje,
 fecha_fin=excluded.fecha_fin, aplica_feriado=excluded.aplica_feriado, base_legal=excluded.base_legal,
 activo=true, updated_at=now();

insert into feriados_ecuador(fecha,nombre,tipo,base_legal) values
('2026-01-01','Año Nuevo','NACIONAL','Calendario de feriados Ecuador 2026'),
('2026-02-16','Carnaval','NACIONAL','Calendario de feriados Ecuador 2026'),
('2026-02-17','Carnaval','NACIONAL','Calendario de feriados Ecuador 2026'),
('2026-04-03','Viernes Santo','NACIONAL','Calendario de feriados Ecuador 2026'),
('2026-05-01','Día del Trabajo','NACIONAL','Calendario de feriados Ecuador 2026'),
('2026-05-25','Batalla de Pichincha - traslado','NACIONAL','Calendario de feriados Ecuador 2026'),
('2026-08-10','Primer Grito de Independencia','NACIONAL','Calendario de feriados Ecuador 2026'),
('2026-10-09','Independencia de Guayaquil','NACIONAL','Calendario de feriados Ecuador 2026'),
('2026-11-02','Día de los Difuntos','NACIONAL','Calendario de feriados Ecuador 2026'),
('2026-11-03','Independencia de Cuenca','NACIONAL','Calendario de feriados Ecuador 2026'),
('2026-12-25','Navidad','NACIONAL','Calendario de feriados Ecuador 2026')
on conflict (fecha) do update set nombre=excluded.nombre, base_legal=excluded.base_legal, activo=true;

-- RPC nueva: no reemplaza la RPC anterior, evitando romper instalaciones existentes.
create or replace function crear_venta_dinamica(
  p_emisor_id uuid,
  p_punto_emision_id uuid,
  p_cliente_id uuid,
  p_tipo text,
  p_subtotal_0 numeric,
  p_subtotal_5 numeric,
  p_subtotal_8 numeric,
  p_subtotal_15 numeric,
  p_subtotal_otros numeric,
  p_total_descuento numeric,
  p_total_iva numeric,
  p_propina numeric,
  p_importe_total numeric,
  p_impuestos_detalle jsonb,
  p_items jsonb,
  p_pagos jsonb
) returns uuid
language plpgsql
as $$
declare
  v_comprobante_id uuid; v_item jsonb; v_pago jsonb; v_producto_id uuid;
  v_cantidad numeric; v_stock_resultante numeric; v_costo_promedio numeric;
begin
  insert into comprobantes (
    emisor_id,punto_emision_id,tipo,secuencial,cliente_id,subtotal_0,subtotal_5,subtotal_8,subtotal_15,subtotal_otros,
    total_descuento,total_iva,propina,importe_total,impuestos_detalle,estado
  ) values (
    p_emisor_id,p_punto_emision_id,p_tipo,null,p_cliente_id,p_subtotal_0,p_subtotal_5,p_subtotal_8,p_subtotal_15,p_subtotal_otros,
    p_total_descuento,p_total_iva,p_propina,p_importe_total,coalesce(p_impuestos_detalle,'[]'::jsonb),'generado'
  ) returning id into v_comprobante_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_producto_id := nullif(v_item->>'producto_id','')::uuid;
    v_cantidad := (v_item->>'cantidad')::numeric;
    insert into comprobante_items (
      comprobante_id,producto_id,descripcion,cantidad,precio_unitario,descuento,precio_total_sin_impuesto,costo_unitario_momento,
      tarifa_iva,valor_iva,codigo_porcentaje_iva,regla_tributaria_id
    ) values (
      v_comprobante_id,v_producto_id,v_item->>'descripcion',v_cantidad,(v_item->>'precio_unitario')::numeric,
      (v_item->>'descuento')::numeric,(v_item->>'precio_total_sin_impuesto')::numeric,(v_item->>'costo_unitario_momento')::numeric,
      v_item->>'tarifa_iva',(v_item->>'valor_iva')::numeric,nullif(v_item->>'codigo_porcentaje_iva',''),nullif(v_item->>'regla_tributaria_id','')::uuid
    );
    if v_producto_id is not null then
      update productos set stock_actual=stock_actual-v_cantidad where id=v_producto_id and stock_actual>=v_cantidad
      returning stock_actual,costo_promedio into v_stock_resultante,v_costo_promedio;
      if not found then raise exception 'stock_insuficiente:%',v_producto_id; end if;
      insert into movimientos_inventario(emisor_id,producto_id,tipo,cantidad,costo_unitario,saldo_cantidad,saldo_costo_promedio,referencia_tipo,referencia_id)
      values(p_emisor_id,v_producto_id,'salida',v_cantidad,(v_item->>'costo_unitario_momento')::numeric,v_stock_resultante,v_costo_promedio,'comprobante',v_comprobante_id);
    end if;
  end loop;
  for v_pago in select * from jsonb_array_elements(p_pagos) loop
    insert into comprobante_formas_pago(comprobante_id,forma_pago_codigo,valor) values(v_comprobante_id,v_pago->>'forma_pago_codigo',(v_pago->>'valor')::numeric);
  end loop;
  return v_comprobante_id;
end; $$;
