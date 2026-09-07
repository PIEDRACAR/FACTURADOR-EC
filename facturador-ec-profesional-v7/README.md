# facturador-ec — sistema de facturación electrónica SRI Ecuador

Backend + interfaces web completas para operar un negocio con facturación
electrónica ante el SRI: registro de negocios, catálogo de productos, punto
de venta con lector de código de barras, generación de facturas firmadas y
autorizadas por el SRI, RIDE en PDF, proformas, y reporte de rentabilidad.

Construido sobre `facturacion-electronica-ec` (elegida tras comparar contra
`open-factura`: esta última tenía un bug real de manejo de fechas que
corrompía la clave de acceso, y generaba XML contra una ficha técnica
desactualizada).

**Probado de punta a punta contra el SRI real** (ambiente de pruebas): una
factura emitida desde este sistema fue firmada, enviada y AUTORIZADA por el
SRI — no es solo teoría, el motor funciona.

## Requisitos

- **Node.js >= 24.18.0** (exigido por `facturacion-electronica-ec`).
- Un proyecto de Supabase con el esquema y todas las migraciones de
  `sql/` aplicados (ver "Migraciones SQL" más abajo).
- Un certificado `.p12` real emitido por una entidad certificadora
  autorizada por el SRI.

## Instalación

```bash
npm install
cp .env.example .env
# completar SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY y SECRETS_ENCRYPTION_KEY en .env
```

## Correr en desarrollo

```bash
npm run dev
```

## Estructura

```
src/
├── index.ts                              servidor Fastify — registra todas las rutas y páginas
├── config/env.ts                         variables de entorno tipadas y validadas
├── crypto/secrets.ts                     cifrado AES-256-GCM del certificado .p12 y su contraseña
├── db/
│   ├── supabase.ts                       cliente de Supabase (service role, solo backend)
│   └── consultas.ts                      consultas compartidas (emisor, punto de emisión activo)
├── sequence/supabaseSequenceProvider.ts  ISequenceProvider atómico sobre puntos_emision
├── services/
│   ├── facturacion.ts                    orquesta FacturacionElectronicaEC por emisor
│   └── ride.ts                           genera el RIDE (PDF) de un comprobante
└── routes/
    ├── comprobantes.ts                   POST emitir / GET consultar (bajo nivel)
    ├── emisores.ts                       POST /emisores/registrar (alta de negocio)
    ├── pos.ts                            GET/POST/PATCH /productos, POST /pos/venta
    ├── proformas.ts                      cotizaciones + conversión a venta real
    ├── reportes.ts                       GET /reportes/rentabilidad
    └── ride.ts                           GET /comprobantes/:id/ride

public/            páginas HTML servidas directamente por Fastify (sin build aparte)
sql/                todas las migraciones — ver la lista completa más abajo
```

## Pantallas

Todas reciben el negocio activo por parámetro de URL (`?emisorId=...`) y
están enlazadas entre sí con una barra de navegación superior.

| Pantalla | Ruta | Para qué |
|---|---|---|
| **Panel principal** | `/?emisorId=X` | Resumen del día (ventas, stock bajo, proformas vigentes) y accesos a todo lo demás |
| Registro de negocio | `/registro` | Alta de un negocio nuevo (emisor + punto de emisión + certificado cifrado), sin tocar SQL |
| Catálogo de productos | `/productos-admin?emisorId=X` | Crear, editar, activar/desactivar productos; código de barras opcional; **carga masiva desde Excel** |
| Punto de venta | `/pos?emisorId=X` | Carrito, escáner de código de barras, cobro, emisión automática |
| Inventario | `/inventario?emisorId=X` | Entradas de mercadería (costo promedio ponderado), ajustes por conteo físico, kardex |
| Clientes | `/clientes-admin?emisorId=X` | Administrar clientes (los que compran en el POS se agregan solos) |
| Proveedores | `/proveedores-admin?emisorId=X` | Administrar proveedores |
| Cuentas por cobrar | `/cuentas-por-cobrar?emisorId=X` | Ventas a crédito — registrar y cobrar en pagos parciales |
| Cuentas por pagar | `/cuentas-por-pagar?emisorId=X` | Deudas a proveedores — registrar y pagar en pagos parciales |
| Proformas | `/proformas?emisorId=X` | Cotizaciones — se convierten en venta real con un clic |
| Reportes | `/reportes?emisorId=X` | Rentabilidad por producto (ingresos, costo, utilidad, margen) en un rango de fechas |

