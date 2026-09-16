-- V9: cumplimiento SRI para los 6 tipos de comprobantes y trazabilidad.
-- Ejecutar en Supabase SQL Editor.

alter table puntos_emision add column if not exists secuencial_liquidacion_compra integer not null default 0;

create or replace function increment_secuencial(
  p_emisor_id uuid, p_establecimiento char(3), p_punto_emision char(3), p_columna text
) returns integer language plpgsql as $$
declare v_nuevo integer; v_cols text[] := array[
 'secuencial_factura','secuencial_nota_credito','secuencial_nota_debito',
 'secuencial_guia_remision','secuencial_retencion','secuencial_liquidacion_compra','secuencial_proforma'];
begin
 if not (p_columna = any(v_cols)) then raise exception 'Columna de secuencial no permitida: %',p_columna; end if;
 execute format('update puntos_emision set %1$I=%1$I+1 where emisor_id=$1 and establecimiento=$2 and punto_emision=$3 and activo=true returning %1$I',p_columna)
 into v_nuevo using p_emisor_id,p_establecimiento,p_punto_emision;
 if v_nuevo is null then raise exception 'No se encontró punto de emisión activo %-% para el emisor %',p_establecimiento,p_punto_emision,p_emisor_id; end if;
 return v_nuevo;
end $$;

alter table documentos_sri_borrador add column if not exists xml_original text;
alter table documentos_sri_borrador add column if not exists fecha_autorizacion timestamptz;
alter table documentos_sri_borrador add column if not exists intentos integer not null default 0;
alter table documentos_sri_borrador add column if not exists actualizado_por uuid;

create table if not exists auditoria_sri (
 id uuid primary key default gen_random_uuid(),
 emisor_id uuid not null,
 documento_id uuid,
 comprobante_id uuid,
 tipo_documento text not null,
 evento text not null,
 estado text,
 clave_acceso text,
 secuencial text,
 detalle jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);
create index if not exists idx_auditoria_sri_emisor_fecha on auditoria_sri(emisor_id,created_at desc);
create index if not exists idx_auditoria_sri_clave on auditoria_sri(clave_acceso);

create table if not exists solicitudes_anulacion_sri (
 id uuid primary key default gen_random_uuid(),
 emisor_id uuid not null,
 comprobante_id uuid,
 clave_acceso text not null,
 tipo_documento text not null,
 motivo text not null,
 estado text not null default 'pendiente',
 requiere_aceptacion boolean not null default false,
 fecha_solicitud timestamptz not null default now(),
 fecha_limite timestamptz,
 respuesta_receptor text,
 fecha_respuesta timestamptz,
 detalle jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);
create index if not exists idx_anulaciones_sri_emisor_estado on solicitudes_anulacion_sri(emisor_id,estado,fecha_solicitud desc);

-- El RUC del proveedor no debe poder desactivarse accidentalmente en producción.
create or replace function validar_config_proveedor() returns trigger language plpgsql as $$
begin
 if new.ruc_proveedor_facturacion is not null and new.ruc_proveedor_facturacion !~ '^\d{13}$' then
   raise exception 'RUC de proveedor inválido: debe tener 13 dígitos';
 end if;
 if new.ruc_proveedor_facturacion is not null then new.incluir_ruc_proveedor := true; end if;
 return new;
end $$;
drop trigger if exists trg_validar_config_proveedor on configuracion_sistema;
create trigger trg_validar_config_proveedor before insert or update on configuracion_sistema for each row execute function validar_config_proveedor();
