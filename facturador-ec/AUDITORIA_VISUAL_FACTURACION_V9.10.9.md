# Auditoría visual de facturación — v9.10.9

## Objetivo
Optimizar la pantalla de emisión para trabajo de cajero en escritorio sin eliminar funciones.

## Distribución desktop
- Columna izquierda 50%: escáner, búsqueda/agregado de productos y carrito.
- Columna derecha 50%: datos del cliente, formas de pago y resumen.
- Encabezado, selector de comprobante y punto de emisión conservan ancho completo.
- Resumen queda sticky para mantener el total visible durante el cobro.

## Responsive
Hasta 900px se vuelve una sola columna para evitar compresión de formularios y tablas.

## Modo oscuro
Se reforzó contraste de campos, selects, sugerencias, carrito, pagos, avisos y textos secundarios.

## Compatibilidad
No se eliminan IDs, funciones JS ni endpoints existentes de `pos.html`.
