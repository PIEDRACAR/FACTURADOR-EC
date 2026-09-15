# CONTSERTRIB v9.7.5

## Cambios principales

1. **SaaS – cambio de plan por cliente**
   - En el detalle del cliente aparece "Cambiar plan".
   - El cambio actualiza la suscripción y la cuenta SaaS asociada.
   - No borra documentos ni historial.

2. **SaaS – activación por 30 días**
   - Se conserva el botón "Activar 30 días".
   - La vigencia se calcula con fecha Ecuador.
   - Los pagos permiten extender desde el vencimiento vigente.

3. **Alta de cliente SaaS por RUC**
   - El administrador ingresa el RUC y CONTSERTRIB consulta el catastro RUC configurado del SRI.
   - Se autocompletan razón social, nombre comercial, dirección, estado, tipo, obligación de contabilidad, actividad principal y otros campos disponibles.
   - El alta sigue requiriendo correo del administrador y selección de plan.

4. **Motor tributario Ecuador**
   - Reglas versionadas por fecha de inicio/fin.
   - Código de porcentaje SRI configurable por regla.
   - Feriados con fecha, nombre, tipo y base legal.
   - Perfil tributario por emisor para actividad turística, Registro de Turismo y LUAF.
   - Reglas 2026 sembradas para IVA general 15%, construcción 5%, Carnaval 8% y Batalla de Pichincha 8%.
   - Los productos existentes con 15% pasan a `general`, permitiendo que un cambio futuro de la tarifa general se aplique automáticamente sin modificar comprobantes históricos.
   - La venta guarda el desglose tributario y la regla aplicada en el comprobante/item.
   - Se agrega `crear_venta_dinamica` sin eliminar la función anterior.

5. **Configuración**
   - Nueva sección "Motor tributario Ecuador" para indicar actividad turística, Registro de Turismo y LUAF.

## Migración obligatoria

Ejecutar en Supabase:

`sql/migracion_motor_tributario_v975.sql`

La migración es acumulativa y no elimina comprobantes históricos.

## Importante

El motor no inventa beneficios tributarios: una regla temporal debe existir en la tabla con su vigencia y base legal. Las futuras resoluciones/decretos deben incorporarse como nuevas reglas, sin editar las reglas históricas.

## Verificación

- ZIP integrity: debe verificarse antes de entrega.
- JavaScript embebido HTML: verificado sin errores de sintaxis.
- Build TypeScript completo: no se declara verificado porque este entorno no tiene `node_modules` instalado.
