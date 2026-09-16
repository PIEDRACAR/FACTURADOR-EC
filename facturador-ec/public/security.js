(function(){
  'use strict';
  function escapeHtml(value){
    return String(value??'').replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});
  }
  function safeId(value){return String(value??'').replace(/[^a-zA-Z0-9_-]/g,'');}
  window.CONTSERTRIB_SECURITY=Object.freeze({escapeHtml:escapeHtml,safeId:safeId});
  const originalFetch=window.fetch.bind(window);
  window.fetch=function(input,init){const opts={...(init||{})};const method=String(opts.method||'GET').toUpperCase();const url=typeof input==='string'?new URL(input,location.href):new URL(input.url,location.href);if(url.origin===location.origin&&!['GET','HEAD','OPTIONS'].includes(method)){opts.headers=new Headers(opts.headers||{});opts.headers.set('X-Requested-With','XMLHttpRequest');}return originalFetch(input,opts);};
})();
