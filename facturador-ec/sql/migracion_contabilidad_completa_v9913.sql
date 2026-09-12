-- CONTSERTRIB v9.9.13
-- Reparación integral contabilidad/nómina + edición masiva de plan + pagos.
-- ADITIVA: no elimina datos históricos.
begin;

create table if not exists control_migraciones (
  version varchar(30) primary key,
  detalle text,
  aplicado_at timestamptz not null default now()
);

create table if not exists plan_cuentas_contables (
  id uuid primary key default gen_random_uuid(), emisor_id uuid, codigo varchar(30) not null,
  nombre varchar(180) not null, nivel integer default 1, tipo varchar(20), naturaleza varchar(10),
  acepta_movimientos boolean default true, activa boolean default true, cuenta_padre_id uuid,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create table if not exists asientos_contables (
  id uuid primary key default gen_random_uuid(), emisor_id uuid, fecha date not null, tipo varchar(30) not null,
  concepto varchar(500) not null, referencia varchar(120), origen_tipo varchar(40), origen_id uuid,
  estado varchar(20) default 'CONTABILIZADO', total_debe numeric(14,2) default 0, total_haber numeric(14,2) default 0,
  diferencia numeric(14,2) default 0, created_by uuid, created_at timestamptz default now(), updated_at timestamptz default now()
);
create table if not exists asiento_lineas_contables (
  id uuid primary key default gen_random_uuid(), asiento_id uuid, cuenta_id uuid,
  descripcion varchar(300), debe numeric(14,2) default 0, haber numeric(14,2) default 0,
  tercero_tipo varchar(20), tercero_id uuid, created_at timestamptz default now()
);
create table if not exists periodos_contables (
  id uuid primary key default gen_random_uuid(), emisor_id uuid, periodo char(7), estado varchar(15) default 'ABIERTO',
  cerrado_por uuid, cerrado_at timestamptz, created_at timestamptz default now()
);

alter table plan_cuentas_contables add column if not exists emisor_id uuid;
alter table plan_cuentas_contables add column if not exists codigo varchar(30);
alter table plan_cuentas_contables add column if not exists nombre varchar(180);
alter table plan_cuentas_contables add column if not exists nivel integer default 1;
alter table plan_cuentas_contables add column if not exists tipo varchar(20);
alter table plan_cuentas_contables add column if not exists naturaleza varchar(10);
alter table plan_cuentas_contables add column if not exists acepta_movimientos boolean default true;
alter table plan_cuentas_contables add column if not exists activa boolean default true;
alter table plan_cuentas_contables add column if not exists cuenta_padre_id uuid;
alter table plan_cuentas_contables add column if not exists created_at timestamptz default now();
alter table plan_cuentas_contables add column if not exists updated_at timestamptz default now();
alter table asientos_contables add column if not exists emisor_id uuid;
alter table asientos_contables add column if not exists fecha date;
alter table asientos_contables add column if not exists tipo varchar(30);
alter table asientos_contables add column if not exists concepto varchar(500);
alter table asientos_contables add column if not exists referencia varchar(120);
alter table asientos_contables add column if not exists origen_tipo varchar(40);
alter table asientos_contables add column if not exists origen_id uuid;
alter table asientos_contables add column if not exists estado varchar(20) default 'CONTABILIZADO';
alter table asientos_contables add column if not exists total_debe numeric(14,2) default 0;
alter table asientos_contables add column if not exists total_haber numeric(14,2) default 0;
alter table asientos_contables add column if not exists diferencia numeric(14,2) default 0;
alter table asientos_contables add column if not exists created_by uuid;
alter table asientos_contables add column if not exists created_at timestamptz default now();
alter table asientos_contables add column if not exists updated_at timestamptz default now();
alter table asiento_lineas_contables add column if not exists asiento_id uuid;
alter table asiento_lineas_contables add column if not exists cuenta_id uuid;
alter table asiento_lineas_contables add column if not exists descripcion varchar(300);
alter table asiento_lineas_contables add column if not exists debe numeric(14,2) default 0;
alter table asiento_lineas_contables add column if not exists haber numeric(14,2) default 0;
alter table asiento_lineas_contables add column if not exists tercero_tipo varchar(20);
alter table asiento_lineas_contables add column if not exists tercero_id uuid;
alter table asiento_lineas_contables add column if not exists created_at timestamptz default now();
alter table periodos_contables add column if not exists emisor_id uuid;
alter table periodos_contables add column if not exists periodo char(7);
alter table periodos_contables add column if not exists estado varchar(15) default 'ABIERTO';
alter table periodos_contables add column if not exists cerrado_por uuid;
alter table periodos_contables add column if not exists cerrado_at timestamptz;
alter table periodos_contables add column if not exists created_at timestamptz default now();

-- Nómina: esquema compatible con instalaciones antiguas.
create table if not exists nomina_empleados (
  id uuid primary key default gen_random_uuid(), emisor_id uuid, identificacion varchar(20), nombres varchar(200), cargo varchar(150),
  fecha_ingreso date, fecha_salida date, sueldo_base numeric(14,2) default 0, iess_base numeric(14,2), region varchar(20) default 'COSTA',
  acumula_decimo_tercero boolean default false, acumula_decimo_cuarto boolean default false,
  fondo_reserva_mensual boolean default true, activo boolean default true, extension_conyuge boolean default false,
  porcentaje_extension numeric(6,3) default 0, observaciones text, created_at timestamptz default now(), updated_at timestamptz default now()
);
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
alter table nomina_empleados add column if not exists activo boolean default true;
alter table nomina_empleados add column if not exists extension_conyuge boolean default false;
alter table nomina_empleados add column if not exists porcentaje_extension numeric(6,3) default 0;
alter table nomina_empleados add column if not exists observaciones text;
alter table nomina_empleados add column if not exists created_at timestamptz default now();
alter table nomina_empleados add column if not exists updated_at timestamptz default now();

create table if not exists nomina_periodos (
 id uuid primary key default gen_random_uuid(), emisor_id uuid, periodo char(7), sbu numeric(14,2) default 482,
 iess_personal_pct numeric(8,4) default 9.45, iess_patronal_pct numeric(8,4) default 11.15,
 estado varchar(20) default 'ABIERTO', fecha_pago date, asiento_id uuid, created_at timestamptz default now(), updated_at timestamptz default now()
);
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

create table if not exists nomina_detalles (
 id uuid primary key default gen_random_uuid(), periodo_id uuid, empleado_id uuid, dias_pagados numeric(8,2) default 30,
 sueldo numeric(14,2) default 0, horas_extra numeric(14,2) default 0, comisiones numeric(14,2) default 0, bonificaciones numeric(14,2) default 0,
 otros_ingresos numeric(14,2) default 0, iess_base numeric(14,2) default 0, iess_personal numeric(14,2) default 0, iess_patronal numeric(14,2) default 0,
 decimo_tercero numeric(14,2) default 0, decimo_cuarto numeric(14,2) default 0, vacaciones numeric(14,2) default 0, fondo_reserva numeric(14,2) default 0,
 otras_deducciones numeric(14,2) default 0, neto_pagar numeric(14,2) default 0, costo_empleador numeric(14,2) default 0, asiento_id uuid, created_at timestamptz default now()
);
create table if not exists nomina_pagos (
 id uuid primary key default gen_random_uuid(), emisor_id uuid, periodo_id uuid, empleado_id uuid,
 fecha_pago date not null default current_date, monto numeric(14,2) not null default 0, forma_pago_codigo varchar(10) default '01', referencia varchar(120), asiento_id uuid, created_at timestamptz default now()
);

-- Normalización de nulos para evitar errores de esquema/validación.
update nomina_empleados set activo=true where activo is null;
update nomina_empleados set fondo_reserva_mensual=true where fondo_reserva_mensual is null;
update nomina_empleados set extension_conyuge=false where extension_conyuge is null;
update nomina_empleados set porcentaje_extension=0 where porcentaje_extension is null;
update nomina_periodos set sbu=482 where sbu is null;
update nomina_periodos set iess_personal_pct=9.45 where iess_personal_pct is null;
update nomina_periodos set iess_patronal_pct=11.15 where iess_patronal_pct is null;

-- Relaciones e índices solo si faltan.
do $$ begin
 if not exists(select 1 from pg_constraint where conname='fk_nc_emisor_9913' and conrelid='nomina_empleados'::regclass) then alter table nomina_empleados add constraint fk_nc_emisor_9913 foreign key(emisor_id) references emisores(id) on delete cascade; end if;
 if not exists(select 1 from pg_constraint where conname='fk_np_emisor_9913' and conrelid='nomina_periodos'::regclass) then alter table nomina_periodos add constraint fk_np_emisor_9913 foreign key(emisor_id) references emisores(id) on delete cascade; end if;
 if not exists(select 1 from pg_constraint where conname='fk_nd_periodo_9913' and conrelid='nomina_detalles'::regclass) then alter table nomina_detalles add constraint fk_nd_periodo_9913 foreign key(periodo_id) references nomina_periodos(id) on delete cascade; end if;
 if not exists(select 1 from pg_constraint where conname='fk_nd_empleado_9913' and conrelid='nomina_detalles'::regclass) then alter table nomina_detalles add constraint fk_nd_empleado_9913 foreign key(empleado_id) references nomina_empleados(id) on delete restrict; end if;
 if not exists(select 1 from pg_constraint where conname='fk_npago_emisor_9913' and conrelid='nomina_pagos'::regclass) then alter table nomina_pagos add constraint fk_npago_emisor_9913 foreign key(emisor_id) references emisores(id) on delete cascade; end if;
end $$;

create unique index if not exists ux_nomina_emp_emisor_ident_9913 on nomina_empleados(emisor_id,identificacion) where identificacion is not null;
create unique index if not exists ux_nomina_periodo_emisor_periodo_9913 on nomina_periodos(emisor_id,periodo) where emisor_id is not null and periodo is not null;
create unique index if not exists ux_nomina_detalle_periodo_emp_9913 on nomina_detalles(periodo_id,empleado_id);
create index if not exists idx_nomina_pago_emisor_periodo_9913 on nomina_pagos(emisor_id,periodo_id,fecha_pago);
create index if not exists idx_nc_emisor_activo_9913 on nomina_empleados(emisor_id,activo,nombres);

-- Plan Ecuador: estructura base alineada con el catálogo de cuentas utilizado por la SCVS para información financiera; se mantiene además el plan operativo interno CONTSERTRIB.
insert into plan_cuentas_contables(emisor_id,codigo,nombre,nivel,tipo,naturaleza,acepta_movimientos,activa)
select e.id,v.codigo,v.nombre,v.nivel,v.tipo,v.naturaleza,v.acepta,true from emisores e cross join (values
('1','ACTIVO',1,'ACTIVO','DEUDORA',false),('101','ACTIVO CORRIENTE',2,'ACTIVO','DEUDORA',false),('10101','EFECTIVO Y EQUIVALENTES AL EFECTIVO',3,'ACTIVO','DEUDORA',false),('1010101','CAJA',4,'ACTIVO','DEUDORA',true),('1010102','BANCOS',4,'ACTIVO','DEUDORA',true),('10102','ACTIVOS FINANCIEROS',3,'ACTIVO','DEUDORA',false),('10103','CUENTAS Y DOCUMENTOS POR COBRAR',3,'ACTIVO','DEUDORA',false),('1010301','CLIENTES',4,'ACTIVO','DEUDORA',true),('10104','INVENTARIOS',3,'ACTIVO','DEUDORA',false),('1010401','INVENTARIO DE MERCADERÍAS',4,'ACTIVO','DEUDORA',true),('10201','PROPIEDADES, PLANTA Y EQUIPO',3,'ACTIVO','DEUDORA',false),('1020101','TERRENOS',4,'ACTIVO','DEUDORA',true),('1020102','EDIFICIOS',4,'ACTIVO','DEUDORA',true),('1020103','MUEBLES Y ENSERES',4,'ACTIVO','DEUDORA',true),('1020104','EQUIPOS DE COMPUTACIÓN',4,'ACTIVO','DEUDORA',true),('2','PASIVO',1,'PASIVO','ACREEDORA',false),('201','PASIVO CORRIENTE',2,'PASIVO','ACREEDORA',false),('20103','CUENTAS Y DOCUMENTOS POR PAGAR',3,'PASIVO','ACREEDORA',false),('2010301','PROVEEDORES',4,'PASIVO','ACREEDORA',true),('20107','OBLIGACIONES CON EMPLEADOS',3,'PASIVO','ACREEDORA',false),('2010701','SUELDOS POR PAGAR',4,'PASIVO','ACREEDORA',true),('2010702','IESS POR PAGAR',4,'PASIVO','ACREEDORA',true),('2010703','BENEFICIOS SOCIALES POR PAGAR',4,'PASIVO','ACREEDORA',true),('3','PATRIMONIO',1,'PATRIMONIO','ACREEDORA',false),('301','CAPITAL',2,'PATRIMONIO','ACREEDORA',false),('30101','CAPITAL SUSCRITO O ASIGNADO',3,'PATRIMONIO','ACREEDORA',true),('306','RESULTADOS ACUMULADOS',2,'PATRIMONIO','ACREEDORA',false),('30601','RESULTADOS ACUMULADOS',3,'PATRIMONIO','ACREEDORA',true),('4','INGRESOS',1,'INGRESO','ACREEDORA',false),('41','INGRESOS DE ACTIVIDADES ORDINARIAS',2,'INGRESO','ACREEDORA',false),('4101','VENTAS',3,'INGRESO','ACREEDORA',true),('5','COSTOS Y GASTOS',1,'GASTO','DEUDORA',false),('51','COSTO DE VENTAS',2,'COSTO','DEUDORA',false),('5101','COSTO DE VENTAS',3,'COSTO','DEUDORA',true),('52','GASTOS',2,'GASTO','DEUDORA',false),('5201','SUELDOS Y SALARIOS',3,'GASTO','DEUDORA',true),('5202','APORTE PATRONAL IESS',3,'GASTO','DEUDORA',true),('5203','BENEFICIOS SOCIALES',3,'GASTO','DEUDORA',true)
) v(codigo,nombre,nivel,tipo,naturaleza,acepta) on conflict(emisor_id,codigo) do update set nombre=excluded.nombre,nivel=excluded.nivel,tipo=excluded.tipo,naturaleza=excluded.naturaleza,acepta_movimientos=excluded.acepta_movimientos,activa=true;

notify pgrst, 'reload schema';
insert into control_migraciones(version,detalle) values('9.9.13','Reparación integral contabilidad y nómina, plan Ecuador editable y pagos de nómina.') on conflict(version) do update set detalle=excluded.detalle, aplicado_at=now();
commit;
