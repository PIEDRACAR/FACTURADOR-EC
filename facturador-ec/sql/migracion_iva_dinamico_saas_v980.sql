-- CONTSERTRIB v9.8.0
-- IVA configurable por emisor/SaaS.
-- Objetivo: no tener porcentajes tributarios críticos "quemados" en el código.
-- La tarifa 15% representa inicialmente la tarifa GENERAL; si la autoridad
-- modifica la tarifa, el proveedor puede cambiarla sin editar el frontend.
-- El código de porcentaje SRI se configura separadamente porque el porcentaje
-- y el código SRI no son la misma cosa.

create table if not exists configuracion_iva (
  emisor_id uuid primary key references emisores(id) on delete cascade,
  tarifa_general numeric(5,2) not null default 15.00,
  codigo_general varchar(10) not null default '4',
  tarifa_reducida numeric(5,2) not null default 5.00,
  codigo_reducida varchar(10) not null default '5',
  tarifa_turismo numeric(5,2) not null default 8.00,
  codigo_turismo varchar(10) not null default '8',
  activo boolean not null default true,
  actualizado_por uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint cfg_iva_general_chk check (tarifa_general >= 0 and tarifa_general <= 100),
  constraint cfg_iva_reducida_chk check (tarifa_reducida >= 0 and tarifa_reducida <= 100),
  constraint cfg_iva_turismo_chk check (tarifa_turismo >= 0 and tarifa_turismo <= 100)
);

create or replace function touch_configuracion_iva() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

drop trigger if exists trg_configuracion_iva_touch on configuracion_iva;
create trigger trg_configuracion_iva_touch
before update on configuracion_iva
for each row execute function touch_configuracion_iva();

insert into configuracion_iva (emisor_id)
select id from emisores
on conflict (emisor_id) do nothing;

alter table if exists cuentas_cliente_saas
  add column if not exists datos_sri jsonb not null default '{}'::jsonb;

create index if not exists idx_cuentas_cliente_saas_ruc_datos
  on cuentas_cliente_saas using gin (datos_sri);

-- Registro histórico/dinámico de impuestos de cada comprobante.
-- Las columnas subtotal_0/subtotal_5/subtotal_8/subtotal_15 se conservan
-- por compatibilidad con reportes existentes.
create table if not exists comprobante_impuestos (
  id uuid primary key default gen_random_uuid(),
  comprobante_id uuid not null references comprobantes(id) on delete cascade,
  codigo_impuesto varchar(5) not null default '2',
  codigo_porcentaje varchar(10) not null,
  tarifa numeric(7,4) not null default 0,
  base_imponible numeric(14,2) not null default 0,
  valor numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  unique (comprobante_id, codigo_impuesto, codigo_porcentaje)
);

create index if not exists idx_comprobante_impuestos_comprobante
  on comprobante_impuestos(comprobante_id);

comment on table configuracion_iva is
'Configuración tributaria editable por emisor. Cambiar aquí la tarifa cuando exista una reforma oficial; no editar código fuente.';
comment on table comprobante_impuestos is
'Detalle dinámico de impuestos para soportar futuras tarifas sin romper comprobantes históricos.';


-- Las tarifas históricas siguen siendo válidas, pero ahora se permiten
-- porcentajes numéricos futuros (por ejemplo, 13.00) sin nueva migración.
alter table productos drop constraint if exists productos_tarifa_iva_check;
alter table productos add constraint productos_tarifa_iva_check
  check (
    tarifa_iva in ('exento','no_objeto')
    or tarifa_iva ~ '^[0-9]+(\.[0-9]+)?$'
    and (tarifa_iva::numeric >= 0 and tarifa_iva::numeric <= 100)
  );

-- Compatibilidad: crea/actualiza la configuración al emitir por primera vez.
-- La función RPC existente sigue recibiendo los cuatro subtotales legacy.
-- El detalle dinámico de impuestos se reconstruye desde comprobante_items.
create or replace function registrar_impuestos_dinamicos_comprobante(p_comprobante_id uuid, p_emisor_id uuid)
returns void
language plpgsql
as $$
declare
  r record;
  cfg record;
  v_codigo text;
  v_tarifa numeric;
begin
  select * into cfg from configuracion_iva where emisor_id = p_emisor_id;
  for r in
    select tarifa_iva, sum(precio_total_sin_impuesto) base, sum(valor_iva) valor
    from comprobante_items
    where comprobante_id = p_comprobante_id
    group by tarifa_iva
  loop
    v_tarifa := case when r.tarifa_iva in ('exento','no_objeto') then 0 else r.tarifa_iva::numeric end;
    v_codigo := case
      when r.tarifa_iva = 'exento' then '7'
      when r.tarifa_iva = 'no_objeto' then '6'
      when cfg is not null and abs(v_tarifa-cfg.tarifa_general) < 0.0001 then cfg.codigo_general
      when cfg is not null and abs(v_tarifa-cfg.tarifa_reducida) < 0.0001 then cfg.codigo_reducida
      when cfg is not null and abs(v_tarifa-cfg.tarifa_turismo) < 0.0001 then cfg.codigo_turismo
      when v_tarifa = 0 then '0'
      else r.tarifa_iva
    end;
    insert into comprobante_impuestos
      (comprobante_id,codigo_impuesto,codigo_porcentaje,tarifa,base_imponible,valor)
    values
      (p_comprobante_id,'2',v_codigo,v_tarifa,r.base,r.valor)
    on conflict (comprobante_id,codigo_impuesto,codigo_porcentaje)
    do update set tarifa=excluded.tarifa,base_imponible=excluded.base_imponible,valor=excluded.valor;
  end loop;
end;
$$;

-- Nota: para que la RPC antigua registre el detalle dinámico, se llama desde
-- la aplicación inmediatamente después de crear la venta. No se toca la firma
-- pública de crear_venta, evitando romper versiones ya desplegadas.
