(function () {
  const qs = new URLSearchParams(location.search);
  const emisorId = qs.get('emisorId');
  if (!emisorId) return;
  const q = encodeURIComponent(emisorId);
  const enlaces = [
    ['🏠 Inicio','/?emisorId='+q], ['🧾 Facturar','/pos?emisorId='+q],
    ['📦 Inventario','/inventario?emisorId='+q], ['💵 Caja','/caja?emisorId='+q],
    ['📊 Reportes','/reportes?emisorId='+q], ['👥 Clientes','/clientes-admin?emisorId='+q],
  ];
  const exportMap = {
    '/clientes-admin': ['clientes','👥 Exportar clientes'],
    '/proveedores-admin': ['proveedores','🚚 Exportar proveedores'],
    '/cuentas-por-cobrar': ['cuentas-por-cobrar','💰 Exportar CxC'],
    '/cuentas-por-pagar': ['cuentas-por-pagar','💳 Exportar CxP'],
    '/caja': ['caja','💵 Exportar caja'],
    '/productos-admin': ['inventario-valorizado','📦 Exportar inventario'],
    '/proformas': ['proformas','📝 Exportar proformas'],
  };
  document.addEventListener('DOMContentLoaded', function () {
    const nav = document.querySelector('header .nav');
    if (nav) {
      const existing = Array.from(nav.querySelectorAll('a')).map(a => a.getAttribute('href'));
      enlaces.forEach(([text, href]) => {
        if (existing.some(v => v && v.split('?')[0] === href.split('?')[0])) return;
        const a = document.createElement('a'); a.href = href; a.textContent = text; nav.appendChild(a);
      });
    }
    const key = location.pathname;
    if (key === '/reportes' || key === '/inventario' || !exportMap[key]) return;
    const [tipo, label] = exportMap[key];
    const cont = document.querySelector('.contenedor');
    if (!cont) return;
    const bar = document.createElement('div');
    bar.className = 'ec-toolbar';
    bar.style.marginTop = '14px';
    const base = '/reportes/exportar?emisorId=' + q + '&tipo=' + encodeURIComponent(tipo);
    bar.innerHTML = '<span class="ec-toolbar-title">Exportación rápida</span>' +
      '<a class="ec-export excel" target="_blank" href="' + base + '&formato=excel">⬇ Excel</a>' +
      '<a class="ec-export pdf" target="_blank" href="' + base + '&formato=pdf">⬇ PDF</a>';
    cont.insertBefore(bar, cont.firstElementChild);
  });
})();
