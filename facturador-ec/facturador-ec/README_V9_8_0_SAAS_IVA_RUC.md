# CONTSERTRIB v9.8.0 — SaaS, IVA configurable y alta por RUC

## Cambios incluidos

1. **IVA configurable por cliente/emisor**
   - Tabla `configuracion_iva`.
   - IVA general, reducido y turismo con porcentaje y código SRI separados.
   - La tarifa general inicial es 15%, reducida 5% y turismo 8%.
   - El POS consulta la configuración en cada negocio; ya no depende exclusivamente de porcentajes quemados en JavaScript.
   - Se permiten porcentajes numéricos futuros (por ejemplo 13%) sin cambiar el frontend.
   - Los códigos SRI se mantienen configurables porque un cambio de porcentaje no implica necesariamente el mismo código.
   - Se conserva compatibilidad con las columnas históricas `subtotal_0`, `subtotal_5`, `subtotal_8`, `subtotal_15`.

2. **Historial dinámico de impuestos**
   - Nueva tabla `comprobante_impuestos`.
   - Se registra la tarifa/código/base/valor por comprobante.
   - Los comprobantes históricos no se recalculan cuando se cambia una configuración futura.

3. **Panel SaaS**
   - Cambio de plan desde el botón **Cambiar plan**.
   - El cambio actualiza `suscripciones` y `cuentas_cliente_saas` sin borrar historial.
   - **Activar 30 días** ya existe y ahora no reduce una vigencia futura ya pagada.

4. **Registro SaaS por RUC**
   - Botón **Consultar SRI** y consulta automática al salir del campo RUC.
   - Autocompleta razón social, nombre comercial y dirección matriz.
   - Muestra estado, régimen, tipo de contribuyente, actividad principal y obligación contable cuando el servicio SRI configurado los devuelve.
   - Guarda los datos devueltos por SRI en `cuentas_cliente_saas.datos_sri`.

## Migración

Ejecutar una sola vez en Supabase:

`sql/migracion_iva_dinamico_saas_v980.sql`

Después desplegar el backend/frontend.

## Importante

La consulta depende de `SRI_RUC_LOOKUP_URL` (`sriRucLookupUrl`) ya existente en el backend. No se inventan datos si el servicio no responde.

Para una reforma tributaria real, primero debe verificarse la resolución/circular/ficha técnica del SRI y luego cambiar el porcentaje y el código oficial correspondiente desde el panel. No se deben alterar comprobantes históricos.
