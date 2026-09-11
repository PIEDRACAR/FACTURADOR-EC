-- v9.9.23 — Logo personalizado por contribuyente para el RIDE.
-- ADITIVA: no elimina comprobantes ni modifica XML autorizado.
-- El logo se usa exclusivamente en la representación impresa (RIDE/PDF).
alter table configuracion_sistema add column if not exists logo_ride_base64 text;
alter table configuracion_sistema add column if not exists logo_ride_mime text;
alter table configuracion_sistema add column if not exists logo_ride_nombre text;
alter table configuracion_sistema add column if not exists logo_ride_actualizado_at timestamptz;
notify pgrst, 'reload schema';
