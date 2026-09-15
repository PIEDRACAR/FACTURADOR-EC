# CONTSERTRIB v9.9.96 — Descarga masiva de comprobantes

- Se conserva el Listado de ventas y todas sus funciones.
- Nuevo endpoint `/reportes/descarga-masiva` para XML, PDF/RIDE o ambos.
- Solo procesa comprobantes autorizados.
- Usa los archivos permanentes de Supabase Storage; si un comprobante autorizado antiguo aún no está archivado, intenta archivarlo antes de incluirlo.
- Genera un ZIP con carpetas `XML/` y `PDF/`, `MANIFEST.csv` y `README.txt`.
- Procesamiento controlado hasta 5.000 comprobantes por solicitud para evitar agotar memoria de Railway; para períodos mayores se recomienda dividir por mes/año.
- No modifica ni elimina datos de Supabase.
- No vuelve a emitir comprobantes ni consulta/retransmite al SRI.
- Interfaz en Reportes con botones XML, PDF/RIDE y XML + PDF usando el período y tipo seleccionados.
