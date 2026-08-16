# facturador-ec — backend de facturación electrónica SRI Ecuador

Scaffold real (probado: compila con `tsc`, arranca con `tsx`, responde en `/salud`)
del backend del facturador electrónico, construido sobre `facturacion-electronica-ec`
tras comparar esa librería contra `open-factura` (ver sección 14 del documento
de arquitectura — se descartó `open-factura` por un bug real de manejo de fechas
y por generar XML contra una ficha técnica desactualizada).

## Requisitos

- **Node.js >= 24.18.0** (exigido por `facturacion-electronica-ec`; si tu
  máquina tiene una versión menor, instala una más nueva con `nvm` antes de
  correr esto en serio — este scaffold se armó y probó en un entorno con
  Node 22, que basta para desarrollar/compilar, pero para ejecutar la firma
  real hace falta la versión que la librería exige).
- Un proyecto de Supabase con el esquema de `setup-supabase-facturador.sql`
  y la migración `sql/increment_secuencial.sql` ya aplicados.
- Un certificado `.p12` real emitido por una entidad certificadora autorizada
  por el SRI.

## Instalación

```bash
npm install
cp .env.example .env
# completar SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en .env
```

## Correr en desarrollo

```bash
npm run dev
```

## Estructura

```
src/
├── index.ts                          servidor Fastify, punto de entrada
├── config/env.ts                     variables de entorno tipadas y validadas
├── db/supabase.ts                    cliente de Supabase (service role, solo backend)
├── sequence/supabaseSequenceProvider.ts  implementa ISequenceProvider sobre la tabla puntos_emision
├── services/facturacion.ts           orquesta FacturacionElectronicaEC por emisor
└── routes/comprobantes.ts            endpoints HTTP (POST emitir, GET consultar)

sql/increment_secuencial.sql          función atómica de incremento de secuenciales (ejecutar en Supabase)
```

## Registro de negocios (autoservicio)

Ya no hace falta insertar filas a mano en Supabase ni crear variables de
entorno por cliente en Railway/Render. Con el backend desplegado, entra a:

```
https://tu-dominio.app/registro
```

Ese formulario da de alta un negocio nuevo completo (emisor + punto de
emisión + certificado, cifrado) en un solo paso, llamando a
`POST /emisores/registrar` por detrás. Es el reemplazo directo de los
`insert into emisores/puntos_emision/certificados` que se hacían a mano
durante las pruebas iniciales.

**Requisito antes de usarlo:** ejecutar `sql/migracion_certificados_cifrados.sql`
en el SQL Editor de Supabase (una sola vez), y definir la variable de
entorno `SECRETS_ENCRYPTION_KEY` en el hosting (ver más abajo).

## Punto de venta (POS)

```
https://tu-dominio.app/pos?emisorId=EL_ID_DEL_EMISOR
```

Carrito completo: buscador de productos (o línea libre sin catálogo),
cliente opcional (Consumidor Final por defecto), formas de pago —incluye
pago dividido—, y al confirmar llama a `POST /pos/venta`, que:

1. Recalcula precio e IVA de cada línea **en el servidor**, contra la tabla
   `productos` — nunca confía en el precio que mande el navegador.
2. Valida que la suma de las formas de pago cuadre con el total (±1 centavo).
3. Crea el `comprobante` + `comprobante_items` + `comprobante_formas_pago`.
4. Llama a `emitirFactura` (el mismo motor ya probado contra el SRI) y
   devuelve el resultado (AUTORIZADO / rechazado) al instante.

Requiere que el emisor ya tenga productos cargados en la tabla `productos`
(la pantalla para cargarlos desde una interfaz todavía no existe — por
ahora se insertan por SQL o vía la API de Supabase directamente) y que
haya corrido `sql/migracion_secuencial_nulo.sql` (ver abajo).

**Nota:** el descuento de inventario (`movimientos_inventario` y resta de
`productos.stock_actual`) todavía NO está conectado en este endpoint — el
carrito valida que haya stock suficiente antes de vender, pero no lo
descuenta al confirmar. Es el siguiente pendiente de la lista.