### Panel principal (`/`)

Es la puerta de entrada del sistema. Si se abre sin `?emisorId=X` (por
ejemplo, alguien perdió su link), muestra un buscador por RUC
(`GET /emisores/buscar?ruc=...`) para recuperar el acceso — no hay sistema
de login, así que el link con el `emisorId` **es** la llave de acceso.

Con `?emisorId=X`, `GET /dashboard/resumen` trae en una sola llamada: datos
del negocio, ventas autorizadas de hoy (cantidad y total), cuántos
productos activos están por debajo de su stock mínimo, y cuántas proformas
siguen vigentes — para que la primera pantalla sea útil, no una lista de
enlaces vacía.


### Registro de negocio (`/registro`)

Da de alta un negocio nuevo completo en un solo paso, llamando a
`POST /emisores/registrar`: el certificado `.p12` y su contraseña se cifran
con AES-256-GCM (`src/crypto/secrets.ts`) usando una única llave maestra
del sistema (`SECRETS_ENCRYPTION_KEY`) y se guardan cifrados en Supabase —
ya no se usan variables de entorno por cliente.

Si el RUC ya está registrado, **no falla**: actualiza los datos del emisor
existente y reemplaza su certificado (útil para renovar un certificado
vencido, o corregir un registro hecho antes de que existiera el cifrado).

### Catálogo de productos (`/productos-admin`)

Cada producto guarda código interno, código de barras (opcional, columna
`codigo_auxiliar`), descripción, precio, costo, tarifa de IVA y stock
actual/mínimo. Desactivar un producto (`activo=false`) no borra el
historial: las facturas ya emitidas guardan su propia copia de
descripción/precio en `comprobante_items`.

**Carga masiva desde Excel:** descarga la plantilla (`GET /productos/plantilla`)
para ver las columnas exactas, complétala y súbela. Si un código ya existe
para el negocio, se **actualiza**; si no, se **crea** (aprovecha el
`unique(emisor_id, codigo_principal)` del esquema). Valida cada fila por
separado — las filas con error se listan con su número exacto, y las demás
se importan igual. Máximo 2000 filas por archivo.

### Punto de venta (`/pos`)

Carrito con buscador de productos, línea libre sin catálogo, cliente
opcional (Consumidor Final por defecto), pago dividido en varias formas, y
un **lector de código de barras** (campo dedicado — funciona con lectores
USB/Bluetooth tipo teclado, sin configuración adicional; busca por código
interno o código de barras).

Al confirmar, `POST /pos/venta`:

1. Recalcula precio e IVA de cada línea **en el servidor**, contra la tabla
   `productos` — nunca confía en el precio que mande el navegador.
2. Valida que la suma de las formas de pago cuadre con el total.
3. Crea el comprobante completo **y descuenta el inventario**, todo en una
   sola transacción atómica de Postgres (función `crear_venta` — ver
   `sql/migracion_crear_venta_atomica.sql`). Si dos ventas simultáneas
   compiten por el mismo stock, la segunda falla limpiamente en vez de
   dejar el stock en negativo.
4. Llama a `emitirFactura` (el motor ya probado contra el SRI real).
5. Si queda AUTORIZADO, ofrece un botón para ver/descargar el RIDE en PDF.

### Inventario (`/inventario`)

Cierra el ciclo que faltaba: hasta antes de esto, el stock solo se
descontaba (al vender). Tres pestañas:

- **Entrada** (compra de mercadería): suma cantidad y recalcula el costo
  promedio ponderado automáticamente (`registrar_entrada_inventario`,
  fórmula estándar: `(stock×costo_actual + cantidad×costo_entrada) /
  nuevo_stock`), con bloqueo de fila (`for update`) para que dos entradas
  simultáneas del mismo producto no se pisen.
