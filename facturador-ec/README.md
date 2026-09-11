# CONTSERTRIB FACTURACIÓN — v9.9.3

Sistema web de facturación electrónica, inventario, caja, cuentas, reportes y administración SaaS para Ecuador.

Esta es la **documentación única y consolidada del proyecto**. Los README históricos fueron integrados aquí para evitar duplicidad y contradicciones.

## 1. Arquitectura

- Backend: Node.js + TypeScript + Fastify.
- Base de datos: Supabase/PostgreSQL.
- Frontend: HTML/CSS/JavaScript servido por Fastify.
- Firma y emisión: `facturacion-electronica-ec` + certificado `.p12`.
- PDF/RIDE: PDFKit.
- Excel: ExcelJS.
- Correo: Resend desde backend.
- Despliegue: Railway u otro servidor Node compatible; frontend y backend pueden exponerse mediante el mismo servicio.

**No se incluye `dist/`.** El directorio se genera automáticamente con `npm run build` y está excluido del control de versiones.

## 2. Requisitos

- Node.js `>=24.18.0`.
- Proyecto Supabase.
- Certificado electrónico `.p12` válido para cada emisor que vaya a firmar comprobantes.
- Variables de entorno configuradas según `.env.example`.

## 3. Instalación

```bash
npm install
cp .env.example .env
npm run build
npm start
```

Desarrollo:

```bash
npm run dev
```

## 4. Variables de entorno

Revisar `.env.example`. Nunca colocar claves reales en el repositorio ni en el ZIP.

