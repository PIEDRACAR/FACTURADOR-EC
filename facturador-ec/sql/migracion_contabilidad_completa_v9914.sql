begin;
-- CONTSERTRIB v9.9.14 — reparación integral de esquema, unicidad y nómina.
-- No elimina comprobantes, asientos, clientes ni proveedores.

-- Plan contable: limpiar duplicados antes de crear unicidad requerida por upsert/importación.
do $$ begin
  if to_regclass('public.plan_cuentas_contables') is not null then
    delete from plan_cuentas_contables a using plan_cuentas_contables b
    where a.emisor_id=b.emisor_id and a.codigo=b.codigo and a.id>b.id;
  end if;
end $$;
create unique index if not exists ux_plan_cuentas_emisor_codigo_9914 on plan_cuentas_contables(emisor_id,codigo);

-- Clientes: permitir consulta/registro masivo y upsert seguro.
do $$ begin
  if to_regclass('public.clientes') is not null then
    delete from clientes a using clientes b
    where a.emisor_id=b.emisor_id and a.tipo_identificacion=b.tipo_identificacion and a.identificacion=b.identificacion and a.id>b.id;
  end if;
end $$;
create unique index if not exists ux_clientes_emisor_tipo_ident_9914 on clientes(emisor_id,tipo_identificacion,identificacion);

-- Proveedores ya tienen unique en la migración original; se garantiza por índice si faltara.
do $$ begin
  if to_regclass('public.proveedores') is not null then
    delete from proveedores a using proveedores b
    where a.emisor_id=b.emisor_id and a.tipo_identificacion=b.tipo_identificacion and a.identificacion=b.identificacion and a.id>b.id;
  end if;
end $$;
create unique index if not exists ux_proveedores_emisor_tipo_ident_9914 on proveedores(emisor_id,tipo_identificacion,identificacion);

-- Nómina: completar esquema real existente.
create table if not exists nomina_empleados(
 id uuid primary key default gen_random_uuid(), emisor_id uuid, identificacion varchar(20), nombres varchar(200), cargo varchar(150),
 fecha_ingreso date, fecha_salida date, sueldo_base numeric(14,2) default 0, iess_base numeric(14,2), region varchar(20) default 'COSTA',
 acumula_decimo_tercero boolean default false, acumula_decimo_cuarto boolean default false, fondo_reserva_mensual boolean default true,
 extension_conyuge boolean default false, porcentaje_extension numeric(6,3) default 0, observaciones text, activo boolean default true,
 created_at timestamptz default now(), updated_at timestamptz default now());
alter table nomina_empleados add column if not exists emisor_id uuid;
alter table nomina_empleados add column if not exists identificacion varchar(20);
alter table nomina_empleados add column if not exists nombres varchar(200);
alter table nomina_empleados add column if not exists cargo varchar(150);
alter table nomina_empleados add column if not exists fecha_ingreso date;
alter table nomina_empleados add column if not exists fecha_salida date;
alter table nomina_empleados add column if not exists sueldo_base numeric(14,2) default 0;
alter table nomina_empleados add column if not exists iess_base numeric(14,2);
alter table nomina_empleados add column if not exists region varchar(20) default 'COSTA';
alter table nomina_empleados add column if not exists acumula_decimo_tercero boolean default false;
alter table nomina_empleados add column if not exists acumula_decimo_cuarto boolean default false;
alter table nomina_empleados add column if not exists fondo_reserva_mensual boolean default true;
alter table nomina_empleados add column if not exists extension_conyuge boolean default false;
alter table nomina_empleados add column if not exists porcentaje_extension numeric(6,3) default 0;
alter table nomina_empleados add column if not exists observaciones text;
alter table nomina_empleados add column if not exists activo boolean default true;
alter table nomina_empleados add column if not exists created_at timestamptz default now();
alter table nomina_empleados add column if not exists updated_at timestamptz default now();
update nomina_empleados set activo=true where activo is null;
update nomina_empleados set fondo_reserva_mensual=true where fondo_reserva_mensual is null;
update nomina_empleados set extension_conyuge=false where extension_conyuge is null;
update nomina_empleados set porcentaje_extension=0 where porcentaje_extension is null;

