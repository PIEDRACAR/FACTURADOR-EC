(function () {
  const path = location.pathname.replace(/\/$/, '') || '/';
  const isProtectedPage = path !== '/login' && path !== '/registro';
  const qs = new URLSearchParams(location.search);
  let emisorId = qs.get('emisorId') || localStorage.getItem('facturador_emisor_id') || '';

  const modulo = [
    ['/', 'home', 'Inicio'], ['/pos', 'invoice', 'Facturar'], ['/documentos?tipo=nota_credito', 'file', 'Notas y documentos'], ['/proformas', 'file', 'Proformas'],
    ['/productos-admin', 'box', 'Productos'], ['/inventario', 'inventory', 'Inventario'],
    ['/clientes-admin', 'users', 'Clientes'], ['/proveedores-admin', 'truck', 'Proveedores'],
    ['/caja', 'cash', 'Caja'], ['/cuentas-por-cobrar', 'receive', 'Cuentas por cobrar'],
    ['/cuentas-por-pagar', 'pay', 'Cuentas por pagar'], ['/reportes', 'chart', 'Reportes'],
    ['/usuarios-admin', 'user', 'Usuarios'], ['/correo-prueba', 'mail', 'Correo'], ['/configuracion', 'settings', 'Configuración']
  ];
  const nombres = Object.fromEntries(modulo.map(x => [x[0], x[2]]));

  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }
  function link(href) { return href + (href.includes('?') ? '&' : '?') + 'emisorId=' + encodeURIComponent(emisorId || ''); }
  function icon(name, cls='') {
    const paths = {
      home:'<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.5V20h13v-9.5"/><path d="M9.5 20v-5h5v5"/>',
      invoice:'<path d="M6 3.5h9l3 3V21H6z"/><path d="M15 3.5V7h3"/><path d="M9 11h6M9 14.5h6M9 18h3"/>',
      file:'<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h6"/>',
      box:'<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>',
      inventory:'<path d="M4 5h16v15H4z"/><path d="M8 9h8M8 13h8M8 17h5"/>',
      users:'<circle cx="9" cy="8" r="3"/><path d="M3.5 20c.7-3.5 2.5-5.5 5.5-5.5s4.8 2 5.5 5.5"/><path d="M16 11a3 3 0 1 0 0-6M16 14.5c2.4.1 3.8 1.9 4.5 5.5"/>',
      truck:'<path d="M3 6h11v10H3zM14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>',
      cash:'<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 9h.01M18 15h.01"/>',
      receive:'<path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h8M8 16h4"/><path d="m16 15 2 2-2 2"/>',
      pay:'<path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h8M8 16h4"/><path d="m16 17-2-2 2-2"/>',
      chart:'<path d="M4 19V5M4 19h17"/><path d="m7 15 4-5 3 3 5-7"/>',
      user:'<circle cx="12" cy="8" r="3.5"/><path d="M5 21c.8-4.1 3.1-6.2 7-6.2s6.2 2.1 7 6.2"/>',
      mail:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/>',
      settings:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.8 1.8 0 0 0 .3 2l.1.1-1.9 1.9-.1-.1a1.8 1.8 0 0 0-2-.3 1.8 1.8 0 0 0-1.1 1.7V21h-2.7v-.7a1.8 1.8 0 0 0-1.1-1.7 1.8 1.8 0 0 0-2 .3l-.1.1-1.9-1.9.1-.1a1.8 1.8 0 0 0 .3-2 1.8 1.8 0 0 0-1.7-1.1H5v-2.7h.7A1.8 1.8 0 0 0 7.4 10a1.8 1.8 0 0 0-.3-2L7 7.9 8.9 6l.1.1a1.8 1.8 0 0 0 2 .3 1.8 1.8 0 0 0 1.1-1.7V4h2.7v.7a1.8 1.8 0 0 0 1.1 1.7 1.8 1.8 0 0 0 2-.3l.1-.1L20 7.9l-.1.1a1.8 1.8 0 0 0-.3 2 1.8 1.8 0 0 0 1.7 1.1h.7v2.7h-.7a1.8 1.8 0 0 0-1.9 1.2Z"/>',
      bell:'<path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/>',
      search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
      menu:'<path d="M4 7h16M4 12h16M4 17h16"/>',
      chevron:'<path d="m8 10 4 4 4-4"/>',
      logout:'<path d="M10 5H5v14h5M14 8l4 4-4 4M18 12H9"/>'
    };
    return `<svg class="ec-svg ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.file}</svg>`;
  }

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
    } catch (_) { /* backend remains authoritative */ }
  }

  function renderShell(negocio) {
    if (!document.body || document.querySelector('.ec-sidebar')) return;
    const active = path;
    const navLink = ([href,ic,label]) => `<a class="${active===href.split('?')[0]?'active':''}" href="${link(href)}" data-label="${esc(label)}"><span class="ec-menu-icon">${icon(ic)}</span><span class="ec-menu-label">${esc(label)}</span></a>`;
    const aside = document.createElement('aside');
    aside.className = 'ec-sidebar';
    aside.innerHTML = `
      <div class="ec-brand"><div class="ec-brand-icon">${icon('invoice')}</div><div><strong>CONTSERTRIB FACTURACIÓN</strong><small>Sistema de Facturación Electrónica</small></div></div>
      <div class="ec-business"><small>NEGOCIO ACTIVO</small><strong>${esc(negocio.nombreComercial || negocio.razonSocial || 'Mi empresa')}</strong><span>RUC ${esc(negocio.ruc || 'Configurado')}</span></div>
      <nav class="ec-menu" aria-label="Navegación principal">
        <div class="ec-menu-section">Principal</div>${modulo.slice(0,5).map(navLink).join('')}
        <div class="ec-menu-section">Gestión</div>${modulo.slice(5,11).map(navLink).join('')}<div class="ec-doc-submenu"><a href="${link('/documentos?tipo=nota_credito')}">↳ Nota de crédito</a><a href="${link('/documentos?tipo=nota_debito')}">↳ Nota de débito</a><a href="${link('/documentos?tipo=liquidacion_compra')}">↳ Liquidación de compra</a><a href="${link('/documentos?tipo=guia_remision')}">↳ Guía de remisión</a><a href="${link('/documentos?tipo=retencion')}">↳ Retención</a></div>
        <div class="ec-menu-section">Administración</div>${modulo.slice(11).map(navLink).join('')}
      </nav>
      <div class="ec-sidebar-foot"><div class="ec-company-mini"><span>${icon('box')}</span><div><strong>${esc(negocio.nombreComercial || negocio.razonSocial || 'Mi empresa')}</strong><small>RUC: ${esc(negocio.ruc || 'Configurado')}</small></div></div><a href="#" id="ec-cambiar-negocio">⇄ Cambiar negocio</a><a href="#" id="ec-salir">${icon('logout')} Cerrar sesión</a></div>`;
    document.body.prepend(aside);
    const overlay = document.createElement('div'); overlay.className='ec-sidebar-overlay'; overlay.id='ec-sidebar-overlay'; document.body.appendChild(overlay);
    document.body.classList.add('ec-shell-active');

    let header = document.querySelector('body > header');
    if (!header) { header = document.createElement('header'); document.body.prepend(header); }
    header.className = 'ec-topbar';
    header.innerHTML = `<button class="ec-menu-toggle" id="ec-menu-toggle" aria-label="Abrir menú">${icon('menu')}</button><div class="ec-head-logo"><div class="ec-brand-icon">${icon('invoice')}</div><b>CONTSERTRIB FACTURACIÓN</b></div><label class="ec-search"><span>${icon('search')}</span><input id="ec-global-search" placeholder="Buscar facturas, clientes, productos..." autocomplete="off"></label><div class="ec-head-spacer"></div><button class="ec-head-business" id="ec-business-button"><span class="ec-head-business-icon">${icon('box')}</span><span><strong>${esc(negocio.nombreComercial || negocio.razonSocial || 'Mi empresa')}</strong><small>RUC ${esc(negocio.ruc || '')}</small></span>${icon('chevron','ec-caret')}</button><button class="ec-notify" id="ec-notify-button" title="Notificaciones" aria-label="Notificaciones">${icon('bell')}<b id="ec-notify-count">0</b></button><button class="ec-head-user ec-user-button" id="ec-user-button" type="button"><span class="ec-avatar">${esc((negocio.usuarioNombre || negocio.rol || 'U').slice(0,1).toUpperCase())}</span><span class="ec-user-info"><strong>${esc(negocio.usuarioNombre || 'Usuario')}</strong><small>${esc(negocio.rol || 'Administrador')}</small></span>${icon('chevron','ec-caret')}</button>`;

    const title = nombres[path] || 'Módulo';
    if (path !== '/' && !document.querySelector('.ec-page-heading')) {
      const cont = document.querySelector('.contenedor');
      if (cont) { const h=document.createElement('div'); h.className='ec-page-heading'; h.innerHTML=`<div><div class="ec-breadcrumb">Inicio <span>›</span> ${esc(title)}</div><h1>${esc(title)}</h1><p>Administra y consulta la información de tu negocio desde un solo lugar.</p></div><div class="ec-heading-actions"></div>`; cont.prepend(h); }
    }

    const mobileNav=document.createElement('nav'); mobileNav.className='ec-mobile-nav'; mobileNav.innerHTML=modulo.slice(0,4).map(([href,ic,label])=>`<a class="${active===href?'active':''}" href="${link(href)}">${icon(ic)}<span>${esc(label)}</span></a>`).join('')+`<button id="ec-mobile-more">${icon('menu')}<span>Más</span></button>`; document.body.appendChild(mobileNav);

    const closeMenu=()=>document.body.classList.remove('ec-sidebar-open');
    document.getElementById('ec-menu-toggle')?.addEventListener('click',()=>document.body.classList.toggle('ec-sidebar-open'));
    overlay.addEventListener('click',closeMenu);
    document.querySelectorAll('.ec-sidebar a').forEach(a=>a.addEventListener('click',closeMenu));
    document.getElementById('ec-mobile-more')?.addEventListener('click',()=>document.body.classList.toggle('ec-sidebar-open'));
    document.getElementById('ec-salir')?.addEventListener('click',async e=>{e.preventDefault();await fetch('/auth/logout',{method:'POST'});localStorage.removeItem('facturador_emisor_id');location.href='/login';});
    document.getElementById('ec-cambiar-negocio')?.addEventListener('click',async e=>{e.preventDefault();const r=await fetch('/auth/yo');const d=await r.json();if((d.negocios||[]).length<=1)return alert('Tu usuario solo tiene un negocio asociado.');const opts=d.negocios.map((n,i)=>`${i+1}. ${n.nombreComercial||n.razonSocial}`).join('\n');const n=prompt('Selecciona el número del negocio:\n\n'+opts);const i=Number(n)-1;if(d.negocios[i]){localStorage.setItem('facturador_emisor_id',d.negocios[i].emisorId);const u=new URL(location.href);u.searchParams.set('emisorId',d.negocios[i].emisorId);location.href=u.toString();}});
    document.getElementById('ec-business-button')?.addEventListener('click',()=>document.getElementById('ec-cambiar-negocio')?.click());
    document.getElementById('ec-global-search')?.addEventListener('keydown',e=>{if(e.key==='Enter'){const v=e.target.value.trim();if(v)location.href=link('/reportes')+'&q='+encodeURIComponent(v);}});
        const panel = document.createElement('div'); panel.id='ec-notify-panel'; panel.className='ec-popover ec-notify-panel'; panel.innerHTML='<div class="ec-popover-head"><div><strong>Notificaciones</strong><small>Alertas del negocio</small></div><button id="ec-read-all" type="button">Marcar todas como leídas</button></div><div id="ec-notify-list" class="ec-notify-list"><div class="ec-notify-empty">Cargando…</div></div>'; document.body.appendChild(panel);
    const userPanel = document.createElement('div'); userPanel.id='ec-user-panel'; userPanel.className='ec-popover ec-user-panel'; userPanel.innerHTML='<a href="/usuarios-admin?emisorId='+encodeURIComponent(emisorId)+'">👥 Gestión de usuarios</a><a href="/configuracion?emisorId='+encodeURIComponent(emisorId)+'">⚙ Configuración</a><button id="ec-user-logout" type="button">↪ Cerrar sesión</button>'; document.body.appendChild(userPanel);
    const renderNotifications = async()=>{ try { const r=await fetch('/notificaciones?emisorId='+encodeURIComponent(emisorId)); const d=await r.json(); const items=d.items||[]; const badge=document.getElementById('ec-notify-count'); badge.textContent=String(d.noLeidas||0); badge.style.display=(d.noLeidas||0)?'grid':'none'; const list=document.getElementById('ec-notify-list'); if(!items.length){list.innerHTML='<div class="ec-notify-empty">✓ Todo está al día.<br><small>No tienes alertas pendientes.</small></div>';return;} list.innerHTML=items.map(x=>'<article class="ec-notify-item '+(x.leida?'read':'unread')+'" data-id="'+esc(x.id)+'"><span class="ec-notify-dot '+esc(x.prioridad)+'"></span><div><div class="ec-notify-title">'+esc(x.titulo)+'</div><div class="ec-notify-detail">'+esc(x.detalle)+'</div><small>'+esc(x.fecha?new Date(x.fecha).toLocaleString('es-EC'):'Ahora')+'</small></div><button class="ec-notify-read" type="button" title="Marcar como leída">'+(x.leida?'✓':'○')+'</button></article>').join(''); list.querySelectorAll('.ec-notify-read').forEach(btn=>btn.addEventListener('click',async ev=>{ev.stopPropagation();const item=btn.closest('.ec-notify-item');await fetch('/notificaciones/leer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({emisorId,notificacionId:item.dataset.id})});await renderNotifications();})); list.querySelectorAll('.ec-notify-item').forEach(item=>item.addEventListener('click',async()=>{if(item.classList.contains('read'))return;await fetch('/notificaciones/leer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({emisorId,notificacionId:item.dataset.id})});await renderNotifications();})); } catch(e){document.getElementById('ec-notify-list').innerHTML='<div class="ec-notify-empty">No se pudieron cargar las notificaciones.</div>';} };
    document.getElementById('ec-notify-button')?.addEventListener('click',async e=>{e.stopPropagation();userPanel.classList.remove('open');panel.classList.toggle('open');if(panel.classList.contains('open'))await renderNotifications();});
    document.getElementById('ec-read-all')?.addEventListener('click',async()=>{await fetch('/notificaciones/leer-todas',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({emisorId})});await renderNotifications();});
    document.getElementById('ec-user-button')?.addEventListener('click',e=>{e.stopPropagation();panel.classList.remove('open');userPanel.classList.toggle('open');});
    document.getElementById('ec-user-logout')?.addEventListener('click',async()=>{await fetch('/auth/logout',{method:'POST'});localStorage.removeItem('facturador_emisor_id');location.href='/login';});
    document.addEventListener('click',e=>{if(!panel.contains(e.target)&&!e.target.closest('#ec-notify-button'))panel.classList.remove('open');if(!userPanel.contains(e.target)&&!e.target.closest('#ec-user-button'))userPanel.classList.remove('open');});
    renderNotifications();

  }

  function addExportToolbar() {
    if (!emisorId) return;
    const cont=document.querySelector('.contenedor');if(!cont)return;
    const map={'/clientes-admin':['clientes','👥 Exportar clientes'],'/proveedores-admin':['proveedores','🚚 Exportar proveedores'],'/cuentas-por-cobrar':['cuentas-por-cobrar','💰 Exportar CxC'],'/cuentas-por-pagar':['cuentas-por-pagar','💳 Exportar CxP'],'/caja':['caja','💵 Exportar caja'],'/productos-admin':['inventario-valorizado','📦 Exportar inventario'],'/proformas':['proformas','📝 Exportar proformas']};
    if(!map[path]||cont.querySelector('.ec-global-export'))return;const [tipo,label]=map[path],base=`/reportes/exportar?emisorId=${encodeURIComponent(emisorId)}&tipo=${encodeURIComponent(tipo)}`;const bar=document.createElement('div');bar.className='ec-toolbar ec-global-export';bar.innerHTML=`<span class="ec-toolbar-title">${label}</span><a class="ec-export excel" target="_blank" href="${base}&formato=excel">⬇ Excel</a><a class="ec-export pdf" target="_blank" href="${base}&formato=pdf">⬇ PDF</a>`;cont.prepend(bar);
  }
  document.addEventListener('DOMContentLoaded',()=>{setTimeout(addExportToolbar,120);});
  resolveBusiness();
})();
