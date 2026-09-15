# CONTSERTRIB v9.7.2 — Configuración clara de RUC, matriz, sucursales y puntos

## Cambios
- Configuración separa claramente: RUC/contribuyente → matriz/sucursales → puntos de emisión.
- `establecimientos_emisor.tipo_establecimiento`: MATRIZ o SUCURSAL.
- Un RUC solo puede tener una matriz en la estructura del sistema.
- Corregir nombre/dirección de establecimientos desde Configuración.
- Eliminar establecimiento/punto: si existe estructura o historial, se desactiva para conservar trazabilidad; si no tiene dependencias, se elimina físicamente.
- Al desactivar un establecimiento, sus puntos quedan inactivos.
- Los botones de activar/desactivar puntos respetan límites del plan.
- Alta de establecimientos/puntos desde Configuración respeta límites del plan contratado.
- Panel proveedor: “Eliminar del panel” elimina la cuenta comercial de la lista y cancela la suscripción, pero conserva RUC, comprobantes y documentos históricos.
- Un RUC eliminado del panel puede volver a registrarse sin duplicar el RUC; se reutiliza el emisor archivado y se conserva el historial.
- Las peticiones DELETE sin cuerpo no envían `Content-Type: application/json`, evitando el HTTP 400 anterior.

## Migración
Ejecutar una sola vez:
`sql/migracion_configuracion_estructura_v972.sql`

## Importante
La apertura/cierre/modificación tributaria de establecimientos debe realizarse ante el SRI. Esta configuración administra la estructura operativa interna de CONTSERTRIB.

## Verificación
- ZIP íntegro.
- JavaScript embebido de HTML validado con `node --check`.
- TypeScript revisado con `tsc`; no aparecen errores de nullability nuevos en `configuracion.ts` ni `proveedor.ts`. El entorno de verificación no tiene instaladas las dependencias del proyecto, por lo que no se declara un build completo exitoso.