-- Si hay duplicados históricos, conserva el registro más antiguo.
do $$ begin
 if to_regclass('public.nomina_empleados') is not null then
  delete from nomina_empleados a using nomina_empleados b
  where a.emisor_id=b.emisor_id and a.identificacion=b.identificacion and a.id>b.id;
 end if;
end $$;
create unique index if not exists ux_nomina_emp_emisor_ident_9914 on nomina_empleados(emisor_id,identificacion);

create table if not exists nomina_periodos(id uuid primary key default gen_random_uuid(),emisor_id uuid,periodo char(7),sbu numeric(14,2) default 482,iess_personal_pct numeric(8,4) default 9.45,iess_patronal_pct numeric(8,4) default 11.15,estado varchar(20) default 'ABIERTO',fecha_pago date,asiento_id uuid,created_at timestamptz default now(),updated_at timestamptz default now());
alter table nomina_periodos add column if not exists emisor_id uuid;
alter table nomina_periodos add column if not exists periodo char(7);
alter table nomina_periodos add column if not exists sbu numeric(14,2) default 482;
alter table nomina_periodos add column if not exists iess_personal_pct numeric(8,4) default 9.45;
alter table nomina_periodos add column if not exists iess_patronal_pct numeric(8,4) default 11.15;
alter table nomina_periodos add column if not exists estado varchar(20) default 'ABIERTO';
alter table nomina_periodos add column if not exists fecha_pago date;
alter table nomina_periodos add column if not exists asiento_id uuid;
alter table nomina_periodos add column if not exists created_at timestamptz default now();
alter table nomina_periodos add column if not exists updated_at timestamptz default now();
do $$ begin
 if to_regclass('public.nomina_periodos') is not null then
  delete from nomina_periodos a using nomina_periodos b where a.emisor_id=b.emisor_id and a.periodo=b.periodo and a.id>b.id;
 end if;
end $$;
create unique index if not exists ux_nomina_periodo_emisor_periodo_9914 on nomina_periodos(emisor_id,periodo);

create table if not exists nomina_detalles(id uuid primary key default gen_random_uuid(),periodo_id uuid,empleado_id uuid,dias_pagados numeric(8,2) default 30,sueldo numeric(14,2) default 0,horas_extra numeric(14,2) default 0,comisiones numeric(14,2) default 0,bonificaciones numeric(14,2) default 0,otros_ingresos numeric(14,2) default 0,iess_base numeric(14,2) default 0,iess_personal numeric(14,2) default 0,iess_patronal numeric(14,2) default 0,decimo_tercero numeric(14,2) default 0,decimo_cuarto numeric(14,2) default 0,vacaciones numeric(14,2) default 0,fondo_reserva numeric(14,2) default 0,otras_deducciones numeric(14,2) default 0,neto_pagar numeric(14,2) default 0,costo_empleador numeric(14,2) default 0,asiento_id uuid,created_at timestamptz default now());
alter table nomina_detalles add column if not exists periodo_id uuid;
alter table nomina_detalles add column if not exists empleado_id uuid;
create unique index if not exists ux_nomina_detalle_periodo_emp_9914 on nomina_detalles(periodo_id,empleado_id);

create table if not exists nomina_pagos(id uuid primary key default gen_random_uuid(),emisor_id uuid,periodo_id uuid,empleado_id uuid,fecha_pago date not null default current_date,monto numeric(14,2) not null default 0,forma_pago_codigo varchar(10) default '01',referencia varchar(120),asiento_id uuid,created_at timestamptz default now());
alter table nomina_pagos add column if not exists emisor_id uuid;
alter table nomina_pagos add column if not exists periodo_id uuid;
alter table nomina_pagos add column if not exists empleado_id uuid;
alter table nomina_pagos add column if not exists fecha_pago date default current_date;
alter table nomina_pagos add column if not exists monto numeric(14,2) default 0;
alter table nomina_pagos add column if not exists forma_pago_codigo varchar(10) default '01';
alter table nomina_pagos add column if not exists referencia varchar(120);
alter table nomina_pagos add column if not exists asiento_id uuid;
alter table nomina_pagos add column if not exists created_at timestamptz default now();

notify pgrst,'reload schema';
insert into control_migraciones(version,detalle) values('9.9.14','Unicidad robusta, reparación de nómina, clientes/proveedores y soporte de negocio activo.') on conflict(version) do update set detalle=excluded.detalle,aplicado_at=now();
commit;
