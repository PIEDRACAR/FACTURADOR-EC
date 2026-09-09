# CONTSERTRIB v9.7.7 — SaaS alto estándar

## Mejoras incorporadas

- Alta de cliente SaaS mediante RUC con validación estructural ecuatoriana en servidor.
- Consulta automática del RUC mediante el servicio configurado del catastro SRI.
- Autocompletado de razón social, nombre comercial, dirección matriz, estado, actividad, régimen, tipo de contribuyente y obligación de contabilidad cuando esos campos son devueltos por el servicio.
- El alta queda bloqueada si el RUC no existe o no está ACTIVO.
- El correo del administrador se solicita por separado: no se asume que el correo pueda obtenerse del RUC.
- Validaciones de plan al cambiar de plan: documentos consumidos, establecimientos, puntos de emisión y contribuyentes actuales no pueden exceder los límites del nuevo plan.
- Cambio de plan desde el panel maestro.
- Activación de 30 días desde el panel maestro, marcada como modalidad `prueba` y con trazabilidad de fecha/días.
- Registro de pagos y extensión de vigencia conservado.
- Auditoría SaaS para altas, cambios de plan, actualizaciones de suscripción y pagos.
- Conservación de RUC, comprobantes e historial al retirar un cliente del panel.
- No se almacenan contraseñas en la auditoría.

## Requisito operativo

La consulta automática depende de que `SRI_RUC_LOOKUP_URL` esté configurado en el backend con un servicio/endpoint de consulta compatible. El SRI dispone de una consulta pública de contribuyentes por RUC, pero no se debe asumir que un endpoint web de pantalla HTML sea una API JSON estable; para producción se recomienda un servicio de integración autorizado y monitoreado.

## Migración

Ejecutar:

`sql/migracion_saas_v977_alto_estandar.sql`

Después reiniciar el backend.

## Verificación técnica

- Sintaxis TypeScript modificada: validada con el compilador TypeScript mediante `transpileModule`.
- JavaScript del panel maestro: validado con `node --check`.
- El `npm run build` completo del paquete base requiere dependencias de tipos (`@types/node`, `@types/pdfkit`) que no quedaron disponibles en el entorno de revisión; esto corresponde al estado del entorno/dependencias y no a un error de sintaxis de los cambios v9.7.7.
