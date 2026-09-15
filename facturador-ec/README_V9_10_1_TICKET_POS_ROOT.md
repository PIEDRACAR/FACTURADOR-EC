# CONTSERTRIB v9.10.1 — Ticket/POS por contribuyente, control ROOT

## Objetivo
La autorización de Ticket/POS queda controlada exclusivamente desde **Panel Maestro** por el administrador ROOT. El contribuyente no dispone de un interruptor para auto-habilitarse.

## Flujo
1. El plan comercial debe tener activado **Permite Ticket/POS**.
2. ROOT entra a **Panel Maestro → Clientes y contribuyentes**.
3. ROOT identifica el contribuyente.
4. Puede usar **Activar POS** / **Desactivar POS** o entrar a **Gestionar**.
5. La operación queda registrada en `auditoria_ticket_pos`.
6. El backend vuelve a comprobar plan + autorización individual antes de permitir las operaciones POS.

## Base de datos
Ejecutar en Supabase:
`sql/migracion_ticket_pos_root_v9101.sql`

La migración es aditiva e idempotente: no elimina comprobantes, ventas, XML, RIDE, clientes ni historial.

## Seguridad
- La ruta de administración exige el mismo control de administrador proveedor/ROOT existente.
- El frontend no es la única barrera: `/pos/puntos-emision` y `/pos/venta` verifican la autorización en servidor.
- Desactivar Ticket/POS no borra ventas anteriores.
- Cambiar el plan no borra la autorización almacenada; al intentar usar POS, el servidor exige además que el nuevo plan lo permita.
