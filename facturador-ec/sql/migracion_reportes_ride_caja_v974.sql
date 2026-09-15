-- CONTSERTRIB v9.7.4
-- Correcciones de caja, RIDE/PDF y reportes. Ejecutar una sola vez.
-- Corrige el estado de comprobantes autorizado (minúsculas) usado por el cierre de caja.

create or replace function cerrar_caja(p_caja_id uuid, p_efectivo_declarado numeric)
returns table(diferencia numeric, efectivo_esperado numeric)
language plpgsql as $$
declare v_esperado numeric; v_emisor uuid; v_apertura timestamptz;
begin
  select emisor_id, fecha_apertura, monto_inicial into v_emisor, v_apertura, v_esperado
  from cajas where id=p_caja_id and estado='abierta' for update;
  if not found then raise exception 'caja_no_encontrada_o_cerrada'; end if;
  v_esperado := v_esperado + coalesce((
    select sum(cp.valor) from comprobantes cb
    join comprobante_formas_pago cp on cp.comprobante_id=cb.id
    where cb.emisor_id=v_emisor and cb.estado='autorizado'
      and cp.forma_pago_codigo='01' and cb.created_at >= v_apertura and cb.created_at <= now()
  ),0);
  v_esperado := v_esperado + coalesce((
    select sum(case when tipo='ingreso' then monto else -monto end)
    from movimientos_caja m where m.caja_id=p_caja_id and m.forma_pago='01'
  ),0);
  update cajas set fecha_cierre=now(), efectivo_declarado=p_efectivo_declarado,
    diferencia=round(p_efectivo_declarado-v_esperado,2), estado='cerrada'
  where id=p_caja_id;
  return query select round(p_efectivo_declarado-v_esperado,2), round(v_esperado,2);
end;
$$;
