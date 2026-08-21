/* =====================================================================
   supabase.js — CONTSERTRIB Auth + Cloud Sync (Supabase)
   Login/Register with auth-email/auth-password IDs
   Auto-sync every 5 minutes
   ===================================================================== */
'use strict';

let _supabase = null;
let _currentUser = null;
const SYNC_INTERVAL = 5 * 60 * 1000; // 5 minutes

/* ---------- Supabase Init ---------- */
function initSupabase(){
  const supaUrl = (CONFIG && CONFIG.supabaseUrl) || '';
  const supaKey = (CONFIG && CONFIG.supabaseKey) || '';
  if(!supaUrl || !supaKey){
    console.log('Supabase no configurado — modo local');
    updateAuthUI();
    return;
  }
  try{
    if(typeof supabase!=='undefined' && supabase.createClient){
      _supabase = supabase.createClient(supaUrl, supaKey);
      console.log('Supabase inicializado');
      checkSession();
      startAutoSync();
    }
  }catch(e){
    console.warn('Error inicializando Supabase:', e);
  }
  updateAuthUI();
}

/* ---------- Session check ---------- */
async function checkSession(){
  if(!_supabase) return;
  try{
    const {data:{session}} = await _supabase.auth.getSession();
    if(session){
      _currentUser = session.user;
    }
  }catch(e){}
  updateAuthUI();
}

/* ---------- Login ---------- */
async function loginSupabase(){
  // Detect which form is visible: pane-auth uses auth-email/auth-password, modal-auth uses auth-email-m/auth-password-m
  const modalAuth = document.getElementById('modal-auth');
  const isModal = modalAuth && modalAuth.classList.contains('show');
  const emailEl = document.getElementById(isModal ? 'auth-email-m' : 'auth-email');
  const passwordEl = document.getElementById(isModal ? 'auth-password-m' : 'auth-password');
  if(!emailEl || !passwordEl) { showToast('Error: campos de login no encontrados','err'); return; }

  const emailVal = emailEl.value.trim();
  const passVal = passwordEl.value;

  if(!emailVal || !passVal){
    showToast('Ingresa email y contraseña','err');
    return;
  }

  if(!_supabase){
    showToast('Supabase no configurado. Usa el sistema en modo local.','err');
    return;
  }

  try{
    const {data, error} = await _supabase.auth.signInWithPassword({
      email: emailVal,
      password: passVal
    });
    if(error) throw error;
    _currentUser = data.user;
    showToast('Sesión iniciada: ' + _currentUser.email);
    closeModal('modal-auth');
    updateAuthUI();
    pullFromCloud();
  }catch(e){
    showToast('Error de login: ' + (e.message||e),'err');
  }
}

/* ---------- Register ---------- */
async function registerSupabase(){
  // Detect which form is visible: pane-auth uses auth-email/auth-password, modal-auth uses auth-email-m/auth-password-m
  const modalAuth = document.getElementById('modal-auth');
  const isModal = modalAuth && modalAuth.classList.contains('show');
  const emailEl = document.getElementById(isModal ? 'auth-email-m' : 'auth-email');
  const passwordEl = document.getElementById(isModal ? 'auth-password-m' : 'auth-password');
  if(!emailEl || !passwordEl) { showToast('Error: campos no encontrados','err'); return; }

  const emailVal = emailEl.value.trim();
  const passVal = passwordEl.value;

  if(!emailVal || !passVal){
    showToast('Ingresa email y contraseña','err');
    return;
  }
  if(passVal.length < 6){
    showToast('La contraseña debe tener al menos 6 caracteres','err');
    return;
  }

  if(!_supabase){
    showToast('Supabase no configurado.','err');
    return;
  }

  try{
    const {data, error} = await _supabase.auth.signUp({
      email: emailVal,
      password: passVal
    });
    if(error) throw error;
    _currentUser = data.user;
    showToast('Cuenta creada. Revisa tu email para confirmar.');
    closeModal('modal-auth');
    updateAuthUI();
  }catch(e){
    showToast('Error de registro: ' + (e.message||e),'err');
  }
}

