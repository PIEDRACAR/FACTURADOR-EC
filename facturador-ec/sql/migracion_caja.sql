-- Caja: aperturas, movimientos manuales, arqueo y cierre.
create table if not exists cajas (
  id uuid primary key default gen_random_uuid(),
  emisor_id uuid not null references emisores(id) on delete cascade,
  usuario_id uuid,
  fecha_apertura timestamptz not null default now(),
  fecha_cierre timestamptz,
  monto_inicial numeric(14,2) not null default 0 check (monto_inicial >= 0),
  efectivo_declarado numeric(14,2),
  diferencia numeric(14,2),
  estado text not null default 'abierta' check (estado in ('abierta','cerrada')),
  nota text,
  created_at timestamptz not null default now()
);
create unique index if not exists ux_caja_abierta_emisor on cajas(emisor_id) where estado='abierta';
create index if not exists idx_cajas_emisor_fecha on cajas(emisor_id, fecha_apertura desc);

create table if not exists movimientos_caja (
  id uuid primary key default gen_random_uuid(),
  caja_id uuid not null references cajas(id) on delete cascade,
  tipo text not null check (tipo in ('ingreso','egreso')),
  concepto text not null,
  monto numeric(14,2) not null check (monto > 0),
  forma_pago text not null default '01',
  comprobante_id uuid references comprobantes(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_mov_caja_caja_fecha on movimientos_caja(caja_id, created_at desc);

create or replace function cerrar_caja(p_caja_id uuid, p_efectivo_declarado numeric)
returns table(diferencia numeric, efectivo_esperado numeric)
language plpgsql as $$
declare v_esperado numeric; v_emisor uuid; v_apertura timestamptz;
begin
  select emisor_id, fecha_apertura, monto_inicial into v_emisor, v_apertura, v_esperado from cajas where id=p_caja_id and estado='abierta' for update;
  if not found then raise exception 'caja_no_encontrada_o_cerrada'; end if;
  v_esperado := v_esperado + coalesce((select sum(cp.valor) from comprobantes cb join comprobante_formas_pago cp on cp.comprobante_id=cb.id where cb.emisor_id=v_emisor and cb.estado='autorizado' and cp.forma_pago_codigo='01' and cb.created_at >= v_apertura and cb.created_at <= now()),0);
  v_esperado := v_esperado + coalesce((select sum(case when tipo='ingreso' then monto else -monto end) from movimientos_caja m where m.caja_id=p_caja_id and m.forma_pago='01'),0);
  update cajas set fecha_cierre=now(), efectivo_declarado=p_efectivo_declarado, diferencia=round(p_efectivo_declarado-v_esperado,2), estado='cerrada' where id=p_caja_id;
  return query select round(p_efectivo_declarado-v_esperado,2), round(v_esperado,2);
end;
$$;
