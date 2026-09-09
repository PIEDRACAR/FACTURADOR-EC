# CONTSERTRIB v9.7.13 — UI BOOT FIX

Corrección estructural: las páginas protegidas cargan explícitamente `app.css` y `app-shell.js` para funcionar tanto cuando las sirve Fastify como cuando el hosting entrega directamente `public/`.

El inyector de sesión detecta esos recursos y NO los duplica. No se crean routers, proveedores ni módulos paralelos.
