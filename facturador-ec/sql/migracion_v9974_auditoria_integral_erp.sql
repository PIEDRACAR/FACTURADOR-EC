-- CONTSERTRIB v9.9.74 — Auditoría integral ERP / Contabilidad / Seguridad
-- ADITIVA E IDEMPOTENTE. No elimina comprobantes, inventario, usuarios ni asientos.
-- Ejecutar una sola vez después de las migraciones existentes.

begin;

-- 1) Cuentas necesarias para una contabilidad comercial más correcta.
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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(emisor_id,codigo)
);

insert into plan_cuentas_contables(emisor_id,codigo,nombre,nivel,tipo,naturaleza,acepta_movimientos,activa)
select e.id,v.codigo,v.nombre,4,v.tipo,v.naturaleza,true,true
from emisores e
cross join (values
  ('1.1.01.03','CUENTAS POR COBRAR MEDIOS ELECTRÓNICOS','ACTIVO','DEUDORA'),
  ('2.1.05.01','PROPINAS POR PAGAR','PASIVO','ACREEDORA')
) v(codigo,nombre,tipo,naturaleza)
on conflict(emisor_id,codigo) do update set
  nombre=excluded.nombre,
  tipo=excluded.tipo,
  naturaleza=excluded.naturaleza,
  acepta_movimientos=true,
  activa=true,
  updated_at=now();

-- 2) El código principal de producto no debe permitir valores que el SRI
-- no puede recibir en <codigoPrincipal>. No truncamos códigos silenciosamente.
do $$
begin
  alter table productos drop constraint if exists productos_codigo_principal_max25;
  alter table productos add constraint productos_codigo_principal_max25
    check (char_length(coalesce(codigo_principal,'')) between 1 and 25) not valid;
exception when undefined_table then null;
end $$;

-- 3) Índices de rendimiento para multiempresa y trazabilidad.
create index if not exists idx_comprobantes_emisor_estado_fecha
  on comprobantes(emisor_id,estado,created_at desc);
create index if not exists idx_documentos_sri_emisor_estado_fecha
  on documentos_sri_borrador(emisor_id,estado,created_at desc);
create index if not exists idx_clientes_emisor_identificacion
  on clientes(emisor_id,tipo_identificacion,identificacion);
create index if not exists idx_proveedores_emisor_identificacion
  on proveedores(emisor_id,tipo_identificacion,identificacion);
create index if not exists idx_productos_emisor_codigo
  on productos(emisor_id,codigo_principal);
create index if not exists idx_nomina_empleados_emisor_activo
  on nomina_empleados(emisor_id,activo,nombres);

-- 4) Compatibilidad: updated_at en certificados. El código actual no depende
-- de esta columna, pero mantenerla disponible evita incompatibilidades con
-- herramientas administrativas y futuras migraciones.
do $$
begin
  if to_regclass('public.certificados') is not null then
    alter table certificados add column if not exists updated_at timestamptz default now();
    update certificados set updated_at=coalesce(updated_at,created_at,now()) where updated_at is null;
  end if;
end $$;

-- 5) Evitar pagos duplicados por reintentos del navegador / PayPhone.
create unique index if not exists ux_pagos_solicitud_client_tx
  on pagos_solicitud_saas(client_transaction_id)
  where client_transaction_id is not null;

-- 6) Un único punto activo por combinación establecimiento/punto dentro del RUC.
create unique index if not exists ux_punto_emision_emisor_est_punto_activo
  on puntos_emision(emisor_id,establecimiento,punto_emision)
  where activo=true;

-- 7) Registro de auditoría de versión.
insert into control_migraciones(version,detalle)
values('9.9.74','Auditoría integral: seguridad multiempresa, cuentas contables de medios electrónicos/propinas, límite XSD de código de producto, índices y compatibilidad certificados.')
on conflict(version) do update set detalle=excluded.detalle;