- **Ajuste** (conteo físico): fija el stock a un número exacto —motivo
  obligatorio, queda en el historial— sin tocar el costo promedio.
- **Kardex**: historial completo de movimientos (entradas, salidas por
  venta, ajustes), filtrable por producto.

No incluye un módulo de proveedores como entidad propia — el campo
"Proveedor / referencia" en una entrada es solo texto libre, guardado en
`movimientos_inventario.nota`.

### Proveedores y clientes (`/proveedores-admin`, `/clientes-admin`)

CRUD básico. Los clientes también se crean/actualizan automáticamente al
vender desde el POS o al hacer una proforma (por eso no tienen estado
activo/inactivo, a diferencia de productos y proveedores) — esta pantalla
es para darlos de alta a mano o editarlos, no la única forma de crearlos.

### Cuentas por pagar y por cobrar (`/cuentas-por-pagar`, `/cuentas-por-cobrar`)

Un libro de seguimiento **independiente** del motor de facturación — no
cambian cómo `/pos/venta` emite ante el SRI, que sigue exigiendo que las
formas de pago cuadren con el total en el momento de emitir el comprobante
(como exige el comprobante electrónico). Sirven para llevar el control de
cobros/pagos que ocurren *después* de la venta o la compra:

- **Cuentas por pagar**: se crean a mano, o automáticamente al registrar
  una entrada de inventario marcada "a crédito" (con proveedor y fecha de
  vencimiento). Pagos parciales con `POST /cuentas-por-pagar/:id/pagos`
  (función atómica `registrar_pago_cuenta_por_pagar`, con bloqueo de fila).
- **Cuentas por cobrar**: se crean a mano — opcionalmente referenciando un
  `comprobante_id` ya emitido y autorizado, para llevar el seguimiento de
  cobro de una factura que se cobrará después. Cobros parciales con
  `POST /cuentas-por-cobrar/:id/pagos` (función atómica
  `registrar_pago_cuenta_por_cobrar`).

Ambas marcan el estado como `pagada`/`cobrada` automáticamente cuando el
saldo llega a 0, y bloquean pagos que excedan el saldo pendiente.

### Proformas (`/proformas`)

Cotizaciones sin efecto tributario ni de inventario. Al convertir una
proforma vigente en venta (`POST /proformas/:id/convertir`), se honra el
precio **originalmente cotizado** (no el precio actual del catálogo, que
pudo haber cambiado desde entonces), y se reusa exactamente el mismo camino
que `/pos/venta` (inventario + emisión SRI incluidos).

### Reportes (`/reportes`)

Panel único con selector de 9 tipos de reporte, cada uno exportable a
**Excel** y **PDF** con un solo clic (mismo botón para cualquier tipo,
mecanismo genérico en `GET /reportes/exportar?tipo=&formato=excel|pdf`):

- **Rentabilidad** — por producto: ingresos, costo, utilidad, margen %.
- **Ventas por día** — total vendido y cantidad de facturas, día a día.
- **Listado de ventas** — una fila por factura (fecha, cliente, total, estado).
- **Listado de compras** — una fila por entrada de inventario (producto, proveedor, costo).
- **Clientes** — cuánto ha comprado cada uno, cantidad de compras.
- **Proveedores** — cuánto se le ha comprado a cada uno.
- **Cuentas por cobrar** / **Cuentas por pagar** — resumen (pendiente, vencido).
- **Inventario valorizado** — cuánto vale el stock actual, al costo promedio.

Todos comparten el mismo generador de Excel (`src/services/excel.ts`, usa
`exceljs`) y de PDF tabular (`src/services/pdfReportes.ts`, usa `pdfkit`)
— un reporte nuevo solo necesita su función de datos, no reinventar la
exportación.

### RIDE en PDF (`GET /comprobantes/:id/ride`)

