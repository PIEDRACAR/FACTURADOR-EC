# CONTSERTRIB v9.7.0 — SaaS multi-RUC + planes + ATS

Esta versión amplía la v9.6.2 sin eliminar la funcionalidad existente.

## Incluye

- Panel maestro del proveedor en `/admin-proveedor`.
- Planes comerciales configurables desde el panel:
  - precio mensual;
  - documentos mensuales o ilimitados;
  - RUC/contribuyentes por cuenta;
  - establecimientos activos;
  - puntos de emisión activos;
  - usuarios;
  - inventario;
  - ATS;
  - carga electrónica;
  - reportes avanzados.
- Cuenta SaaS con uno o varios contribuyentes/RUC según el plan.
- Matriz/sucursales por cada RUC.
- Puntos de emisión por establecimiento.
- Desactivación comercial segura: cancela acceso/suscripción sin borrar documentos tributarios históricos.
- Control de consumo mensual de documentos para facturas y documentos SRI complementarios autorizados.
- Módulo `/ats`.
- Registro estructurado de compras ATS que no deben inventarse a partir de movimientos de inventario.
- Generación XML ATS con ventas electrónicas, compras registradas, ventas por establecimiento y advertencias de información faltante.
- Persistencia de cada generación ATS en `ats_generaciones`.
- Descarga del XML ATS.
- RUC del proveedor del sistema conservado en el flujo de comprobantes y documentos SRI.

## Migración requerida

Ejecutar una sola vez en Supabase SQL Editor:

`sql/migracion_saas_v970.sql`

La migración:

1. amplía `planes_suscripcion`;
2. crea `cuentas_cliente_saas`;
3. crea `contribuyentes_cliente_saas`;
4. vincula suscripciones con la cuenta SaaS;
5. migra los emisores existentes a una cuenta por emisor sin borrar información;
6. crea `ats_compras`, `ats_retenciones` y `ats_generaciones`;
7. crea los planes comerciales iniciales indicados en el proyecto.

## Importante sobre ATS

El ATS no se fabrica con valores inventados. La ficha técnica del SRI exige datos obligatorios como sustento tributario, identificación del proveedor, comprobante, fecha, serie, secuencial, autorización, bases, IVA, retenciones y formas de pago según corresponda. Los registros de compra del módulo ATS permiten completar esa información de forma estructurada.

El XML generado debe validarse con la herramienta/canal vigente del SRI antes de su presentación. Esta versión no afirma que un XML generado automáticamente sea una "certificación SRI".

## Variables existentes

- `RUC_PROVEEDOR_FACTURACION`
- `RESEND_API_KEY`
- `EMAIL_FROM`
- `PROVEEDOR_ADMIN_EMAILS`
- `APP_URL`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SECRETS_ENCRYPTION_KEY`

## Build

Railway ejecuta `npm run build` y después `npm start` mediante `railway.json`.

La compilación completa local debe confirmarse con el entorno de dependencias instalado. Esta versión fue revisada estructuralmente, pero no debe declararse "build verificado" hasta ejecutar el `npm run build` real en Railway.
