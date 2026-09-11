/**
 * Se inserta justo después de <head> en cada página protegida (todas menos
 * /login y /registro). Hace dos cosas, sin tocar ni una línea del resto de
 * cada página ya construida:
 *
 * 1. Envuelve `window.fetch` una sola vez: si CUALQUIER petición de la
 *    página (todas las que ya existen, sin cambiarlas) devuelve 401,
 *    redirige a /login. Así la protección real —que vive en el backend,
 *    en `src/auth/proteccion.ts`— se refleja en la interfaz sin tener que
 *    editar los `fetch()` de las 12 pantallas una por una.
 * 2. Agrega un botón "Cerrar sesión" junto al enlace de Inicio que ya
 *    existe en la barra de navegación de cada pantalla (`#enlace-inicio`).
 */
const SCRIPT_PROTECCION = `
<script>
(function () {
  var _fetch = window.fetch;
  window.fetch = async function (...args) {
    const respuesta = await _fetch(...args);
    if (respuesta.status === 401) {
      window.location.href = '/login';
    }
    return respuesta;
  };

  document.addEventListener('DOMContentLoaded', function () {
    var enlaceInicio = document.getElementById('enlace-inicio');
    if (enlaceInicio && enlaceInicio.parentElement) {
      var salir = document.createElement('a');
      salir.href = '#';
      salir.textContent = 'Cerrar sesión';
      salir.style.marginLeft = 'auto';
      salir.addEventListener('click', async function (e) {
        e.preventDefault();
        await fetch('/auth/logout', { method: 'POST' });
        window.location.href = '/login';
      });
      enlaceInicio.parentElement.appendChild(salir);
    }
  });
})();
</script>`;

export function inyectarProteccionSesion(html: string): string {
  if (html.includes('</head>')) {
    const recursos = `<script>window.__FACTURADOR_EMISOR_ID__=(new URLSearchParams(location.search).get("emisorId")||localStorage.getItem("facturador_emisor_id")||"");</script>` +
      (html.includes('/app.css?v=9.9.25') ? '' : '<link rel="stylesheet" href="/app.css?v=9.9.25">') +
      (html.includes('/app-shell.js?v=9.9.25') ? '' : '<script src="/app-shell.js?v=9.9.25" defer></script>');
    return html.replace('</head>', `${recursos}\n${SCRIPT_PROTECCION}\n</head>`);
  }
  // Respaldo por si alguna página no tiene </head> explícito.
  return SCRIPT_PROTECCION + html;
}
