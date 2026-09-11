# CONTSERTRIB FACTURACIÓN v9.9.18

## Cambios principales
- Escáner de código de barras reducido a un campo compacto de una sola línea.
- Tema claro/oscuro con mayor contraste y estados de foco visibles.
- Encabezado y menú: **Facturación** en lugar de “Facturar”; buscador global mejorado.
- Buscador global: al seleccionar una factura autorizada abre directamente el RIDE PDF; incorpora búsqueda de asientos contables.
- Asientos manuales/ajustes: consulta y edición segura mientras el período esté abierto.
- Correo electrónico obligatorio y validado en POS, clientes, proformas y documentos SRI.
- Corrección del XML de notas de crédito/liquidaciones: los impuestos transmitidos incluyen `tarifa`, evitando errores de construcción XML por valores indefinidos.
- Reportes con filtros por período, búsqueda, estado y tipo de documento; reporte de ventas con detalle por comprobante y desglose de bases 0/5/8/15, neto sin IVA, IVA y total con IVA.
- PDF de reportes mejorado: encabezado empresarial, razón social/RUC/dirección y filas con ajuste de altura para evitar textos montados.
- Historial detallado de caja con filtros, búsqueda y descarga PDF/Excel; importación de movimientos mediante Excel para caja abierta.
- Importación/exportación Excel para clientes y proveedores.
- Reparación de instalaciones antiguas de nómina que conservan `empresa_id` NOT NULL: migración 9.9.18 lo vuelve no bloqueante para la arquitectura actual basada en `emisor_id` y el backend incluye compatibilidad de alta.
- Migración de índices para caja/nómina y recarga del schema cache de PostgREST.

## Validación realizada
- `node --check` para `public/app-shell.js`: OK.
- Validación sintáctica de JavaScript embebido en todos los HTML: OK.
- Parser TypeScript (`transpileModule`) para todos los `.ts`: 0 errores de sintaxis.

No se ejecutó un `npm run build` completo contra Railway/Supabase desde este entorno porque no se dispuso de una instalación completa de dependencias ni de las credenciales de producción. Por ello, el paquete está validado estáticamente y debe probarse en Railway después de aplicar la migración SQL.

## Migración
Ejecutar en Supabase SQL Editor:
`sql/migracion_contsertrib_v9918_integridad_filtros.sql`

La migración no elimina comprobantes, asientos ni historial.