Entre las variables principales se encuentran:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SECRETS_ENCRYPTION_KEY`
- `APP_URL`
- `RESEND_API_KEY`
- `EMAIL_FROM`
- `PROVEEDOR_ADMIN_EMAILS`
- `RUC_PROVEEDOR_FACTURACION`
- `SRI_RUC_LOOKUP_URL`
- parámetros opcionales de Registro Civil y emisión SRI

La clave de servicio de Supabase debe utilizarse únicamente en backend.

## 5. Seguridad

- Las páginas protegidas requieren sesión mediante `/auth/yo`.
- El backend es la autoridad para precios, IVA, stock y emisión.
- Los certificados `.p12` y sus contraseñas se cifran con AES-256-GCM mediante `SECRETS_ENCRYPTION_KEY` antes de almacenarse.
- No se deben guardar certificados, contraseñas, tokens ni claves privadas en `public/`.
- La interfaz nunca debe contener `SUPABASE_SERVICE_ROLE_KEY` ni `RESEND_API_KEY`.

## 6. Módulos

| Módulo | Función |
|---|---|
| Inicio | Dashboard de ventas, stock, proformas y estado del negocio |
| Facturar / POS | Carrito, lector de código de barras, clientes, pagos y emisión electrónica |
| Documentos SRI | Notas de crédito, notas de débito, liquidaciones de compra, guías y retenciones |
| Proformas | Cotizaciones y conversión a venta |
| Productos | Catálogo, precios, costos, IVA, stock e importación masiva |
| Inventario | Entradas, costo promedio, ajustes, kardex y semáforo |
| Clientes | Datos de compradores y búsqueda |
| Proveedores | Datos de proveedores |
| Caja | Apertura, cierre, arqueo y movimientos |
| Cuentas por cobrar | Seguimiento y cobros parciales |
| Cuentas por pagar | Seguimiento y pagos parciales |
| Reportes | Ventas, compras, clientes, proveedores, caja, cuentas, inventario y rentabilidad |
| ATS | Preparación y consulta del ATS |
| Configuración | Datos del emisor, documentos, correo y parámetros |
| Usuarios | Administración de usuarios y permisos |
| Panel proveedor | Administración de clientes SaaS, planes, vencimientos, pagos y facturación SaaS |

## 7. Interfaz consolidada

La interfaz usa una capa global en `public/app.css` y `public/app-shell.js`.

Incluye:

- menú lateral profesional en escritorio;
- barra superior con negocio activo, búsqueda, notificaciones y usuario;
- navegación móvil con menú lateral y barra inferior;
- títulos y breadcrumbs consistentes;
- tarjetas, formularios, tablas, estados y botones con el mismo lenguaje visual;
- exportaciones Excel/PDF integradas donde corresponde;
- diseño responsive para celular;
- soporte de teclado, foco visible y áreas táctiles adecuadas;
- ocultamiento de navegación durante impresión de reportes/RIDE.

La interfaz debe mantener la lógica de negocio existente: los cambios visuales no deben alterar la emisión ni los datos tributarios.

## 8. Motor tributario

La versión 9.9 incorpora configuración tributaria por emisor y estructuras para mantener el historial de cambios.

Se contemplan, como conceptos separados:

- tarifa general;
- tarifa reducida;
- tarifa aplicable a escenarios turísticos configurados;
- IVA 0%;
- operaciones no objeto;
- operaciones exentas;
- tarifas futuras parametrizables.

**Regla importante:** una tarifa nueva debe configurarse según la disposición oficial vigente y su código SRI correspondiente. Los comprobantes históricos no deben recalcularse.

La tabla `catalogo_iva_sri` sirve como catálogo de referencia y la configuración del emisor se mantiene en `configuracion_iva`.

### Estado de integración

El POS ya consulta la configuración del emisor y el servidor recalcula los impuestos. La información dinámica también se registra en `comprobante_impuestos`.

Antes de declarar el motor tributario como totalmente dinámico en todos los documentos SRI, debe verificarse cada tipo de comprobante contra la ficha técnica SRI vigente. En particular, no se debe asumir que una tarifa nueva conserva el código de una tarifa histórica.

## 9. Facturación electrónica

El flujo de factura es:

1. Resolver emisor y punto de emisión.
2. Validar cliente.
3. Recalcular precios, descuentos, stock e impuestos en servidor.
4. Crear comprobante e inventario mediante la función atómica correspondiente.
5. Construir XML.
6. Firmar electrónicamente.
7. Enviar al SRI.
8. Consultar autorización cuando corresponda.
9. Guardar XML firmado/autorizado y datos de autorización.
10. Generar RIDE.
11. Enviar XML/RIDE por correo cuando el correo del cliente y el servicio de correo estén configurados.

El XML autorizado almacenado es el respaldo que se debe conservar según las obligaciones tributarias aplicables.

## 10. POS e inventario

El servidor nunca debe confiar en el precio enviado por el navegador cuando el producto existe en catálogo.

Las ventas validan:

- existencia del producto;
- cantidad;
- stock disponible;
- precio de catálogo;
- descuento;
- impuesto;
- suma de pagos;
- cliente;
- punto de emisión.

El inventario utiliza entradas, ajustes y salidas por venta. Las operaciones críticas utilizan funciones PostgreSQL con bloqueo para evitar carreras de stock.

## 11. Reportes y RIDE

Los reportes se generan desde backend y pueden exportarse a Excel y PDF.

Reportes principales:

- rentabilidad;
- ventas por día;
- listado de ventas;
- compras/entradas;
- clientes;
- proveedores;
- cuentas por cobrar;
- cuentas por pagar;
- caja;
- proformas;
- inventario valorizado;
- auditoría.

El RIDE se genera a partir del comprobante almacenado y no vuelve a emitir el documento ante el SRI.

## 12. SaaS del proveedor

El panel `/admin-proveedor` permite:

- registrar clientes por RUC;
- consultar datos de contribuyente cuando el servicio configurado está disponible;
- crear usuario administrador;
- asignar plan;
- cambiar plan;
- activar 30 días;
- suspender/reactivar;
- regenerar acceso;
- administrar establecimientos y puntos de emisión;
- registrar pagos;
- consultar facturas SaaS.

### Facturación automática de SaaS

Cada pago registrado por el proveedor puede generar automáticamente una factura electrónica y vincularla al pago mediante:

- `pagos_suscripcion.comprobante_id`;
- `pagos_suscripcion.estado_factura`;
- `facturas_saas`;
- `comprobante_impuestos`.

El emisor utilizado para facturar el servicio SaaS se identifica mediante `RUC_PROVEEDOR_FACTURACION` y debe existir correctamente configurado con certificado, establecimiento y punto de emisión.

El monto recibido se interpreta como **total cobrado con IVA incluido**, por lo que el sistema separa base e impuesto según la configuración tributaria vigente del proveedor.

## 13. Migraciones SQL

Las migraciones se encuentran en `sql/` y deben ejecutarse en Supabase respetando dependencias.

Principales grupos:

1. esquema/base de emisores, clientes, productos y comprobantes;
2. secuenciales y emisión;
3. sesiones, autenticación y permisos;
4. inventario y entradas/ajustes;
5. caja;
6. cuentas por cobrar/pagar y proveedores;
7. documentos SRI complementarios;
8. auditoría y notificaciones;
9. correo y almacenamiento de comprobantes;
10. SaaS y planes;
11. configuración dinámica de IVA;
12. motor tributario/facturación SaaS v9.9.

### Migraciones específicas recientes

- `sql/migracion_iva_dinamico_saas_v980.sql`
- `sql/migracion_v990_motor_tributario_saas.sql`

**No ejecutar una migración dos veces a ciegas.** Si Supabase devuelve `relation already exists`, primero verificar qué migraciones ya fueron aplicadas y qué objetos existen.

## 14. Despliegue

Railway:

```bash
npm install
npm run build
npm start
```

El despliegue debe generar `dist/` automáticamente. No es necesario subirlo al repositorio fuente.

Netlify puede utilizarse para un frontend separado si el proyecto se divide posteriormente; la configuración actual está diseñada para que Fastify pueda servir las páginas públicas directamente.

## 15. Checklist antes de producción

- [ ] Variables de entorno configuradas.
- [ ] Supabase conectado.
- [ ] Migraciones aplicadas una sola vez.
- [ ] Usuario administrador creado.
- [ ] Emisor configurado.
- [ ] Certificado `.p12` cargado y cifrado.
- [ ] Establecimiento y punto de emisión activos.
- [ ] Prueba de emisión SRI aprobada.
- [ ] RIDE generado correctamente.
- [ ] XML firmado almacenado.
- [ ] Correo probado.
- [ ] Inventario probado.
- [ ] Caja probada.
- [ ] Reportes Excel/PDF probados.
- [ ] Planes SaaS probados.
- [ ] Pago SaaS y factura SaaS probados.
- [ ] Prueba de tarifa tributaria vigente realizada.
- [ ] `npm run build` exitoso.
- [ ] No existen secretos dentro del proyecto.

## 16. Comandos de mantenimiento

```bash
npm install
npm run build
npm start
```

Para comprobar sintaxis del proyecto después de instalar dependencias:

```bash
npm run build
```

El directorio `dist/` es un artefacto de compilación y no forma parte del paquete fuente.

## 17. Estado de la versión

**v9.9.3 — paquete fuente consolidado con interfaz profesional forzada y tolerante a fallos de carga.**

Objetivo de esta entrega:

- una sola documentación;
- fuente limpia sin `dist/` ni `node_modules/`;
- interfaz global coherente en escritorio y móvil;
- conservar módulos existentes;
- mantener el motor SaaS/tributario y sus migraciones;
- dejar la compilación como responsabilidad del proceso de despliegue.

## 13. Arquitectura de interfaz profesional protegida (v9.9.3)

La interfaz profesional se mantiene como una capa independiente de la lógica contable y de Supabase. Las pantallas protegidas incluyen explícitamente `public/app.css` y `public/app-shell.js`, por lo que no dependen exclusivamente de la inyección HTML del backend.

`app-shell.js` ahora renderiza primero la estructura profesional (sidebar, topbar y navegación móvil) y después hidrata el negocio y usuario mediante `/auth/yo`. Un fallo temporal, lentitud o respuesta inesperada de ese endpoint ya no elimina la interfaz ni deja visible accidentalmente la cabecera antigua. Los enlaces del shell se actualizan con el `emisorId` real una vez validada la sesión.

La protección de sesión sigue siendo del backend: una respuesta HTTP 401 redirige a `/login`. No se modificaron tablas, RPC, migraciones de Supabase, cálculos contables, emisión SRI, inventario ni lógica tributaria para solucionar este problema visual.

Los recursos del shell usan versión `9.9.3` y las rutas Fastify de `/app.css` y `/app-shell.js` continúan sirviéndose sin caché para evitar que el navegador conserve una versión anterior durante despliegues.

La interfaz existente no se reemplaza por una nueva plantilla. Se conserva el dashboard, el POS, los módulos y el lenguaje visual ya construido.


## v9.9.4 — Motor Contable Automático

Se incorpora una capa contable aditiva, sin eliminar la facturación/SRI existente:
- Plan de cuentas por empresa.
- Libro diario automático y manual.
- Balanza de comprobación.
- Resumen de situación y resultado.
- Trazabilidad comprobante autorizado → asiento.
- Clasificación base preparada para reglas por proveedor/cliente/palabras clave.
- Migración SQL independiente: `sql/migracion_motor_contable_v994.sql`.

### Parámetros tributarios 2026
El motor tributario v9.9.5 parametriza 15% como tarifa general de IVA para nuevas operaciones, mantiene 5% para los casos aplicables de materiales de construcción, 8% únicamente cuando exista una reducción temporal legalmente aplicable al sector turístico, y 0%/exento/no objeto según corresponda. El catálogo es por vigencia y los comprobantes históricos conservan su snapshot tributario y nunca se recalculan. Antes de cada cambio normativo, el administrador debe actualizar la vigencia y código SRI correspondientes.

### Importante
La migración contable debe ejecutarse en Supabase antes de utilizar `/contabilidad`. El archivo SQL es aditivo y no elimina datos existentes.


## v9.9.5 — Corrección IVA y endurecimiento tributario
- Tarifa general parametrizada: 15%.
- Nueva migración `sql/migracion_iva_v995_correccion_15.sql`.
- Auditoría previa de configuraciones que quedaron en 13%.
- Catálogo IVA por fecha de vigencia.
- No se recalculan comprobantes históricos.
- Fallbacks del POS, SaaS y administración de clientes corregidos a 15%.
- La tarifa 8% queda como reducción temporal, no como tarifa general.
- Las reformas futuras deben incorporarse como nuevas vigencias, no reescribiendo históricos.


## v9.9.6 — Estabilización total de migraciones

Se corrigieron incompatibilidades detectadas en la auditoría SQL: referencia `activo/activa` del plan contable, defaults de IVA general a 15%, migraciones de IVA históricas que podían reintroducir 13%, sobrecargas de `crear_venta`, y compatibilidad con instalaciones Supabase ya existentes. La migración `sql/migracion_v996_estabilizacion_total.sql` deja una RPC canónica de 14 parámetros y registra la versión en `control_migraciones`. No borra comprobantes ni tablas.


## v9.9.7 — Optimización UX
- Menú lateral reorganizado por módulos: ventas, gestión comercial, documentos SRI, finanzas/contabilidad y administración.
- Formularios de facturación/POS compactados y redistribuidos en escritorio para reducir desplazamiento.
- Responsive conservado para móvil/tablet.
- Sin cambios en lógica contable, SRI, Supabase ni endpoints de negocio.


## v9.9.8 — UX compacto + núcleo contable automático
- Menú lateral consolidado: Documentos SRI aparece una sola vez y concentra nota de crédito, nota de débito, liquidación, guía, retención y ATS.
- POS/facturación reorganizado para escritorio en dos columnas, con resumen y pagos visibles y sin desplazamiento vertical innecesario; en móvil vuelve a una sola columna.
- Contabilidad ampliada: balanza, diario, estado de resultados, balance general, plan de cuentas, asientos manuales validados y cierre mensual.
- Ventas autorizadas generan asiento automático con IVA, cobros/cuentas por cobrar y costo de ventas cuando existe costo de inventario.
- CxP/CxC y sus pagos generan trazabilidad contable automática cuando la fuente está disponible.
- RPC contable atómica con control de período abierto/cerrado y rechazo de asientos descuadrados.
- La parametrización tributaria continúa basada en vigencias y datos históricos del comprobante; no se recalculan documentos históricos.



## v9.9.9 — corrección de entrega de assets + Facturación/POS unificada
- Corrige el bloqueo HTTP 409 de `/app.css`, `/app-shell.js` y favicon por la protección de sesión/selección de negocio.
- Versiona los assets a 9.9.9 y fuerza revalidación con `Cache-Control: no-store`.
- Lleva la selección de comprobantes al módulo Facturación/POS: Factura, Nota de crédito, Nota de débito, Liquidación de compra, Guía de remisión y Retención.
- Elimina el grupo independiente “Documentos SRI” del menú principal; ATS queda como módulo de cumplimiento.
- Mejora las tablas de Contabilidad con scroll controlado, encabezados fijos, búsqueda, totales, badges y estados vacíos.
