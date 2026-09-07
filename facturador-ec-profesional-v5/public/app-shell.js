(function () {
  const path = location.pathname.replace(/\/$/, '') || '/';
  const isProtectedPage = path !== '/login' && path !== '/registro';
  const qs = new URLSearchParams(location.search);
  let emisorId = qs.get('emisorId') || localStorage.getItem('facturador_emisor_id') || '';

  const modulo = [
    ['/', '⌂', 'Inicio'], ['/pos', '▣', 'Facturar'], ['/proformas', '▤', 'Proformas'],
    ['/productos-admin', '▦', 'Productos'], ['/inventario', '▥', 'Inventario'],
    ['/clientes-admin', '♙', 'Clientes'], ['/proveedores-admin', '▱', 'Proveedores'],
    ['/caja', '▣', 'Caja'], ['/cuentas-por-cobrar', '◈', 'Por cobrar'],
    ['/cuentas-por-pagar', '◇', 'Por pagar'], ['/reportes', '▥', 'Reportes'],
    ['/usuarios-admin', '♙', 'Usuarios'], ['/correo-prueba', '✉', 'Correo'],
  ];
  const nombres = Object.fromEntries(modulo.map(x => [x[0], x[2]]));

  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }
  function link(href) { return href + (href.includes('?') ? '&' : '?') + 'emisorId=' + encodeURIComponent(emisorId || ''); }

  async function resolveBusiness() {
    if (!isProtectedPage) return;
    try {
      const r = await fetch('/auth/yo');
      if (r.status === 401) { location.href = '/login'; return; }
      if (!r.ok) return;
      const data = await r.json();
      const negocios = data.negocios || [];
      const elegido = negocios.find(n => n.emisorId === emisorId) || negocios.find(n => n.emisorId === localStorage.getItem('facturador_emisor_id')) || negocios[0];
      if (!elegido) return;
      emisorId = elegido.emisorId;
      localStorage.setItem('facturador_emisor_id', emisorId);
      if (path !== '/' && !qs.get('emisorId')) {
        const u = new URL(location.href); u.searchParams.set('emisorId', emisorId); location.replace(u.toString()); return;
      }
      renderShell(elegido);
    } catch (_) { /* la protección del servidor sigue siendo la autoridad */ }
  }

  function renderShell(negocio) {
    if (!document.body || document.querySelector('.ec-sidebar')) return;
    const q = encodeURIComponent(emisorId || '');
    const active = path;
    const aside = document.createElement('aside');
    aside.className = 'ec-sidebar';
    aside.innerHTML = `
      <div class="ec-brand">
        <div class="ec-brand-icon"><span>▤</span></div>
        <div><strong>Facturador EC</strong><small>Sistema de Facturación Electrónica</small></div>
      </div>
      <div class="ec-business">
        <small>NEGOCIO ACTIVO</small>
        <strong>${esc(negocio.nombreComercial || negocio.razonSocial || 'Mi empresa')}</strong>
        <span>${esc(negocio.rol || 'Usuario')}</span>
      </div>
      <nav class="ec-menu" aria-label="Navegación principal">
        <div class="ec-menu-section">Principal</div>
        ${modulo.slice(0,5).map(([href,icon,label]) => `<a class="${active===href?'active':''}" href="${link(href)}"><span class="ec-menu-icon">${icon}</span><span>${label}</span>${href==='/inventario'?'<b class="ec-chevron">›</b>':''}</a>`).join('')}
        <div class="ec-menu-section">Gestión</div>
        ${modulo.slice(5,11).map(([href,icon,label]) => `<a class="${active===href?'active':''}" href="${link(href)}"><span class="ec-menu-icon">${icon}</span><span>${label}</span></a>`).join('')}
        <div class="ec-menu-section">Administración</div>
        ${modulo.slice(11).map(([href,icon,label]) => `<a class="${active===href?'active':''}" href="${link(href)}"><span class="ec-menu-icon">${icon}</span><span>${label}</span>${href==='/correo-prueba'?'<b class="ec-chevron">›</b>':''}</a>`).join('')}
      </nav>
      <div class="ec-sidebar-foot">
        <div class="ec-company-mini"><span>▦</span><div><strong>${esc(negocio.nombreComercial || negocio.razonSocial || 'Mi empresa')}</strong><small>RUC: ${esc(negocio.ruc || 'Configurado')}</small></div></div>
        <a href="#" id="ec-cambiar-negocio">⇄ Cambiar negocio</a>
        <a href="#" id="ec-salir">↪ Cerrar sesión</a>
      </div>`;
    document.body.prepend(aside);
    document.body.classList.add('ec-shell-active');

    let header = document.querySelector('body > header');
    if (!header) { header = document.createElement('header'); document.body.prepend(header); }
    header.className = 'ec-topbar';
    header.innerHTML = `
      <button class="ec-menu-toggle" id="ec-menu-toggle" aria-label="Abrir menú">☰</button>
      <div class="ec-search"><span>⌕</span><input id="ec-global-search" placeholder="Buscar facturas, clientes, productos..." autocomplete="off"></div>
      <div class="ec-head-spacer"></div>
      <div class="ec-head-business"><span class="ec-head-business-icon">▦</span><div><strong>${esc(negocio.nombreComercial || negocio.razonSocial || 'Mi empresa')}</strong><small>RUC / negocio activo</small></div><span class="ec-caret">⌄</span></div>
      <button class="ec-notify" title="Notificaciones">♧<b>3</b></button>
      <div class="ec-head-user"><span class="ec-avatar">${esc((negocio.rol || 'U').slice(0,1).toUpperCase())}</span><div><strong>${esc(negocio.usuarioNombre || negocio.rol || 'Usuario')}</strong><small>${esc(negocio.rol || 'Administrador')}</small></div><span class="ec-caret">⌄</span></div>`;

    const title = nombres[path] || 'Módulo';
    if (path !== '/' && !document.querySelector('.ec-page-heading')) {
      const cont = document.querySelector('.contenedor');
      if (cont) {
        const h = document.createElement('div'); h.className = 'ec-page-heading';
        h.innerHTML = `<div><div class="ec-breadcrumb">Inicio <span>›</span> ${esc(title)}</div><h1>${esc(title)}</h1><p>Administra y consulta la información de tu negocio desde un solo lugar.</p></div><div class="ec-heading-actions"></div>`;
        cont.prepend(h);
      }
    }

    document.getElementById('ec-salir')?.addEventListener('click', async e => { e.preventDefault(); await fetch('/auth/logout',{method:'POST'}); localStorage.removeItem('facturador_emisor_id'); location.href='/login'; });
    document.getElementById('ec-cambiar-negocio')?.addEventListener('click', async e => {
      e.preventDefault(); const r=await fetch('/auth/yo'); const d=await r.json();
      if((d.negocios||[]).length<=1) return alert('Tu usuario solo tiene un negocio asociado.');
      const opts=d.negocios.map((n,i)=>`${i+1}. ${n.nombreComercial||n.razonSocial}`).join('\n'); const n=prompt('Selecciona el número del negocio:\n\n'+opts); const i=Number(n)-1;
      if(d.negocios[i]) { localStorage.setItem('facturador_emisor_id',d.negocios[i].emisorId); const u=new URL(location.href); u.searchParams.set('emisorId',d.negocios[i].emisorId); location.href=u.toString(); }
    });
    document.getElementById('ec-menu-toggle')?.addEventListener('click',()=>document.body.classList.toggle('ec-sidebar-open'));
    document.getElementById('ec-global-search')?.addEventListener('keydown',e=>{ if(e.key==='Enter'){ const v=e.target.value.trim(); if(v) location.href=link('/reportes')+'&q='+encodeURIComponent(v); }});
    document.querySelector('.ec-notify')?.addEventListener('click',()=>location.href=link('/reportes'));
  }

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

  document.addEventListener('DOMContentLoaded', () => { addExportToolbar(); });
  resolveBusiness();
})();
