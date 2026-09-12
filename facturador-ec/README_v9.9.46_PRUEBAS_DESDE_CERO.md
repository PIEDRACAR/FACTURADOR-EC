# CONTSERTRIB v9.9.46 — Entorno limpio para pruebas desde cero

## Objetivo

Esta versión parte de la base funcional v9.9.45 y agrega un procedimiento seguro y explícito para dejar la base de datos de pruebas sin contribuyentes ni clientes, conservando la estructura del sistema y el acceso ROOT.

## Qué conserva

- Usuarios de Supabase Auth.
- Usuario/rol ROOT existente.
- `proveedores_admin`.
- Planes de suscripción.
- Catálogos tributarios maestros.
- `configuracion_proveedor` y sus correos ROOT.
- `control_migraciones`.
- Todo el código y las migraciones.

## Qué elimina

- Todos los emisores/contribuyentes.
- Todos los clientes de los emisores.
- Productos, proveedores, inventario, caja y comprobantes de los emisores.
- Contabilidad y nómina de los emisores.
- Configuración tributaria y de RIDE de los emisores.
- Cuentas SaaS de clientes, suscripciones y facturas SaaS de pruebas.
- Solicitudes de registro y sesiones activas.
- Auditoría SaaS de pruebas.

## Archivo SQL

`sql/RESET_BD_PRUEBAS_DESDE_CERO_v9.9.46.sql`

### IMPORTANTE

Es destructivo. Ejecutarlo únicamente sobre la base de pruebas que se quiera reiniciar.

El script usa transacción y una comprobación final. Si la comprobación detecta que quedan emisores, clientes, comprobantes, productos, proveedores o cuentas SaaS, lanza una excepción y la transacción se revierte.

No borra usuarios de `auth.users`, por lo que no elimina el ROOT ni sus credenciales.

## Orden recomendado de instalación

1. Respaldar la base si existe información que pueda necesitarse.
2. Abrir Supabase → SQL Editor.
3. Ejecutar `sql/RESET_BD_PRUEBAS_DESDE_CERO_v9.9.46.sql`.
4. Confirmar el mensaje de NOTICE de base limpia.
5. Desplegar este ZIP en Railway.
6. Iniciar sesión con ROOT.
7. Crear el primer contribuyente desde el Panel Maestro.
8. Configurar matriz, punto de emisión, certificado, correo y logo.
9. Crear productos y clientes de prueba.
10. Emitir primero en ambiente de pruebas SRI.

## Nota sobre Supabase Storage

El reset limpia la base de datos y el índice `comprobante_archivos`, pero no elimina físicamente objetos del bucket privado de Supabase Storage. Si el entorno ya tenía archivos de pruebas, vaciar manualmente el bucket `comprobantes` desde Supabase Storage antes de comenzar una prueba completamente limpia.

## Nota sobre Railway

Las variables de entorno NO se modifican con este reset. Deben conservarse las credenciales/configuración necesarias del proyecto, incluyendo el RUC central del proveedor, Supabase y SRI.
