# CONTSERTRIB v9.9.93 — Proformas y datos de identificación

- Corregida la presentación de identificación en PDF de proformas: ya no concatena el código SRI `05` con la cédula. Ahora muestra `Cédula: 0909271058`.
- Al crear una proforma, después de guardar cabecera e ítems se genera el PDF y se envía automáticamente al correo del solicitante registrado en la proforma.
- Si Resend falla, la proforma NO se pierde: queda guardada y la respuesta informa el error de correo.
- Añadido botón `✉️ Enviar al correo` para reintentar el envío desde la lista de proformas.
- No se modifican tablas, migraciones ni datos de Supabase.
- No se elimina ninguna función existente.
- Versiones de package.json y package-lock sincronizadas a v9.9.93.
