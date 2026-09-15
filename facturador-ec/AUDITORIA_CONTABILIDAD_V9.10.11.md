# CONTSERTRIB v9.10.11 — Auditoría integral del módulo contable

## Objetivo
Conectar la operación del sistema con el libro mayor y evitar doble contabilización, pérdida de trazabilidad o cruces entre empresas.

## Hallazgos corregidos
- El sincronizador anterior omitía tickets/POS, documentos SRI complementarios, pagos y cobranzas como flujo unificado.
- La nómina usaba un estado que no coincide con el flujo persistido de `nomina_periodos` y el cálculo no dejaba necesariamente un detalle persistido antes de contabilizar.
- Cuentas por cobrar podían duplicar ingresos cuando ya existía el asiento de la factura electrónica.
- CxP/CxC no validaban suficientemente el tercero contra el emisor antes de contabilizar.
- Dos procesos simultáneos podían superar la comprobación de idempotencia antes de insertar un mismo asiento.
- El balance general podía tratar un rango como si fuera acumulado; se corrigió para trabajar acumulado hasta la fecha de corte.
- Documentos SRI autorizados podían quedar sin asiento contable; ahora disponen de contabilización automática y estado de control.
- Guías de remisión quedan expresamente clasificadas como `SIN_IMPACTO_CONTABLE` para no inventar movimientos financieros.
- Retenciones sin vínculo con CxP quedan `PENDIENTE_VINCULO`, evitando crear una deuda tributaria sin sustento identificable.

## Automatización implementada
Factura/Ticket → ventas, IVA, forma de pago, cartera y costo de ventas cuando existe snapshot de costo.

Nota de crédito → reversión proporcional de venta e IVA y disminución de clientes.

Nota de débito → incremento de clientes, venta e IVA.

Liquidación de compra → gasto/base, IVA compras y proveedor.

Retención → aplicación contra proveedor e impuesto retenido solo cuando existe vínculo de sustento.

Nómina → cálculo → persistencia de detalle → contabilización → estado CONTABILIZADO.

CxP/CxC → obligación/cartera, con bloqueo de duplicación cuando el documento origen ya generó el asiento.

Pagos/Cobros → asiento de aplicación contra proveedores/clientes y caja/bancos/medios electrónicos.

## Auditoría y sincronización
El módulo incorpora:
- `POST /contabilidad/sincronizar-todo`
- `GET /contabilidad/auditoria`
- registro de ejecuciones en `contabilidad_sincronizaciones`
- conteo de pendientes y errores
- idempotencia por empresa + origen + documento

## Integridad multempresa
La protección de sesión fija el `emisorId` canónico después de resolver el negocio/recurso. Las rutas de contabilidad no deben confiar en que el navegador cambie la empresa por body/query.

## Base tributaria
La automatización se diseñó para mantener el comprobante autorizado del SRI como origen documental y el asiento contable como consecuencia financiera. No se modifica el XML autorizado desde contabilidad.
