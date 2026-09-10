# CONTSERTRIB v9.9.0 — Motor tributario + facturación automática SaaS

## Qué incorpora

- Motor tributario configurable por emisor.
- Tarifa general inicial 13% conforme a la información vigente publicada por el SRI al preparar esta versión.
- Separación de IVA 0%, no objeto (código SRI 6) y exento (código SRI 7).
- Catálogo `catalogo_iva_sri` con vigencias, sector y base legal para futuras reformas.
- Snapshot histórico en `comprobante_impuestos`; los comprobantes anteriores no se recalculan.
- Historial de cambios de configuración tributaria.
- Cada pago SaaS queda vinculado a una factura comercial.
- Al registrar un pago desde el panel maestro se crea el comprobante, detalle, forma de pago y factura electrónica mediante el mismo pipeline SRI del sistema.
- La factura SaaS usa el RUC de `RUC_PROVEEDOR_FACTURACION` como emisor/proveedor. Ese emisor debe existir en CONTSERTRIB con establecimiento, punto de emisión y certificado activo.
- El monto registrado en `pagos_suscripcion.monto` se interpreta como total cobrado; el sistema separa base + IVA según la tarifa vigente del proveedor.
- Si el SRI rechaza la factura, el pago no desaparece: queda trazado con `estado_factura='rechazada'` y se puede reintentar mediante `/proveedor/pagos/:pagoId/facturar`.
- Se almacenan clave de acceso, autorización, secuencial y relación entre pago SaaS y comprobante.
- Se intenta enviar RIDE/XML por correo al administrador del cliente cuando la factura queda autorizada.

## Migración

Ejecutar en Supabase SQL Editor, después de las migraciones anteriores:

`sql/migracion_v990_motor_tributario_saas.sql`

Además se actualizó `migracion_iva_dinamico_saas_v980.sql` para que su valor por defecto no vuelva a 15%.

## Requisito para facturar los cobros SaaS

Configurar en Railway:

`RUC_PROVEEDOR_FACTURACION=<RUC REAL DEL PROVEEDOR>`

El RUC debe corresponder al emisor que factura los planes SaaS. Ese emisor necesita su certificado electrónico activo y un punto de emisión configurado.

## Endpoints nuevos

- `GET /proveedor/clientes/:emisorId/facturas-saas` — historial de facturas SaaS del cliente.
- `POST /proveedor/pagos/:pagoId/facturar` — reintento/manual de facturación.
- `POST /proveedor/clientes/:emisorId/pago` — registra el pago y dispara automáticamente la factura.

## Nota normativa

El motor se diseñó para que las tarifas tributarias no queden quemadas en el código. Las tarifas, códigos y vigencias deben actualizarse únicamente con base en la normativa y catálogos oficiales del SRI. Una reducción o tarifa especial para turismo no se debe aplicar automáticamente a todo cliente turístico: debe corresponder al supuesto legal aplicable.
