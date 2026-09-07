(function () {
  const path = location.pathname;
  const isProtectedPage = path !== '/login' && path !== '/registro';
  const qs = new URLSearchParams(location.search);
  let emisorId = qs.get('emisorId') || localStorage.getItem('facturador_emisor_id');

  const modulo = [
    ['/','🏠','Inicio'], ['/pos','🧾','Facturar'], ['/proformas','📝','Proformas'],
    ['/productos-admin','📦','Productos'], ['/inventario','📊','Inventario'],
    ['/clientes-admin','👥','Clientes'], ['/proveedores-admin','🚚','Proveedores'],
    ['/caja','💵','Caja'], ['/cuentas-por-cobrar','💰','Por cobrar'],
    ['/cuentas-por-pagar','💳','Por pagar'], ['/reportes','📈','Reportes'], ['/usuarios-admin','⚙️','Usuarios'], ['/correo-prueba','✉️','Correo'],
  ];

  function goWithBusiness() {
    if (!emisorId || !isProtectedPage || path === '/') return;
    if (!qs.get('emisorId')) {
      const url = new URL(location.href);
      url.searchParams.set('emisorId', emisorId);
      history.replaceState({}, '', url.toString());
    }
  }

  async function resolveBusiness() {
    if (!isProtectedPage || path === '/login' || path === '/registro') return;
    try {
      const r = await fetch('/auth/yo');
      if (r.status === 401) { location.href = '/login'; return; }
      if (!r.ok) return;
      const data = await r.json();
      const negocios = data.negocios || [];
      const almacenado = localStorage.getItem('facturador_emisor_id');
      const elegido = negocios.find(n => n.emisorId === emisorId) || negocios.find(n => n.emisorId === almacenado) || negocios[0];
      if (!elegido) return;
      emisorId = elegido.emisorId;
      localStorage.setItem('facturador_emisor_id', emisorId);
      if (path !== '/' && !qs.get('emisorId')) {
        const url = new URL(location.href); url.searchParams.set('emisorId', emisorId); location.replace(url.toString()); return;
      }
      goWithBusiness();
      renderShell(elegido);
    } catch (_) {}
  }

  function renderShell(negocio) {
    if (!document.body || document.querySelector('.ec-sidebar')) return;
    const q = encodeURIComponent(emisorId || '');
    const aside = document.createElement('aside');
    aside.className = 'ec-sidebar';
    aside.innerHTML = `
      <div class="ec-brand"><span class="ec-brand-icon">🧾</span><div><strong>Facturador EC</strong><small>Sistema de Facturación Electrónica</small></div></div>
      <div class="ec-business"><small>NEGOCIO ACTIVO</small><strong>${escapeHtml(negocio.nombreComercial || negocio.razonSocial)}</strong><span>${escapeHtml(negocio.rol || 'Usuario')}</span></div>
      <nav class="ec-menu">
        <div class="ec-menu-section">Principal</div>
        ${modulo.slice(0,5).map(([href,icon,label]) => `<a class="${path===href?'active':''}" href="${href}?emisorId=${q}"><span>${icon}</span>${label}</a>`).join('')}
        <div class="ec-menu-section">Gestión</div>
        ${modulo.slice(5,11).map(([href,icon,label]) => `<a class="${path===href?'active':''}" href="${href}?emisorId=${q}"><span>${icon}</span>${label}</a>`).join('')}
        <div class="ec-menu-section">Administración</div>
        ${modulo.slice(11).map(([href,icon,label]) => `<a class="${path===href?'active':''}" href="${href}?emisorId=${q}"><span>${icon}</span>${label}</a>`).join('')}
      </nav>
      <div class="ec-sidebar-foot"><a href="#" id="ec-cambiar-negocio">⇄ Cambiar negocio</a><a href="#" id="ec-salir">↪ Cerrar sesión</a></div>`;
    document.body.prepend(aside);
    document.body.classList.add('ec-shell-active');
    const header = document.querySelector('body > header');
    if (header) {
      header.classList.add('ec-topbar');
      header.innerHTML = `<div class="ec-head-logo"><span class="ec-head-icon">🧾</span><div><b>Facturador EC</b><small>Sistema de Facturación Electrónica</small></div></div><div class="ec-head-spacer"></div><div class="ec-head-business"><span>🏢</span><div><strong>${escapeHtml(negocio.nombreComercial || negocio.razonSocial)}</strong><small>RUC / negocio activo</small></div></div><div class="ec-head-user"><span class="ec-avatar">${escapeHtml((negocio.rol || 'U').slice(0,1).toUpperCase())}</span><div><strong>${escapeHtml(negocio.rol || 'Usuario')}</strong><small>Sesión activa</small></div></div>`;
    }
    document.getElementById('ec-salir')?.addEventListener('click', async e => { e.preventDefault(); await fetch('/auth/logout',{method:'POST'}); localStorage.removeItem('facturador_emisor_id'); location.href='/login'; });
    document.getElementById('ec-cambiar-negocio')?.addEventListener('click', async e => { e.preventDefault(); const r=await fetch('/auth/yo'); const d=await r.json(); if((d.negocios||[]).length<=1)return alert('Tu usuario solo tiene un negocio asociado.'); const opts=d.negocios.map((n,i)=>`${i+1}. ${n.nombreComercial||n.razonSocial}`).join('\n'); const n=prompt('Selecciona el número del negocio:\n\n'+opts); const i=Number(n)-1; if(d.negocios[i]){localStorage.setItem('facturador_emisor_id',d.negocios[i].emisorId); const u=new URL(location.href);u.searchParams.set('emisorId',d.negocios[i].emisorId);location.href=u.toString();}});
  }

  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }

  document.addEventListener('DOMContentLoaded', () => {
    const nav = document.querySelector('header .nav');
    if (nav && emisorId) {
      nav.innerHTML = modulo.slice(0,7).map(([href,icon,label]) => `<a href="${href}?emisorId=${encodeURIComponent(emisorId)}">${icon} ${label}</a>`).join('');
    }
    addExportToolbar();
  });

  function addExportToolbar() {
    if (!emisorId) return;
    const cont = document.querySelector('.contenedor'); if (!cont) return;
    const map = {
      '/clientes-admin':['clientes','👥 Exportar clientes'], '/proveedores-admin':['proveedores','🚚 Exportar proveedores'],
      '/cuentas-por-cobrar':['cuentas-por-cobrar','💰 Exportar CxC'], '/cuentas-por-pagar':['cuentas-por-pagar','💳 Exportar CxP'],
      '/caja':['caja','💵 Exportar caja'], '/productos-admin':['inventario-valorizado','📦 Exportar inventario'], '/proformas':['proformas','📝 Exportar proformas']
    };
    if (!map[path] || cont.querySelector('.ec-global-export')) return;
    const [tipo,label]=map[path], base=`/reportes/exportar?emisorId=${encodeURIComponent(emisorId)}&tipo=${encodeURIComponent(tipo)}`;
    const bar=document.createElement('div'); bar.className='ec-toolbar ec-global-export';
    bar.innerHTML=`<span class="ec-toolbar-title">${label}</span><a class="ec-export excel" target="_blank" href="${base}&formato=excel">⬇ Excel</a><a class="ec-export pdf" target="_blank" href="${base}&formato=pdf">⬇ PDF</a>`;
    cont.prepend(bar);
  }

  resolveBusiness();
})();
