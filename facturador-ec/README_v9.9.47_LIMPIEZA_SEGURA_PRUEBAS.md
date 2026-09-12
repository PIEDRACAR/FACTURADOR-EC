# CONTSERTRIB v9.9.47 — Limpieza segura de datos para pruebas

## Objetivo

Esta versión **NO elimina funcionalidades del sistema**. La finalidad es limpiar los datos operativos de prueba para comenzar un ciclo de pruebas desde cero, conservando la estructura y seguridad de CONTSERTRIB.

### Se conserva

- Código y funcionalidades.
- Estructura de base de datos: tablas, columnas, índices, funciones, triggers, RLS y políticas.
- Usuarios de Supabase Auth.
- Acceso ROOT / `proveedores_admin`.
- Planes de suscripción.
- Catálogos tributarios maestros.
- Configuración maestra del proveedor.
- Todas las funcionalidades para volver a crear empresas, contribuyentes, clientes, productos, comprobantes, etc.

### Se limpian

- Empresas/emisores de prueba y datos dependientes.
- Clientes, productos, proveedores, inventario, caja y comprobantes.
- Contabilidad y nómina de prueba.
- Datos SaaS operativos de prueba.
- Solicitudes de registro, sesiones y auditoría de pruebas.

**No se eliminan usuarios de Supabase Auth ni el acceso ROOT.** Las sesiones de aplicación se limpian para que sea necesario iniciar sesión nuevamente.

## Corrección respecto a v9.9.46

El RESET anterior ejecutaba directamente `DELETE FROM facturas_saas`, aunque esa tabla puede no existir todavía en una base que no tenga todas las migraciones aplicadas. PostgreSQL devolvía `42P01`.

v9.9.47 utiliza comprobaciones de existencia antes de operar sobre tablas opcionales. Por tanto, una tabla ausente no provoca `42P01`.

## IMPORTANTE

No ejecutes el antiguo:

`sql/RESET_BD_PRUEBAS_DESDE_CERO_v9.9.46.sql`

Usa únicamente:

`sql/RESET_DATOS_PRUEBAS_NO_DESTRUCTIVO_v9.9.47.sql`

## Procedimiento

1. Haz un respaldo de Supabase si la base contiene datos que deban conservarse.
2. Abre **Supabase → SQL Editor**.
3. Ejecuta `RESET_DATOS_PRUEBAS_NO_DESTRUCTIVO_v9.9.47.sql`.
4. Revisa los mensajes `NOTICE` del final.
5. No ejecutes `DROP DATABASE`, `DROP TABLE` ni `TRUNCATE` para esta limpieza.
6. Despliega el código v9.9.47 en Railway.
7. Inicia sesión con ROOT.
8. Crea el primer emisor de prueba y realiza el ciclo completo de validación.

## Criterio de éxito

Las tablas operativas que existan deben mostrar `0` después de la limpieza. Las tablas que no existan se reportan como `TABLA NO EXISTE` y **no se crean ni se eliminan** mediante este script.

Si una relación FK impide limpiar los datos, PostgreSQL abortará la transacción. En ese caso, la operación completa se revierte y no se debe intentar resolverla borrando tablas o desactivando seguridad.
