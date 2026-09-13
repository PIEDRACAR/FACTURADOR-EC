# CONTSERTRIB v9.9.42 — IVA maestro por decreto/feriado

## Objetivo
La administración de tarifas especiales temporales queda centralizada en el Panel Maestro ROOT. Los clientes no pueden crear ni cambiar períodos de decreto.

## Funcionalidad
- Panel Maestro → Motor tributario maestro → IVA por decreto.
- Alta, activación/desactivación y consulta de vigencias especiales.
- Fecha desde/hasta, tarifa, código SRI, sector, base legal.
- Aplicación automática opcional y requisito de turismo.
- Elegibilidad turística por emisor administrada por ROOT (Registro de Turismo y LUAF).
- POS aplica automáticamente la tarifa especial vigente a líneas de tarifa general cuando el emisor está habilitado y existe una regla automática vigente.
- Tarifas 0%, 5%, exento y no objeto no son sustituidas por la regla turística.
- Si alguien intenta usar 8% fuera de vigencia o en un emisor no habilitado, la emisión es bloqueada.
- Los comprobantes históricos no se recalculan.

## Seguridad tributaria
La impresión/RIDE, XML, firma, clave de acceso y transmisión SRI no se modifican por esta funcionalidad. El motor solo determina la tarifa antes de construir la factura. Cada comprobante guarda su tarifa aplicada en sus datos de detalle/impuestos.

## Migración
`sql/migracion_contsertrib_v9941_iva_maestro_decretos.sql`

Es aditiva y recarga PostgREST. No elimina información histórica.