Genera el PDF de la factura al vuelo a partir de lo ya guardado en
Supabase (no vuelve a tocar el SRI), con código de barras Code128 de la
clave de acceso. Si el emisor está en ambiente de pruebas, el PDF lo marca
visiblemente ("este comprobante no tiene validez tributaria").

### Respaldo de XML (`GET /comprobantes/:id/xml`)

Descarga el **XML firmado tal como quedó autorizado por el SRI** — el
respaldo que la normativa exige conservar (7 años, art. innumerado LRTI).
No genera nada nuevo: `comprobantes.xml_firmado` ya se guarda desde el
momento de la emisión (`services/facturacion.ts`); este endpoint solo lo
entrega. Se puede descargar comprobante por comprobante desde el listado
de ventas en `/reportes` (columna "Respaldo": enlaces XML y PDF por fila).

## Migraciones SQL

Ejecutar en el SQL Editor de Supabase, en este orden, cada una una sola vez:

1. `setup-supabase-facturador.sql` — esquema completo (todas las tablas)
2. `sql/increment_secuencial.sql` — función atómica de secuenciales
3. `sql/migracion_certificados_cifrados.sql` — columnas cifradas del certificado
4. `sql/migracion_secuencial_nulo.sql` — permite `comprobantes.secuencial` nulo hasta emitir
5. `sql/migracion_crear_venta_atomica.sql` — función `crear_venta` (comprobante + inventario en una transacción)
6. `sql/migracion_certificado_unico_por_alias.sql` — permite actualizar (no solo crear) el certificado de un emisor ya registrado
7. `sql/migracion_iva_5_porciento.sql` — agrega la tarifa de IVA 5% (materiales de construcción) y la columna `subtotal_5`
8. `sql/migracion_iva_8_porciento_turismo.sql` — agrega la tarifa de IVA 8% (turismo en feriados decretados) y la columna `subtotal_8`
9. `sql/migracion_inventario_entradas_ajustes.sql` — funciones atómicas de entrada (costo promedio ponderado) y ajuste de inventario
10. `sql/migracion_proveedores_cxp_cxc.sql` — proveedores, cuentas por pagar/cobrar, sus pagos parciales, y amplía `registrar_entrada_inventario` para compras a crédito

## Desplegar en Render / Railway

1. Sube este proyecto a un repositorio de GitHub (puede ser privado).
2. Conecta el repositorio en Render o Railway.
3. Configuración del servicio:
   - **Build command:** `npm install && npm run build`
   - **Start command:** `npm start`
   - **Health check path:** `/salud`
4. Variables de entorno:
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
   - `SECRETS_ENCRYPTION_KEY` — llave maestra única para cifrar certificados.
     Generarla **una sola vez** con:
     ```
     node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
     ```
     Guárdala aparte en un lugar seguro — si se pierde, los certificados
     guardados quedan ilegibles y hay que volver a subirlos desde `/registro`.
   - `PORT` — la mayoría de hostings la inyecta automáticamente.
   - `RUC_PROVEEDOR_FACTURACION` (opcional) — ver "Normativa ecuatoriana
     aplicada" abajo. Si no se define, el sistema funciona exactamente
     igual que antes de esta variable existir.
5. Ejecutar todas las migraciones de la sección anterior en Supabase.
6. **Plan gratuito:** el servicio puede "dormirse" tras un rato sin
   tráfico y tardar unos segundos en despertar en la siguiente petición.

## Normativa ecuatoriana aplicada

- **Tarifas de IVA:** 15% (general, vigente para 2026 según Circular del SRI
  NAC-DGECCGC25-00000006), 8% (turismo, **solo** durante feriados con
  decreto ejecutivo específico y con Registro de Turismo + LUAF vigentes —
  el catálogo de productos muestra una advertencia al seleccionarla), 5%
  (materiales de construcción), 0%, exento y no objeto de impuesto — con
  sus códigos de porcentaje oficiales exactos (Ficha Técnica de
  Comprobantes Electrónicos: 0→código 0, 5→código 5, 8→código 8,
  15→código 4, exento→código 7, no objeto→código 6).