/* ---------- Logout ---------- */
async function logoutSupabase(){
  if(!_supabase){ _currentUser=null; updateAuthUI(); return; }
  try{
    await _supabase.auth.signOut();
  }catch(e){}
  _currentUser = null;
  showToast('Sesión cerrada');
  updateAuthUI();
}

/* ---------- Auth UI ---------- */
function updateAuthUI(){
  const authPane = document.getElementById('pane-auth');
  if(!authPane) return;
  if(_currentUser){
    authPane.innerHTML = `
      <div class="pane-header">
        <h2><span class="icon">👤</span> Cuenta</h2>
      </div>
      <div class="card">
        <div class="card-body" style="text-align:center;">
          <div style="font-size:48px;margin-bottom:12px;">✅</div>
          <p><strong>Sesión activa</strong></p>
          <p class="text-muted">${esc(_currentUser.email||'')}</p>
          <p class="text-muted small">Creada: ${fmtDate(_currentUser.created_at||'')}</p>
          <button class="btn btn-outline" onclick="logoutSupabase()">Cerrar sesión</button>
        </div>
      </div>`;
  } else {
    authPane.innerHTML = `
      <div class="pane-header">
        <h2><span class="icon">👤</span> Iniciar Sesión</h2>
      </div>
      <div class="card">
        <div class="card-body" style="text-align:center;">
          <p class="text-muted" style="margin-bottom:16px;">Haz clic en 🔐 en la barra superior para iniciar sesión o registrarte.</p>
          <p class="text-muted small">Sin Supabase configurado, el sistema funciona en modo local.</p>
        </div>
      </div>`;
  }
}

/* ---------- Cloud Sync ---------- */
async function pushToCloud(){
  if(!_supabase || !_currentUser) return;
  try{
    const payload = {_app:'CONTSERTRIB', _userId:_currentUser.id, _fecha:new Date().toISOString(), data:{}};
    Object.values(K).forEach(k=>{
      const v = DB.get(k);
      if(v!==undefined) payload.data[k] = JSON.stringify(v);
    });
    const {error} = await _supabase.storage
      .from('backups')
      .upload(`${_currentUser.id}/latest.json`, JSON.stringify(payload), {upsert:true, contentType:'application/json'});
    if(!error) console.log('Sync push OK');
  }catch(e){
    console.warn('Error push cloud:', e);
  }
}

async function pullFromCloud(){
  if(!_supabase || !_currentUser) return;
  try{
    const {data, error} = await _supabase.storage
      .from('backups')
      .download(`${_currentUser.id}/latest.json`);
    if(error || !data) return;
    const text = await data.text();
    const payload = JSON.parse(text);
    if(!payload || payload._app!=='CONTSERTRIB') return;
    const localDate = LS.get(K.empresa,{})._modified || 0;
    const cloudDate = new Date(payload._fecha).getTime();
    if(cloudDate > localDate){
      if(confirm('Se encontró datos más recientes en la nube. ¿Descargar?')){
        Object.entries(payload.data).forEach(([k,v])=>{
          try{ DB.set(k, JSON.parse(v)); }catch(err){}
        });
        showToast('Datos sincronizados desde la nube');
        setTimeout(()=>location.reload(),500);
      }
    }
  }catch(e){
    console.warn('Error pull cloud:', e);
  }
}

/* Auto-sync every 5 minutes */
function startAutoSync(){
  if(_syncTimer) clearInterval(_syncTimer);
  _syncTimer = setInterval(()=>{
    pushToCloud().catch(()=>{});
  }, SYNC_INTERVAL);
}

/* ---------- Window exports ---------- */
window.loginSupabase = loginSupabase;
window.registerSupabase = registerSupabase;
window.logoutSupabase = logoutSupabase;
window.initSupabase = initSupabase;
window.updateAuthUI = updateAuthUI;
window.pushToCloud = pushToCloud;
window.pullFromCloud = pullFromCloud;
/* Aliases matching HTML onclick names */
window.supabaseLogin = loginSupabase;
window.supabaseLogout = logoutSupabase;
window.supabaseRegister = registerSupabase;
window.supabasePush = pushToCloud;
window.supabasePull = pullFromCloud;