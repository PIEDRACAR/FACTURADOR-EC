# CONTSERTRIB FACTURACIÓN · v9.9.81

Sistema SaaS para facturación electrónica SRI Ecuador, POS, inventario, caja, contabilidad, cuentas por cobrar/pagar, nómina, ATS, reportes, proformas y administración de suscripciones. Esta versión consolida la documentación histórica en este único README; las migraciones SQL se conservan individualmente porque son necesarias para instalaciones y bases existentes.

## Arquitectura
- Backend: Node.js + TypeScript + Fastify.
- Frontend: HTML/CSS/JavaScript servido por Fastify.
- Base de datos: Supabase/PostgreSQL.
- Firma: `ec-sri-invoice-signer` + certificado P12 cifrado.
- XML/SRI: `facturacion-electronica-ec` con prevalidación propia.
- PDF/RIDE: PDFKit.
- Excel: ExcelJS.
- Correo: Resend.
- Despliegue: Railway.
- No se incluye `dist/`: Railway lo genera durante `npm run build`.

## Módulos conservados
Facturación/POS, comprobantes SRI (facturas, NC, ND, liquidaciones, guías y retenciones), proformas, clientes, proveedores, productos, inventario y bodegas, caja, contabilidad, CxC, CxP, nómina, activos fijos, conciliación, ATS, reportes, importación/exportación Excel, RIDE/ticket, correo, configuración, usuarios, SaaS/planes y Panel Maestro ROOT, PayPhone y auditoría.

## Seguridad
- Sesiones protegidas por backend y validación de emisor/negocio.
- Cifrado AES-256-GCM para P12 y contraseña.
- `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY` y tokens de PayPhone solo en variables privadas de Railway.
- No guardar secretos en `public/` ni en el ZIP.

## Variables principales
Configurar en Railway: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SECRETS_ENCRYPTION_KEY`, `APP_URL`, `RESEND_API_KEY`, `EMAIL_FROM`, `PROVEEDOR_ADMIN_EMAILS`, `RUC_PROVEEDOR_FACTURACION`. Para PayPhone: `PAYPHONE_TOKEN`, `PAYPHONE_STORE_ID`, `PAYPHONE_LINK_EXPIRE_HOURS=24`.

Producción: `APP_URL=https://contsertrib.com`. Webhook PayPhone: `https://contsertrib.com/pagos/payphone/NotificacionPago`.

## Instalación / Railway
```bash
npm install
npm run build
npm start
```
No subir `node_modules/` ni `dist/`. Railway debe ejecutar el build con Node `>=24.18.0`.

## SRI
La aplicación realiza prevalidaciones antes de generar/transmitir XML: RUC, dirección de matriz/establecimiento, establecimiento/punto, ambiente, clave de acceso, códigos de producto, información adicional y datos de factura. La dirección del punto se resuelve en cascada desde punto → establecimiento → matriz; la migración `sql/migracion_v9978_direccion_establecimiento_sri.sql` corrige datos existentes. El RUC proveedor configurado para información adicional es `0705063105001`.

## PayPhone
La generación de links utiliza la API de PayPhone y registra la solicitud/pago en Supabase. La notificación externa oficial se atiende en `NotificacionPago`; las transacciones aprobadas se validan por StoreID, moneda, monto, estado y datos de transacción antes de registrar el pago y activar la suscripción. La autorización de la notificación externa debe estar aprobada por PayPhone.

## Migraciones SQL
Todos los archivos de `sql/` se conservan deliberadamente. No deben eliminarse solo para reducir archivos, porque representan cambios incrementales de esquemas existentes. Ejecutar únicamente las migraciones que correspondan a una base ya instalada y respetar el orden histórico. La migración PayPhone de producción es `sql/migracion_v9980_payphone_produccion.sql`.

## Optimización móvil v9.9.81
- Caché de assets actualizado a `9.9.81`.
- Failsafe para evitar que el shell quede bloqueado en “loading”.
- Inicialización segura si el DOM móvil todavía no está disponible.
- Navegación lateral y barra inferior táctiles.
- Tablas con desplazamiento horizontal sin romper el ancho de la pantalla.
- Inputs táctiles de 16px para evitar zoom automático en móviles.
- Respeto de `safe-area` en Android/iOS.
- Popovers y paneles limitados al viewport.
- Se mantienen todos los módulos y endpoints existentes.

## Limpieza del paquete
Se eliminaron únicamente documentos históricos redundantes y artefactos de documentación que no ejecuta el sistema. No se eliminó ninguna ruta, módulo, migración SQL, plantilla HTML ni funcionalidad de negocio.

## Validación antes de desplegar
```bash
npm run build
npm start
```
Comprobar después en móvil: login → Inicio → Facturación → Clientes → Inventario → Caja → Contabilidad → Reportes. Si un módulo falla, revisar consola del navegador y logs de Railway; no borrar módulos para resolver errores.