- **Catálogo de formas de pago:** los 8 códigos oficiales del SRI,
  agrupados en el POS según la distinción que exige la normativa —
  **sin utilización del sistema financiero** (01 efectivo) y **con
  utilización del sistema financiero** (15 compensación de deudas, 16
  tarjeta de débito, 17 dinero electrónico, 18 tarjeta prepago, 19 tarjeta
  de crédito, 20 otros con sistema financiero, 21 endoso de títulos), con
  una insignia visual que indica a cuál categoría pertenece cada pago
  seleccionado.
- **Bancarización:** desde diciembre de 2023, todo pago superior a $500 sin
  usar el sistema financiero (código 01) no es deducible para el comprador
  ni da derecho a crédito tributario de IVA. El POS muestra un aviso
  informativo (no bloqueante) cuando una venta cae en este caso.
- **RUC del proveedor del sistema (Resolución NAC-DGERCGC26-00000027, art. 5,
  plazo ~26 sept. 2026):** si se define la variable de entorno
  `RUC_PROVEEDOR_FACTURACION`, cada factura incluye automáticamente el campo
  `<infoAdicional><campoAdicional nombre="RUC Proveedor">...</campoAdicional></infoAdicional>`
  — nombre de campo confirmado por múltiples fuentes profesionales citando
  la resolución (el SRI aún no publica una Ficha Técnica oficial con este
  campo; si la publica con un nombre distinto, es la única constante a
  cambiar, en `src/services/facturacion.ts`). La librería base no soporta
  esto de fábrica, así que se reconstruyó el pipeline de emisión con las
  funciones públicas de bajo nivel que expone (`buildXml`/`signXml`/
  `sendToSri`/`checkAuthorization`), insertando el campo antes de firmar y
  validando contra el XSD oficial offline en cada intento. Si la variable
  no está definida, el comportamiento es idéntico al de antes (sin campo
  adicional, usando el método de alto nivel original de la librería).

## Seguridad — certificado y contraseña

El `.p12` y su contraseña se cifran con AES-256-GCM antes de guardarse en
Supabase (columnas `certificados.p12_cifrado` y `p12_password_cifrado`),
usando la llave maestra `SECRETS_ENCRYPTION_KEY`. Nunca se guardan en texto
plano ni en variables de entorno por cliente.

## Pendientes conocidos (para seguir mejorando, no bloquean el uso normal)

- Sin sistema de usuarios/login todavía: cualquiera con el link
  `?emisorId=X` puede operar el POS de ese negocio. Para un solo negocio
  operado por su dueño esto es razonable; para varios cajeros con
  permisos distintos, hace falta un sistema de autenticación (no
  construido en este scaffold).
