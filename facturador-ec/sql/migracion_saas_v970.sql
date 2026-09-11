-- CONTSERTRIB v9.7.0
-- SaaS multi-RUC, planes por límites, establecimientos/puntos y ATS.
-- Ejecutar en Supabase SQL Editor.

alter table if exists planes_suscripcion
  add column if not exists max_documentos_mes integer,
  add column if not exists max_contribuyentes integer not null default 1,
  add column if not exists max_establecimientos integer not null default 1,
  add column if not exists max_puntos_emision integer not null default 1,
  add column if not exists max_usuarios integer not null default 2,
  add column if not exists incluye_inventario boolean not null default false,
  add column if not exists incluye_ats boolean not null default false,
  add column if not exists incluye_carga_electronica boolean not null default false,
  add column if not exists incluye_reportes_avanzados boolean not null default false,
  add column if not exists descripcion_comercial text;

create table if not exists cuentas_cliente_saas (
  id uuid primary key default gen_random_uuid(),
  nombre varchar(200) not null,
  email_admin varchar(320),
  admin_user_id uuid references auth.users(id) on delete set null,
  plan_id uuid references planes_suscripcion(id),
  estado varchar(20) not null default 'activa' check (estado in ('activa','suspendida','eliminada')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_cuentas_cliente_saas_estado on cuentas_cliente_saas(estado);
create index if not exists idx_cuentas_cliente_saas_admin on cuentas_cliente_saas(admin_user_id);

create table if not exists contribuyentes_cliente_saas (
  id uuid primary key default gen_random_uuid(),
  cuenta_id uuid not null references cuentas_cliente_saas(id) on delete cascade,
  emisor_id uuid not null references emisores(id) on delete cascade,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (cuenta_id, emisor_id),
  unique (emisor_id)
);
create index if not exists idx_contribuyentes_cliente_saas_cuenta on contribuyentes_cliente_saas(cuenta_id, activo);

alter table if exists suscripciones
  add column if not exists cuenta_id uuid references cuentas_cliente_saas(id) on delete set null;
create index if not exists idx_suscripciones_cuenta on suscripciones(cuenta_id);

-- Planes comerciales iniciales basados en la estructura solicitada. Los precios y
-- límites quedan editables desde /admin-proveedor.
insert into planes_suscripcion
  (codigo,nombre,descripcion,precio_mensual,orden,activo,max_documentos_mes,max_contribuyentes,max_establecimientos,max_puntos_emision,max_usuarios,incluye_inventario,incluye_ats,incluye_carga_electronica,incluye_reportes_avanzados,descripcion_comercial)
values
  ('BASICO_50','Básico 50','Facturación electrónica para pequeños negocios.',10.50,10,true,50,1,1,1,2,false,false,false,false,'50 documentos mensuales'),
  ('BASICO_100','Básico 100','Facturación electrónica para pequeños negocios.',15.50,11,true,100,1,1,1,2,false,false,false,false,'100 documentos mensuales'),
  ('BASICO_250','Básico 250','Facturación electrónica para pequeños negocios.',25.50,12,true,250,1,2,2,3,false,false,false,false,'250 documentos mensuales'),
  ('BASICO_500','Básico 500','Facturación electrónica para pequeños negocios.',46.00,13,true,500,1,3,3,4,false,false,false,false,'500 documentos mensuales'),
  ('EXPRESS_50','Express 50','Facturación + inventario + ATS + herramientas avanzadas.',25.50,20,true,50,5,5,10,10,true,true,true,true,'50 documentos mensuales'),
  ('EXPRESS_100','Express 100','Facturación + inventario + ATS + herramientas avanzadas.',35.50,21,true,100,5,10,20,15,true,true,true,true,'100 documentos mensuales'),
  ('EXPRESS_250','Express 250','Facturación + inventario + ATS + herramientas avanzadas.',51.00,22,true,250,10,15,30,20,true,true,true,true,'250 documentos mensuales'),
  ('EXPRESS_500','Express 500','Facturación + inventario + ATS + herramientas avanzadas.',71.00,23,true,500,10,20,40,25,true,true,true,true,'500 documentos mensuales'),
  ('EXPRESS_ILIMITADO','Express Ilimitado','Facturación ilimitada + inventario + ATS + herramientas avanzadas.',100.00,24,true,null,25,50,100,50,true,true,true,true,'Documentos ilimitados')
on conflict (codigo) do update set
  nombre=excluded.nombre,
  descripcion=excluded.descripcion,
  precio_mensual=excluded.precio_mensual,
  orden=excluded.orden,
  activo=excluded.activo,
  max_documentos_mes=excluded.max_documentos_mes,
  max_contribuyentes=excluded.max_contribuyentes,
  max_establecimientos=excluded.max_establecimientos,
  max_puntos_emision=excluded.max_puntos_emision,
  max_usuarios=excluded.max_usuarios,
  incluye_inventario=excluded.incluye_inventario,
  incluye_ats=excluded.incluye_ats,
  incluye_carga_electronica=excluded.incluye_carga_electronica,
  incluye_reportes_avanzados=excluded.incluye_reportes_avanzados,
  descripcion_comercial=excluded.descripcion_comercial,
  updated_at=now();

-- Los planes históricos conservan compatibilidad pero reciben límites seguros.
update planes_suscripcion
set max_documentos_mes=coalesce(max_documentos_mes,500),
    max_contribuyentes=coalesce(max_contribuyentes,1),
    max_establecimientos=coalesce(max_establecimientos,3),
    max_puntos_emision=coalesce(max_puntos_emision,3),
    max_usuarios=coalesce(max_usuarios,5),
    incluye_inventario=coalesce(incluye_inventario,false),
    incluye_ats=coalesce(incluye_ats,false),
    incluye_carga_electronica=coalesce(incluye_carga_electronica,false),
    incluye_reportes_avanzados=coalesce(incluye_reportes_avanzados,false)
where max_documentos_mes is null;

-- Crea una cuenta SaaS independiente por cada emisor histórico y lo vincula como
-- su único contribuyente. No elimina ni modifica documentos existentes.
do $$
declare
  r record;
  v_cuenta uuid;
  v_plan uuid;
  v_email text;
  v_user uuid;
begin
  for r in select e.id,e.razon_social,e.ruc from emisores e
  where not exists (select 1 from contribuyentes_cliente_saas c where c.emisor_id=e.id)
  loop
    select id into v_plan from planes_suscripcion where codigo='BASICO_500' limit 1;
    select u.user_id into v_user from usuarios_emisor u where u.emisor_id=r.id and u.rol='admin' order by u.user_id limit 1;
    if v_user is not null then
      select email into v_email from auth.users where id=v_user;
    end if;
    insert into cuentas_cliente_saas(nombre,email_admin,admin_user_id,plan_id,estado)
    values(r.razon_social, v_email, v_user, v_plan, 'activa')
    returning id into v_cuenta;
    insert into contribuyentes_cliente_saas(cuenta_id,emisor_id,activo) values(v_cuenta,r.id,true);
    update suscripciones set cuenta_id=v_cuenta where emisor_id=r.id and cuenta_id is null;
  end loop;
end $$;

-- Registros de compras/retenciones que no provienen directamente de una factura
-- emitida por CONTSERTRIB. Se utilizan como fuente estructurada para ATS.
create table if not exists ats_compras (
  id uuid primary key default gen_random_uuid(),
  emisor_id uuid not null references emisores(id) on delete cascade,
  cod_sustento varchar(2) not null default '01',
  tipo_id_prov varchar(2) not null default '04',
  id_prov varchar(13) not null,
  razon_social_prov varchar(300),
  tipo_comprobante varchar(2) not null default '01',
  parte_rel varchar(2) not null default 'NO',
  establecimiento varchar(3) not null default '001',
  punto_emision varchar(3) not null default '001',
  secuencial varchar(9) not null,
  autorizacion varchar(49),
  fecha_emision date not null,
  base_no_objeto numeric(14,2) not null default 0,
  base_iva_0 numeric(14,2) not null default 0,
  base_iva_diferente_0 numeric(14,2) not null default 0,
  base_exenta numeric(14,2) not null default 0,
  monto_iva numeric(14,2) not null default 0,
  monto_ice numeric(14,2) not null default 0,
  valor_ret_iva numeric(14,2) not null default 0,
  valor_ret_renta numeric(14,2) not null default 0,
  forma_pago varchar(2),
  fuente varchar(20) not null default 'manual',
  observacion text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ats_compras_bases_chk check ((base_no_objeto + base_iva_0 + base_iva_diferente_0 + base_exenta) > 0)
);
create index if not exists idx_ats_compras_emisor_fecha on ats_compras(emisor_id,fecha_emision);

create table if not exists ats_retenciones (
  id uuid primary key default gen_random_uuid(),
  emisor_id uuid not null references emisores(id) on delete cascade,
  tipo_id_sujeto varchar(2) not null default '04',
  id_sujeto varchar(13) not null,
  razon_social_sujeto varchar(300),
  establecimiento varchar(3) not null default '001',
  punto_emision varchar(3) not null default '001',
  secuencial varchar(9) not null,
  autorizacion varchar(49),
  fecha_emision date not null,
  cod_concepto_renta varchar(10),
  base_imponible_renta numeric(14,2) not null default 0,
  porcentaje_renta numeric(8,4),
  valor_ret_renta numeric(14,2) not null default 0,
  valor_ret_iva numeric(14,2) not null default 0,
  forma_pago varchar(2),
  fuente varchar(20) not null default 'manual',
  observacion text,
  created_at timestamptz not null default now()
);
create index if not exists idx_ats_retenciones_emisor_fecha on ats_retenciones(emisor_id,fecha_emision);

create table if not exists ats_generaciones (
  id uuid primary key default gen_random_uuid(),
  emisor_id uuid not null references emisores(id) on delete cascade,
  anio integer not null,
  mes integer not null,
  estado varchar(20) not null default 'generado' check (estado in ('generado','validado','observado')),
  total_ventas numeric(14,2) not null default 0,
  total_compras numeric(14,2) not null default 0,
  xml text not null,
  advertencias jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique(emisor_id,anio,mes)
);
create index if not exists idx_ats_generaciones_emisor_periodo on ats_generaciones(emisor_id,anio,mes);