## Desplegar en Render / Railway

1. Sube este proyecto a un repositorio de GitHub (puede ser privado).
2. Conecta el repositorio en Render o Railway.
3. Configuración del servicio:
   - **Build command:** `npm install && npm run build`
   - **Start command:** `npm start`
   - **Health check path:** `/salud`
4. Variables de entorno a configurar:
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
   - `SECRETS_ENCRYPTION_KEY` — llave maestra única para todo el sistema,
     usada para cifrar el certificado .p12 y la contraseña de CADA emisor
     dentro de Supabase (ver `src/crypto/secrets.ts`). Se genera **una sola
     vez** con:
     ```
     node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
     ```
     Guárdala en un lugar seguro aparte — si se pierde, todos los
     certificados guardados quedan ilegibles y hay que volver a subirlos
     desde `/registro`.
   - `PORT` — la mayoría de hostings la inyectan automáticamente.
5. Ejecutar en Supabase, si no lo has hecho ya:
   - `sql/migracion_certificados_cifrados.sql`
   - `sql/migracion_secuencial_nulo.sql` — deja `comprobantes.secuencial`
     como opcional al crear la fila, porque el número real lo asigna la
     librería en el momento de emitir (no antes). Sin esta migración,
     `/pos/venta` fallará al crear el comprobante.
6. **Plan gratuito:** el servicio puede "dormirse" tras un rato sin
   tráfico y tardar unos segundos en despertar en la siguiente petición.
   Vale la pena evaluar un plan pago si eso se vuelve un problema real.

Nota sobre las variables `P12_BASE64__<alias>` / `P12_PASSWORD__<alias>`
de versiones anteriores de este scaffold: **ya no se usan.** El certificado
y su contraseña ahora se guardan cifrados en la tabla `certificados`
(columnas `p12_cifrado` y `p12_password_cifrado`), cargados desde
`/registro`. Si tienes un emisor de una prueba anterior que solo tenía
esas variables de entorno, tendrás que volver a registrarlo desde
`/registro` para que quede con el certificado cifrado en base de datos.



Este scaffold se generó y se probó de forma automatizada solo hasta donde fue
posible sin un certificado real ni acceso a internet hacia `sri.gob.ec`
(ambas cosas fuera del alcance del entorno donde se armó). Antes de usar esto
en producción, falta —de tu lado, en tu propia máquina— cuando menos:

1. Aplicar `setup-supabase-facturador.sql` y luego `sql/increment_secuencial.sql`
   en un proyecto de Supabase real.
2. Insertar manualmente una fila de prueba en `emisores`, `puntos_emision` y
   `certificados` (con tu `.p12` real en disco, referenciado desde
   `certificados.referencia_almacenamiento`, y su contraseña en la variable
   de entorno `P12_PASSWORD__<ALIAS>`).
3. Insertar una fila en `comprobantes` con estado `'generado'`.
4. Llamar `POST /comprobantes/factura/emitir` con ese `comprobanteId` y los
   datos de la factura — con `emisor.ambiente = '1'` (pruebas), para que
   vaya contra el ambiente de pruebas del SRI, nunca producción en esta
   primera prueba.
5. Confirmar que el estado devuelto sea `AUTORIZADO`.

## Pendientes conocidos de este scaffold (no resueltos a propósito, quedan para cuando se conecte con el POS real)

- ~~El manejo de la contraseña del `.p12`~~ — **resuelto**: ahora se guarda
  cifrada en Supabase (`certificados.p12_password_cifrado`), no en
  variables de entorno por cliente. Ver `src/crypto/secrets.ts`.
- Falta el endpoint para crear el comprobante en estado `'generado'` a partir
  del carrito del POS — **resuelto**: `POST /pos/venta` (ver arriba), con
  pantalla en `/pos`.
- Falta el descuento de inventario (`movimientos_inventario`) al confirmar
  una venta autorizada — todavía no está conectado en este scaffold.
- Falta manejo explícito del reintento cuando el SRI responde código 70
  ("en procesamiento") más allá de lo que la librería ya reintenta
  internamente (`maxError70Retries`).
