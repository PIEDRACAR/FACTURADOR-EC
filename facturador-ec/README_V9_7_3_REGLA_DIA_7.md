# CONTSERTRIB v9.7.3 — Regla de anulación día 7

- Se corrige el plazo de anulación en línea de facturas al día 7 del mes siguiente.
- Si el día 7 coincide con sábado, domingo o feriado, el sistema mueve automáticamente la fecha límite al siguiente día hábil.
- El cálculo utiliza la zona horaria de Ecuador (`America/Guayaquil`), no la zona del servidor.
- Se contemplan feriados nacionales fijos y móviles; se admite `FERIADOS_ECUADOR_EXTRA=YYYY-MM-DD,YYYY-MM-DD` para feriados locales o extraordinarios que deban configurarse.
- No requiere una migración adicional de Supabase.

Base normativa: Resolución SRI NAC-DGERCGC25-00000017, que sustituyó el día 10 por el día 7; se mantiene la regla de extensión cuando la fecha límite coincide con fin de semana o feriado.
