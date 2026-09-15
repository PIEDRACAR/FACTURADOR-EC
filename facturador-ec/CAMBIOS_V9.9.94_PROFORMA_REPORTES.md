# CONTSERTRIB v9.9.94

- Proforma convertida a factura autorizada: reintenta de forma idempotente el archivado del XML firmado y RIDE PDF en Supabase Storage.
- Al quedar AUTORIZADA, envía automáticamente al correo del cliente el XML firmado y el RIDE PDF.
- La conversión devuelve estado de correo y archivos documentales para facilitar diagnóstico.
- Reportes: se retiró de la interfaz únicamente la opción "Listado de ventas"; la ruta backend se conserva para compatibilidad.
- Reportes: la pantalla inicia en "Ventas por día" y tiene timeout de 20 segundos + manejo de errores para no quedar indefinidamente en "Consultando información detallada…".
- No se eliminaron tablas, migraciones ni funciones de Supabase.
