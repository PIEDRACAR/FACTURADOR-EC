-- v9.10.12: roles profesionales, auditoría de descuadres y eliminación segura de asientos manuales.
begin;
create or replace function eliminar_asiento_manual_atomico(p_emisor_id uuid,p_asiento_id uuid)
returns uuid language plpgsql as $$
declare v_tipo text; v_origen uuid; v_fecha date;
begin
 select tipo,origen_id,fecha into v_tipo,v_origen,v_fecha from asientos_contables where id=p_asiento_id and emisor_id=p_emisor_id for update;
 if not found then raise exception 'asiento_no_encontrado'; end if;
 if upper(coalesce(v_tipo,'')) not in ('MANUAL','AJUSTE') or v_origen is not null then raise exception 'asiento_automatico_no_eliminable'; end if;
 if not periodo_contable_abierto(p_emisor_id,v_fecha) then raise exception 'periodo_contable_cerrado:%',to_char(v_fecha,'YYYY-MM'); end if;
 delete from asiento_lineas_contables where asiento_id=p_asiento_id;
 delete from asientos_contables where id=p_asiento_id and emisor_id=p_emisor_id;
 return p_asiento_id;
end; $$;
insert into control_migraciones(version,detalle) values('9.10.12','Nómina con roles PDF/Excel, firmas, auditoría de descuadres y eliminación segura de asientos manuales.') on conflict(version) do update set detalle=excluded.detalle,aplicado_at=now();
notify pgrst,'reload schema';
commit;
