begin;
-- CONTSERTRIB v9.9.90 — reparación de compatibilidad de nómina y contabilidad automática.
-- ADITIVA/SEGURA: no elimina empleados, comprobantes, asientos ni movimientos.

-- 1) Instalaciones antiguas podían conservar empresa_id en nomina_empleados con una FK
--    que apunta a una tabla distinta del modelo actual (multiempresa por emisor_id).
--    La aplicación actual NO utiliza empresa_id. Lo dejamos nullable y retiramos
--    únicamente la FK heredada para que no vuelva a bloquear altas/importaciones.
do $$
declare
  r record;
begin
  if to_regclass('public.nomina_empleados') is not null then
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='nomina_empleados' and column_name='empresa_id') then
      execute 'alter table public.nomina_empleados alter column empresa_id drop not null';
      for r in
        select tc.constraint_name
        from information_schema.table_constraints tc
        join information_schema.constraint_column_usage ccu
          on ccu.constraint_schema=tc.constraint_schema and ccu.constraint_name=tc.constraint_name
        where tc.table_schema='public'
          and tc.table_name='nomina_empleados'
          and tc.constraint_type='FOREIGN KEY'
          and ccu.column_name='id'
          and exists (
            select 1 from information_schema.key_column_usage kcu
            where kcu.constraint_schema=tc.constraint_schema
              and kcu.constraint_name=tc.constraint_name
              and kcu.table_name='nomina_empleados'
              and kcu.column_name='empresa_id'
          )
      loop
        execute format('alter table public.nomina_empleados drop constraint if exists %I', r.constraint_name);
      end loop;
    end if;
  end if;
end $$;

-- 2) Integridad del modelo actual: cada empleado queda ligado al emisor activo.
do $$
begin
  if to_regclass('public.nomina_empleados') is not null and to_regclass('public.emisores') is not null then
    if not exists (
      select 1 from information_schema.table_constraints
      where table_schema='public' and table_name='nomina_empleados'
        and constraint_name='nomina_empleados_emisor_id_fkey'
    ) then
      alter table public.nomina_empleados
        add constraint nomina_empleados_emisor_id_fkey
        foreign key (emisor_id) references public.emisores(id) on delete cascade;
    end if;
  end if;
exception when duplicate_object then null;
end $$;

create index if not exists idx_nomina_empleados_emisor_99190 on public.nomina_empleados(emisor_id);

-- 3) Índices para conciliación/reconciliación automática de contabilidad.
create index if not exists idx_asientos_origen_99190 on public.asientos_contables(emisor_id,origen_tipo,origen_id);
create index if not exists idx_comprobantes_contab_99190 on public.comprobantes(emisor_id,estado,tipo,created_at);

notify pgrst,'reload schema';

insert into control_migraciones(version,detalle)
values('9.9.90','Reparación de FK heredada de nómina y optimización para sincronización contable automática.')
on conflict(version) do update set detalle=excluded.detalle, aplicado_at=now();
commit;
