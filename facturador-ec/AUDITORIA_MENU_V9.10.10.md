# CONTSERTRIB v9.10.10 — Auditoría y corrección del menú lateral

- En escritorio, el botón del encabezado ahora oculta/muestra completamente el menú lateral.
- Al ocultarlo, el contenido ocupa todo el ancho disponible; no queda una barra lateral de 78 px.
- La preferencia se conserva en `localStorage` mediante `contsertrib_sidebar_hidden`.
- En móvil se conserva el comportamiento de panel deslizable con overlay.
- El botón actualiza `aria-expanded`, `aria-label` y `title`.
- Se conserva el modo oscuro con contraste específico para el botón.
- No se eliminaron rutas ni elementos de navegación.
