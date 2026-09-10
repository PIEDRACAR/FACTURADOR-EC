# CONTSERTRIB v9.9.4

## Correcciones incluidas
- Panel maestro: cambio de plan existente y activación de 30 días preservados.
- Registro SaaS por RUC: consulta al catastro público del SRI y autocompleta razón social, nombre comercial, dirección, actividad, régimen, contabilidad, agente de retención, fechas, ubicación, contactos y establecimientos cuando el SRI los devuelve.
- Guarda el resultado SRI en `datos_sri` para trazabilidad.
- `/impuestos` y `/impuestos-`: nueva pantalla con selector de negocio para usuarios que manejan varios RUC.
- Nuevo endpoint protegido `/impuestos/configuracion`.
- Corrección de tarifa general por defecto de 13% a 15% cuando la configuración estaba en 13%.
- No se eliminan comprobantes, XML, RIDE, historial ni Supabase existente.

## SQL
Ejecutar `sql/migracion_v994_saas_planes_ruc_impuestos.sql` después de las migraciones anteriores.
