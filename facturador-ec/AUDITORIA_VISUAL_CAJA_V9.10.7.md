# Auditoría visual de caja y emisión — CONTSERTRIB v9.10.7

## Alcance
Revisión visual del flujo de Factura electrónica/POS, con énfasis en el campo de identificación del cliente y legibilidad en modo oscuro.

## Mejoras implementadas
- Campo de identificación ampliado para lectura completa de cédula (10 dígitos) y RUC (13 dígitos).
- Campo con tipografía de mayor tamaño, peso alto, espaciado controlado y numeración tabular.
- Botón Consultar de tamaño uniforme y alto contraste.
- En móvil el campo ocupa todo el ancho y el botón pasa a una segunda línea para evitar compresión.
- Enter dentro del campo ejecuta la consulta sin enviar accidentalmente otro formulario.
- Mensaje de consulta con `aria-live` para mejorar feedback y accesibilidad.
- Auditoría de contraste para modo oscuro: tarjetas, campos, placeholders, etiquetas, resultados y sugerencias de clientes.
- No se modificó la lógica de consulta SRI/cliente local ni la lógica de emisión.

## Criterio de cajero
La identificación es uno de los datos de mayor frecuencia de captura. Debe poder leerse y verificarse inmediatamente antes de emitir. La interfaz prioriza este dato sin ocultar los demás controles.