-- 8) CxP/CxC: devolver el ID exacto del pago creado para evitar que dos
-- usuarios simultáneos terminen contabilizando el pago equivocado.
drop function if exists registrar_pago_cuenta_por_pagar(uuid,numeric,text,text);
drop function if exists registrar_pago_cuenta_por_cobrar(uuid,numeric,text,text);

create or replace function registrar_pago_cuenta_por_pagar(
  p_cuenta_id uuid, p_monto numeric, p_forma_pago_codigo text, p_nota text
) returns table(pago_id uuid,monto_pagado_resultante numeric,saldo_resultante numeric,estado_resultante text)
language plpgsql as $$
declare
  v_monto_total numeric; v_monto_pagado numeric; v_nuevo_pagado numeric; v_nuevo_estado text; v_pago_id uuid;
begin
  if p_monto is null or p_monto <= 0 then raise exception 'monto_invalido'; end if;
  select monto_total, monto_pagado into v_monto_total, v_monto_pagado from cuentas_por_pagar where id=p_cuenta_id for update;
  if not found then raise exception 'cuenta_no_encontrada:%',p_cuenta_id; end if;
  v_nuevo_pagado:=round((coalesce(v_monto_pagado,0)+p_monto)::numeric,2);
  if v_nuevo_pagado>v_monto_total+0.01 then raise exception 'monto_excede_saldo:el pago supera el saldo pendiente'; end if;
  v_nuevo_estado:=case when v_nuevo_pagado>=v_monto_total-0.01 then 'pagada' else 'pendiente' end;
  update cuentas_por_pagar set monto_pagado=v_nuevo_pagado,estado=v_nuevo_estado where id=p_cuenta_id;
  insert into pagos_cuentas_por_pagar(cuenta_id,monto,forma_pago_codigo,nota) values(p_cuenta_id,p_monto,p_forma_pago_codigo,p_nota) returning id into v_pago_id;
  return query select v_pago_id,v_nuevo_pagado,round((v_monto_total-v_nuevo_pagado)::numeric,2),v_nuevo_estado;
end; $$;

create or replace function registrar_pago_cuenta_por_cobrar(
  p_cuenta_id uuid, p_monto numeric, p_forma_pago_codigo text, p_nota text
) returns table(pago_id uuid,monto_cobrado_resultante numeric,saldo_resultante numeric,estado_resultante text)
language plpgsql as $$
declare
  v_monto_total numeric; v_monto_cobrado numeric; v_nuevo_cobrado numeric; v_nuevo_estado text; v_pago_id uuid;
begin
  if p_monto is null or p_monto <= 0 then raise exception 'monto_invalido'; end if;
  select monto_total, monto_cobrado into v_monto_total, v_monto_cobrado from cuentas_por_cobrar where id=p_cuenta_id for update;
  if not found then raise exception 'cuenta_no_encontrada:%',p_cuenta_id; end if;
  v_nuevo_cobrado:=round((coalesce(v_monto_cobrado,0)+p_monto)::numeric,2);
  if v_nuevo_cobrado>v_monto_total+0.01 then raise exception 'monto_excede_saldo:el cobro supera el saldo pendiente'; end if;
  v_nuevo_estado:=case when v_nuevo_cobrado>=v_monto_total-0.01 then 'cobrada' else 'pendiente' end;
  update cuentas_por_cobrar set monto_cobrado=v_nuevo_cobrado,estado=v_nuevo_estado where id=p_cuenta_id;
  insert into pagos_cuentas_por_cobrar(cuenta_id,monto,forma_pago_codigo,nota) values(p_cuenta_id,p_monto,p_forma_pago_codigo,p_nota) returning id into v_pago_id;
  return query select v_pago_id,v_nuevo_cobrado,round((v_monto_total-v_nuevo_cobrado)::numeric,2),v_nuevo_estado;
end; $$;

-- Re-registra la versión después de incluir las funciones de pagos.
update control_migraciones set detalle='Auditoría integral + seguridad multiempresa + contabilidad de medios electrónicos/propinas + validación XSD de códigos + pagos CxP/CxC atómicos con ID exacto.' where version='9.9.74';

commit;
