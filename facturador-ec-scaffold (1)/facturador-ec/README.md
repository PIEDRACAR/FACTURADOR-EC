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

## Desplegar en Render

1. Sube este proyecto a un repositorio de GitHub (puede ser privado — Render
   soporta repos privados).
2. En Render: **New +** → **Web Service** → conecta el repositorio.
3. Configuración del servicio:
   - **Build command:** `npm install && npm run build`
   - **Start command:** `npm start`
   - **Health check path:** `/salud` (para que Render sepa que el servicio
     está vivo y no lo reinicie de más).
4. Version de Node: Render lee el campo `engines.node` de `package.json`
   automáticamente (ya está fijado en `>=24.18.0` en este proyecto), pero
   conviene confirmarlo en la pestaña *Environment* de Render por si acaso.
5. Variables de entorno a configurar en Render (pestaña *Environment*):
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
   - `P12_BASE64__<ALIAS>` — el certificado en base64 (ver `.env.example`
     para el comando exacto de conversión). **Esta es la forma correcta en
     Render**, porque su sistema de archivos es efímero: cualquier archivo
     que subas a mano al servidor desaparece en el siguiente redeploy o
     reinicio. El código ya soporta esto (`services/facturacion.ts` intenta
     primero `P12_BASE64__<alias>`, y solo si no la encuentra cae a leer un
     archivo del disco — que en Render no persistiría).
   - `P12_PASSWORD__<ALIAS>` — la contraseña del certificado, mismo alias.
   - `PORT` — Render la inyecta automáticamente, no hace falta definirla a
     mano; el código ya la lee de `process.env.PORT` vía `src/config/env.ts`.
6. **Plan gratuito de Render:** el servicio se "duerme" tras un rato sin
   tráfico y tarda unos segundos en despertar en la siguiente petición. Para
   un backend que un POS llama en cada venta, eso puede sentirse como una
   demora ocasional molesta al cobrar — vale la pena evaluar el plan pago
   más económico si eso llega a ser un problema real en producción.



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

- El manejo de la contraseña del `.p12` vía `P12_PASSWORD__<alias>` es un
  punto de partida simple; en producción real conviene un gestor de secretos
  de verdad (Supabase Vault u otro), no solo variables de entorno del proceso.
- Falta el endpoint para crear el comprobante en estado `'generado'` a partir
  del carrito del POS (con sus `comprobante_items` y `comprobante_formas_pago`)
  — hoy se asume que ya existe antes de llamar `/emitir`.
- Falta el descuento de inventario (`movimientos_inventario`) al confirmar
  una venta autorizada — todavía no está conectado en este scaffold.
- Falta manejo explícito del reintento cuando el SRI responde código 70
  ("en procesamiento") más allá de lo que la librería ya reintenta
  internamente (`maxError70Retries`).