- El manejo de reintentos cuando el SRI responde código 70 ("en
  procesamiento") depende del reintento interno de la librería
  (`maxError70Retries`) — no hay una cola/reintento propio a más largo
  plazo si el SRI está caído por un rato prolongado.
- `caja_turnos` / `caja_movimientos` (apertura y cierre de caja por turno)
  están en el esquema de la base de datos pero no tienen pantalla ni
  endpoints todavía — depende del sistema de usuarios mencionado arriba,
  ya que un turno de caja se asocia a `auth.users`.
- Reportería: cada reporte ya se puede exportar a Excel/PDF desde `/reportes`.
  Cuentas por cobrar/pagar muestran resumen ahí (con exportación), pero el
  detalle línea por línea (con acciones de cobro/pago) sigue viéndose en
  sus pantallas dedicadas (`/cuentas-por-cobrar`, `/cuentas-por-pagar`).
- Las cuentas por pagar/cobrar son un libro de seguimiento manual — no se
  genera automáticamente una cuenta por cobrar al vender a crédito desde
  el POS (`/pos/venta` sigue exigiendo que las formas de pago cuadren con
  el total al emitir, como exige el comprobante electrónico). Si se vende
  "a crédito", la práctica es registrar el pago con el código que
  corresponda y crear la cuenta por cobrar aparte, referenciando el
  `comprobante_id` ya emitido.

## 🚦 Alertas de inventario tipo semáforo

La migración `sql/migracion_alertas_inventario_semaforo.sql` agrega a cada producto `stock_critico` (STOP) y `stock_maximo`. El estado se calcula automáticamente:

- 🔴 STOP: stock <= stock_critico (por defecto 0).
- 🟡 BAJO: stock > crítico y <= stock_minimo.
- 🟢 NORMAL: stock > mínimo y no supera el máximo configurado.
- 🟠 SOBRESTOCK: stock > stock_maximo, cuando existe máximo.

La ruta `GET /inventario/alertas?emisorId=...` devuelve los contadores y el detalle de productos. El POS ya rechaza una venta cuando la cantidad solicitada supera el stock disponible; por tanto, el estado STOP queda protegido también en servidor.

**Importante:** ejecutar la migración en Supabase antes de desplegar esta versión.

## Funcionalidades ampliadas

- Caja: apertura, cierre, arqueo, movimientos, efectivo esperado, diferencias y reportes.
- Inventario con semáforo configurable: STOP/rojo, bajo/amarillo, normal/verde y sobrestock/naranja.
- Consulta de contribuyentes por RUC desde backend y adaptador opcional para un servicio autorizado del Registro Civil; no se hace scraping del Registro Civil.
- Correo obligatorio en cada factura. Cuando el SRI autoriza, el sistema envía automáticamente XML y RIDE al correo del cliente mediante Resend.
- Registro de intentos de correo en `email_envios`.
- Reporte de caja exportable desde el módulo de reportes.

### Migraciones nuevas

Ejecuta en Supabase SQL Editor, después de las migraciones base existentes:

1. `sql/migracion_alertas_inventario_semaforo.sql`
2. `sql/migracion_email_envios.sql`
3. `sql/migracion_caja.sql`

Y conserva el orden de las migraciones de IVA 5% y 8% para que la función `crear_venta` quede con la firma que usa el POS.

### Correo automático

Configura en el backend (nunca en el navegador): `RESEND_API_KEY` y `EMAIL_FROM`. El dominio remitente debe estar verificado en el proveedor de correo.

### Identidad / RUC

La consulta RUC usa el servicio de catastro configurado en `SRI_RUC_LOOKUP_URL`. Para cédula, el sistema primero intenta `REGISTRO_CIVIL_LOOKUP_URL` si existe y, si no está configurado, usa la consulta del SRI con el RUC de persona natural (`cédula + 001`). Para una integración real con Registro Civil se debe contratar/configurar el servicio de interoperabilidad autorizado.

## Interfaz profesional y correo

Esta versión añade una capa visual global con menú lateral en escritorio y menú inferior en móvil. Las pantallas protegidas seleccionan automáticamente el negocio cuando el usuario tiene uno solo asociado; si se navega sin `emisorId`, el backend redirige al negocio correcto en vez de mostrar "Falta emisorId".

### Exportaciones

- Inventario: semáforo, inventario valorizado, kardex y movimientos, en Excel/PDF según el reporte.
- Reportes: ventas, ventas por período, compras, clientes, proveedores, CxC, CxP, caja, proformas, rentabilidad e inventario valorizado.
- Las pantallas de gestión muestran una barra de exportación rápida cuando existe un reporte correspondiente.

### Reenvío de facturas

En **Reportes → Listado de ventas**, una factura autorizada muestra **Reenviar**. El sistema vuelve a generar el RIDE y adjunta el XML firmado almacenado, enviándolos mediante Resend desde el backend.

También existe `/correo-prueba?emisorId=...` para comprobar la configuración de `RESEND_API_KEY` y `EMAIL_FROM` sin exponer la API Key. Resend admite el envío de adjuntos desde su API oficial.

## Interfaz unificada profesional v5

Esta versión incorpora una capa visual global para que todos los módulos utilicen el mismo lenguaje de diseño: barra lateral azul, barra superior, buscador, negocio activo, usuario, títulos de módulo, tarjetas, tablas, formularios, botones, exportaciones y diseño responsive. Se mantiene la lógica existente de facturación, SRI, inventario, caja, cuentas, reportes y correo.
