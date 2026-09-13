# CONTSERTRIB v9.9.55 — Reparación alta SaaS

Corrección puntual del alta de clientes desde el Panel Maestro ROOT.

## Objetivo

Evitar que una creación parcial (empresa + usuario) deje bloqueada la cuenta SaaS.
La ruta ahora:

- reutiliza una cuenta SaaS existente del mismo `admin_user_id`;
- recupera una cuenta existente por `email_admin`;
- crea la cuenta con las columnas base de v9.7;
- actualiza `datos_sri` cuando la columna existe;
- no elimina empresas, usuarios, RUC, comprobantes ni historial;
- conserva la estructura de matriz 001 y punto 001;
- conserva planes, suscripciones, IVA, SRI, caja, inventario, POS, contabilidad y reportes.

No requiere una migración SQL adicional para esta corrección.
