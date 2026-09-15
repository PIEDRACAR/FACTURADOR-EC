-- v9.9.97 — Ticket POS interno integrado
-- ADITIVA: no elimina datos ni comprobantes históricos.
-- El ticket NO es comprobante electrónico SRI. Se registra internamente
-- para POS/caja/inventario/contabilidad y no genera XML, RIDE ni clave SRI.

alter table public.puntos_emision
  add column if not exists secuencial_ticket integer not null default 0;

-- Permitir el nuevo tipo interno sin alterar los tipos SRI existentes.
do $$
declare r record;
begin
  for r in
    select conname
    from pg_constraint
    where conrelid = 'public.comprobantes'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%tipo%'
      and pg_get_constraintdef(oid) ilike '%factura%'
  loop
    execute format('alter table public.comprobantes drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.comprobantes
  add constraint comprobantes_tipo_sri_o_pos_chk
  check (tipo in ('factura','nota_credito','nota_debito','liquidacion_compra','guia_remision','retencion','ticket'));

-- El RPC de ventas ya es atómico: comprobante + items + pagos + descuento
-- de inventario. Solo se amplía el catálogo de contadores con el ticket.
create or replace function increment_secuencial(
  p_emisor_id uuid,
  p_establecimiento char(3),
  p_punto_emision char(3),
  p_columna text
)
returns integer
language plpgsql
as $$
declare
  v_nuevo_valor integer;
  v_columnas_permitidas text[] := array[
    'secuencial_factura','secuencial_nota_credito','secuencial_nota_debito',
    'secuencial_guia_remision','secuencial_retencion','secuencial_liquidacion_compra',
    'secuencial_proforma','secuencial_ticket'
  ];
begin
  if not (p_columna = any(v_columnas_permitidas)) then
    raise exception 'Columna de secuencial no permitida: %', p_columna;
  end if;
  execute format(
    'update puntos_emision set %1$I = %1$I + 1 where emisor_id = $1 and establecimiento = $2 and punto_emision = $3 and activo = true returning %1$I',
    p_columna
  ) into v_nuevo_valor using p_emisor_id, p_establecimiento, p_punto_emision;
  if v_nuevo_valor is null then
    raise exception 'No se encontró un punto de emisión activo % - % para el emisor %', p_establecimiento, p_punto_emision, p_emisor_id;
  end if;
  return v_nuevo_valor;
end;
$$;

create index if not exists idx_comprobantes_ticket_pos
  on public.comprobantes(emisor_id, tipo, created_at desc)
  where tipo = 'ticket';
