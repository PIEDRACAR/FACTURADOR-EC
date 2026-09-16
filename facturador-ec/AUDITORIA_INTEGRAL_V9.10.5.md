# CONTSERTRIB FACTURACIÓN — Auditoría Integral v9.10.5

## Alcance
Auditoría estática de producción sobre arquitectura, autenticación, autorización, aislamiento por contribuyente/emisor, módulos por plan, contabilidad, POS/Ticket, emisión, operaciones SaaS, reportes, manejo de errores, dependencias de despliegue y migraciones SQL presentes en el proyecto.

## Correcciones aplicadas

### Críticas / altas
1. **Protección de identidad en el registro público**
   - Una dirección de correo ya existente no puede usarse desde el alta pública para cambiar la contraseña del usuario.
   - Cuando el correo ya existe, se valida la contraseña existente antes de reutilizar la identidad.
   - El restablecimiento explícito de una contraseña continúa permitido únicamente en flujos administrativos autenticados.

2. **Autorización por módulos en backend**
   - Se incorporó `contabilidad` a la matriz de permisos.
   - Se mapearon rutas de usuarios, contabilidad y ATS.
   - Los módulos definidos desde Panel Maestro mediante `modulos_config` ahora se hacen cumplir en backend.
   - Se conserva compatibilidad con las banderas heredadas de los planes.

3. **Aislamiento de pagos de cuentas por cobrar/pagar**
   - Los pagos/cobros anidados ahora verifican que el pago pertenezca realmente a la cuenta indicada antes de contabilizarlo.
   - Evita mezclar recursos entre cuentas del mismo tipo.

4. **Búsqueda global con control de permisos**
   - La búsqueda global ya no entrega información contable a usuarios sin permiso de contabilidad ni clientes/productos a perfiles que no tengan el permiso correspondiente.

5. **Errores de API en producción**
   - Se evita exponer `error.message`/detalles internos directamente en respuestas API cuando `NODE_ENV=production`.
   - En desarrollo se mantiene el detalle para diagnóstico.

### Integridad / operación
6. **Reproducibilidad del paquete**
   - `package.json` y `package-lock.json` quedaron alineados en v9.10.5.
   - Se mantiene Node >=24.18.0 y npm 11.19.0.

7. **Precios públicos**
   - Se eliminó un precio fallback antiguo codificado en la página pública de registro.
   - El frontend ahora informa que los planes no pudieron cargarse, en vez de mostrar un precio obsoleto.

8. **Planificación de índices de rendimiento**
   - Se añadió migración aditiva `sql/migracion_v9105_auditoria_integral_integridad.sql` con índices para consultas frecuentes de certificados, suscripciones, contribuyentes SaaS, comprobantes y movimientos de inventario.
   - No elimina datos, columnas ni constraints existentes.

## Hallazgos que requieren validación en entorno real

- Las migraciones históricas contienen varias funciones SQL recreadas con `CREATE OR REPLACE` en distintos archivos. El resultado efectivo depende del orden de ejecución. Esto debe mantenerse en un único orden de migración controlado y documentado.
- El proyecto no incorpora una batería automatizada de pruebas de regresión suficientemente amplia para certificar en local todos los flujos SRI/Supabase. El ZIP debe pasar por Railway con Node 24 y pruebas de humo contra el proyecto Supabase real.
- La autorización SRI, firma electrónica, RIDE, Storage, Resend y Payphone requieren validación end-to-end en el entorno configurado; una auditoría estática no debe presentarse como una autorización SRI real.

## Recomendación de despliegue

1. Desplegar el ZIP en Railway usando Node 24.20.0 / npm 11.19.0.
2. Ejecutar una sola vez en Supabase la migración `sql/migracion_v9105_auditoria_integral_integridad.sql`.
3. Probar con una cuenta ROOT, una cuenta de administrador de empresa, un contador y un cajero.
4. Validar aislamiento entre dos contribuyentes distintos antes de habilitar producción.
5. Ejecutar una emisión de prueba en el ambiente SRI configurado y comprobar XML, RIDE, Storage, correo y trazabilidad.
6. Probar activación/desactivación de módulos desde Panel Maestro y la activación individual de Ticket/POS por contribuyente.

## Criterio de seguridad
No se agregaron credenciales, contraseñas maestras ni secretos en el código. Los cambios de base de datos son aditivos y se evitaron constraints destructivos que pudieran bloquear históricos existentes.
