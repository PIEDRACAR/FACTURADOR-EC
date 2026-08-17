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
| Registro de negocio | `/registro` | Alta de un negocio nuevo (emisor + punto de emisión + certificado cifrado), sin tocar SQL |
| Catálogo de productos | `/productos-admin?emisorId=X` | Crear, editar, activar/desactivar productos; código de barras opcional |
| Punto de venta | `/pos?emisorId=X` | Carrito, escáner de código de barras, cobro, emisión automática |
| Proformas | `/proformas?emisorId=X` | Cotizaciones — se convierten en venta real con un clic |
| Reportes | `/reportes?emisorId=X` | Rentabilidad por producto (ingresos, costo, utilidad, margen) en un rango de fechas |

### Registro de negocio (`/registro`)

Da de alta un negocio nuevo completo en un solo paso, llamando a
`POST /emisores/registrar`: el certificado `.p12` y su contraseña se cifran
con AES-256-GCM (`src/crypto/secrets.ts`) usando una única llave maestra
del sistema (`SECRETS_ENCRYPTION_KEY`) y se guardan cifrados en Supabase —
ya no se usan variables de entorno por cliente.

### Catálogo de productos (`/productos-admin`)

Cada producto guarda código interno, código de barras (opcional, columna
`codigo_auxiliar`), descripción, precio, costo, tarifa de IVA y stock
actual/mínimo. Desactivar un producto (`activo=false`) no borra el
historial: las facturas ya emitidas guardan su propia copia de
descripción/precio en `comprobante_items`.

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

### Proformas (`/proformas`)

Cotizaciones sin efecto tributario ni de inventario. Al convertir una
proforma vigente en venta (`POST /proformas/:id/convertir`), se honra el
precio **originalmente cotizado** (no el precio actual del catálogo, que
pudo haber cambiado desde entonces), y se reusa exactamente el mismo camino
que `/pos/venta` (inventario + emisión SRI incluidos).

### Reportes (`/reportes`)

`GET /reportes/rentabilidad?emisorId=X&desde=&hasta=` agrega por producto,
sobre ventas ya `autorizado`as: cantidad vendida, ingresos, costo (al costo
real que tenía el producto en el momento de cada venta, no el costo actual),
utilidad y margen %. Rango de fechas configurable, por defecto últimos 30 días.

### RIDE en PDF (`GET /comprobantes/:id/ride`)

Genera el PDF de la factura al vuelo a partir de lo ya guardado en
Supabase (no vuelve a tocar el SRI), con código de barras Code128 de la
clave de acceso. Si el emisor está en ambiente de pruebas, el PDF lo marca
visiblemente ("este comprobante no tiene validez tributaria").

## Migraciones SQL

Ejecutar en el SQL Editor de Supabase, en este orden, cada una una sola vez:

1. `setup-supabase-facturador.sql` — esquema completo (todas las tablas)
2. `sql/increment_secuencial.sql` — función atómica de secuenciales
3. `sql/migracion_certificados_cifrados.sql` — columnas cifradas del certificado
4. `sql/migracion_secuencial_nulo.sql` — permite `comprobantes.secuencial` nulo hasta emitir
5. `sql/migracion_crear_venta_atomica.sql` — función `crear_venta` (comprobante + inventario en una transacción)

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
5. Ejecutar todas las migraciones de la sección anterior en Supabase.
6. **Plan gratuito:** el servicio puede "dormirse" tras un rato sin
   tráfico y tardar unos segundos en despertar en la siguiente petición.

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
