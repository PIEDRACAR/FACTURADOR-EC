from pathlib import Path
p=Path('/mnt/data/work/v975')
# env
f=p/'src/config/env.ts'; s=f.read_text()
s=s.replace("sriRucLookupUrl: process.env.SRI_RUC_LOOKUP_URL ?? 'https://srienlinea.sri.gob.ec/sri-catastro-sujeto-servicio-internet/rest/ConsolidadoContribuyente/obtenerPorNumerosRuc',", "sriRucLookupUrl: process.env.SRI_RUC_LOOKUP_URL ?? 'https://srienlinea.sri.gob.ec/sri-catastro-sujeto-servicio-internet/rest/ConsolidadoContribuyente/obtenerPorNumerosRuc',\n  sriEstablecimientosLookupUrl: process.env.SRI_ESTABLECIMIENTOS_LOOKUP_URL ?? 'https://srienlinea.sri.gob.ec/sri-catastro-sujeto-servicio-internet/rest/Establecimiento/consultarPorNumeroRuc',")
f.write_text(s)

# provider routes
f=p/'src/routes/proveedor.ts'; s=f.read_text()
insert="""
function normalizarBoolSRI(v: unknown): boolean | null {
  if (v === true || String(v ?? '').toUpperCase() === 'SI' || String(v ?? '').toUpperCase() === 'SÍ') return true;
  if (v === false || String(v ?? '').toUpperCase() === 'NO') return false;
  return null;
}

function primerItemSRI(data: any): any {
  if (Array.isArray(data)) return data[0] ?? null;
  if (Array.isArray(data?.data)) return data.data[0] ?? null;
  return data?.data ?? data ?? null;
}

function mapearRucSRI(raw: any) {
  const x = primerItemSRI(raw);
  if (!x) return null;
  const fechas = x.informacionFechasContribuyente ?? x.informacionFechas ?? {};
  return {
    ruc: x.numeroRuc ?? x.ruc ?? null,
    razonSocial: x.razonSocial ?? x.razon_social ?? x.nombreRazonSocial ?? null,
    nombreComercial: x.nombreComercial ?? x.nombre_comercial ?? null,
    estado: x.estadoContribuyenteRuc ?? x.estadoContribuyente ?? x.estado ?? null,
    tipoContribuyente: x.tipoContribuyente ?? x.tipo_contribuyente ?? null,
    regimen: x.regimen ?? x.regimenRimpe ?? null,
    obligadoContabilidad: normalizarBoolSRI(x.obligadoLlevarContabilidad ?? x.obligadoContabilidad ?? x.obligado_contabilidad),
    actividadPrincipal: x.actividadEconomicaPrincipal ?? x.actividadPrincipal ?? null,
    codigoActividadEconomica: x.codigoActividadEconomica ?? x.codigoActividad ?? null,
    direccion: x.direccionMatriz ?? x.direccion ?? x.domicilioFiscal ?? null,
    provincia: x.nombreProvincia ?? x.provincia ?? null,
    canton: x.nombreCanton ?? x.canton ?? null,
    parroquia: x.nombreParroquia ?? x.parroquia ?? null,
    telefono: x.telefono1 ?? x.telefono ?? null,
    correo: x.correo ?? x.email ?? null,
    representanteLegal: x.agenteRepresentante ?? x.representanteLegal ?? x.nombreRepresentanteLegal ?? null,
    contribuyenteEspecial: x.contribuyenteEspecial ?? null,
    agenteRetencion: x.agenteRetencion ?? x.agenteRetencionEspecial ?? null,
    fechas,
    raw: x,
  };
}

async function consultarRucSRI(ruc: string): Promise<any> {
  const u = new URL(env.sriRucLookupUrl);
  u.searchParams.set('ruc', ruc);
  u.searchParams.set('numeroRuc', ruc);
  const r = await fetch(u, { headers: { Accept: 'application/json', 'User-Agent': 'CONTSERTRIB/1.0' } });
  if (!r.ok) throw new Error(`SRI respondió HTTP ${r.status}.`);
  const datos = mapearRucSRI(await r.json());
  if (!datos) throw new Error('El SRI no devolvió información para ese RUC.');
  return datos;
}

async function consultarEstablecimientosSRI(ruc: string): Promise<any[]> {
  try {
    const u = new URL(env.sriEstablecimientosLookupUrl);
    u.searchParams.set('numeroRuc', ruc);
    const r = await fetch(u, { headers: { Accept: 'application/json', 'User-Agent': 'CONTSERTRIB/1.0' } });
    if (!r.ok) return [];
    const d: any = await r.json();
    return Array.isArray(d) ? d : Array.isArray(d?.data) ? d.data : [];
  } catch { return []; }
}
"""
s=s.replace("function generarPasswordTemporal(): string {", insert+"\nfunction generarPasswordTemporal(): string {")
# Add lookup route before /proveedor/clientes
needle="  app.get('/proveedor/clientes', async (request, reply) => {"
route="""  app.get<{ Params: { ruc: string } }>('/proveedor/ruc/:ruc', async (request, reply) => {
    if (!await exigirProveedor(request, reply)) return;
    const ruc = String(request.params.ruc ?? '').replace(/\\D/g, '');
    if (!RUC_REGEX.test(ruc)) return reply.status(400).send({ error: 'El RUC debe tener 13 dígitos.' });
    try {
      const [datos, establecimientos] = await Promise.all([consultarRucSRI(ruc), consultarEstablecimientosSRI(ruc)]);
      return reply.send({ ok: true, fuente: 'SRI', datos, establecimientos });
    } catch (e) {
      return reply.status(502).send({ error: e instanceof Error ? e.message : String(e), fuente: 'SRI' });
    }
  });

"""
s=s.replace(needle, route+needle)
# Modify create route body to allow lookup and autofill
old="""    const ruc = String(b.ruc ?? '').trim();
    const razonSocial = String(b.razonSocial ?? '').trim();
    const direccion = String(b.direccionMatriz ?? '').trim();
    const email = String(b.emailAdmin ?? '').trim().toLowerCase();
    if (!RUC_REGEX.test(ruc)) return reply.status(400).send({ error: 'El RUC debe tener 13 dígitos.' });
    if (!razonSocial || !direccion || !email) return reply.status(400).send({ error: 'RUC, razón social, dirección y correo son obligatorios.' });
    if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) return reply.status(400).send({ error: 'El correo del administrador no es válido.' });
"""
new="""    const ruc = String(b.ruc ?? '').replace(/\\D/g, '');
    if (!RUC_REGEX.test(ruc)) return reply.status(400).send({ error: 'El RUC debe tener 13 dígitos.' });
    let sri: any = null;
    try { sri = await consultarRucSRI(ruc); } catch (e) { return reply.status(502).send({ error: e instanceof Error ? e.message : String(e), fuente: 'SRI' }); }
    const razonSocial = String(b.razonSocial ?? sri.razonSocial ?? '').trim();
    const direccion = String(b.direccionMatriz ?? sri.direccion ?? '').trim();
    const email = String(b.emailAdmin ?? sri.correo ?? '').trim().toLowerCase();
    if (!razonSocial || !direccion) return reply.status(400).send({ error: 'El SRI no devolvió razón social o dirección suficientes para crear el cliente.' });
    if (!email || !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) return reply.status(400).send({ error: 'El SRI no tiene un correo válido. Ingresa el correo del administrador.' });
"""
s=s.replace(old,new)
# replace insert emitter to use SRI values
s=s.replace("obligado_contabilidad: false, ambiente", "obligado_contabilidad: sri.obligadoContabilidad ?? false, ambiente")
# after account creation? store metadata via update if migration exists
old2="""    const { data: cuenta, error: cuentaError } = await supabase.from('cuentas_cliente_saas').insert({ nombre: razonSocial, email_admin: email, admin_user_id: userId, plan_id: plan.id, estado: 'activa' }).select('*').single();
"""
new2="""    const { data: cuenta, error: cuentaError } = await supabase.from('cuentas_cliente_saas').insert({ nombre: razonSocial, email_admin: email, admin_user_id: userId, plan_id: plan.id, estado: 'activa' }).select('*').single();
    await supabase.from('emisores').update({ estado_ruc_sri: sri.estado, actividad_economica_principal: sri.actividadPrincipal, codigo_actividad_economica: sri.codigoActividadEconomica, tipo_contribuyente_sri: sri.tipoContribuyente, regimen_sri: sri.regimen, representante_legal_sri: sri.representanteLegal, agente_retencion_sri: sri.agenteRetencion, contribuyente_especial_sri: sri.contribuyenteEspecial, correo_sri: sri.correo, telefono_sri: sri.telefono, datos_ruc_sri: sri.raw, fecha_consulta_ruc_sri: new Date().toISOString() }).eq('id', emisor.id);
"""
s=s.replace(old2,new2)
# change subscription PATCH to add planId and better days
old3="""  app.patch<{ Params: { emisorId: string }; Body: { estado?: Estado; dias?: number; nota?: string } }>('/proveedor/clientes/:emisorId/suscripcion', async (request, reply) => {"""
new3="""  app.patch<{ Params: { emisorId: string }; Body: { estado?: Estado; dias?: number; nota?: string; planId?: string } }>('/proveedor/clientes/:emisorId/suscripcion', async (request, reply) => {"""
s=s.replace(old3,new3)
old4="""    if (b.dias !== undefined) cambios.proximo_vencimiento = fechaMasDias(Math.max(0, Math.min(3650, Number(b.dias))));
    const { data, error } = await supabase.from('suscripciones').update(cambios).eq('emisor_id', request.params.emisorId).select('*').single();
"""
new4="""    if (b.dias !== undefined) {
      const dias = Math.max(0, Math.min(3650, Number(b.dias)));
      cambios.proximo_vencimiento = fechaMasDias(dias);
      if (b.estado === 'activa') cambios.fecha_inicio = hoyEcuadorIso();
    }
    if (b.planId !== undefined) {
      const { data: plan } = await supabase.from('planes_suscripcion').select('id,activo').eq('id', String(b.planId)).maybeSingle();
      if (!plan?.id || !plan.activo) return reply.status(400).send({ error: 'El plan seleccionado no existe o está inactivo.' });
      cambios.plan_id = plan.id;
      const { data: rel } = await supabase.from('contribuyentes_cliente_saas').select('cuenta_id').eq('emisor_id', request.params.emisorId).maybeSingle();
      if (rel?.cuenta_id) await supabase.from('cuentas_cliente_saas').update({ plan_id: plan.id, updated_at: new Date().toISOString() }).eq('id', rel.cuenta_id);
    }
    const { data, error } = await supabase.from('suscripciones').update(cambios).eq('emisor_id', request.params.emisorId).select('*').single();
"""
s=s.replace(old4,new4)
# Update new contributor to use lookup? We'll keep route but auto lookup if missing.
f.write_text(s)

# SQL migration
sql=p/'sql/migracion_saas_ruc_plan_v975.sql'
sql.write_text("""-- CONTSERTRIB v9.7.5\n-- Alta comercial por RUC: datos SRI, cambio de plan y activación de vigencia.\n\nalter table if exists emisores\n  add column if not exists estado_ruc_sri varchar(40),\n  add column if not exists actividad_economica_principal text,\n  add column if not exists codigo_actividad_economica varchar(30),\n  add column if not exists tipo_contribuyente_sri varchar(100),\n  add column if not exists regimen_sri varchar(100),\n  add column if not exists representante_legal_sri text,\n  add column if not exists agente_retencion_sri text,\n  add column if not exists contribuyente_especial_sri text,\n  add column if not exists correo_sri varchar(320),\n  add column if not exists telefono_sri varchar(80),\n  add column if not exists datos_ruc_sri jsonb,\n  add column if not exists fecha_consulta_ruc_sri timestamptz;\n\ncreate index if not exists idx_emisores_ruc_sri_estado on emisores(estado_ruc_sri);\ncreate index if not exists idx_emisores_ruc_sri_consulta on emisores(fecha_consulta_ruc_sri);\n\n-- Historial de cambios comerciales del plan para trazabilidad.\ncreate table if not exists historial_planes_saas (\n  id uuid primary key default gen_random_uuid(),\n  cuenta_id uuid references cuentas_cliente_saas(id) on delete set null,\n  emisor_id uuid references emisores(id) on delete set null,\n  plan_anterior_id uuid references planes_suscripcion(id) on delete set null,\n  plan_nuevo_id uuid references planes_suscripcion(id) on delete set null,\n  fecha_cambio timestamptz not null default now(),\n  nota text\n);\ncreate index if not exists idx_historial_planes_saas_cuenta on historial_planes_saas(cuenta_id, fecha_cambio desc);\n""")

# frontend modifications
f=p/'public/admin-proveedor.html'; s=f.read_text()
# form RUC block replace
s=s.replace('<div class="row"><label>RUC *<input name="ruc" maxlength="13" required></label><label>Razón social *<input name="razonSocial" required></label></div>', '<div class="row"><label>RUC *<input id="rucNuevo" name="ruc" maxlength="13" inputmode="numeric" required></label><label>Razón social <input id="razonNuevo" name="razonSocial" readonly></label></div><div class="row"><label>Estado SRI<input id="estadoNuevo" readonly></label><label>Actividad económica principal<input id="actividadNuevo" readonly></label></div>')
s=s.replace('<div class="row"><label>Nombre comercial<input name="nombreComercial"></label><label>Correo administrador *<input name="emailAdmin" type="email" required></label></div><label>Dirección matriz *<input name="direccionMatriz" required></label>', '<div class="row"><label>Nombre comercial<input id="nombreNuevo" name="nombreComercial"></label><label>Correo administrador<input id="emailNuevo" name="emailAdmin" type="email" required></label></div><label>Dirección matriz <input id="direccionNuevo" name="direccionMatriz" readonly></label><div id="rucInfo" class="notice" style="display:none"></div>')
# add lookup button near RUC using CSS? insert after form heading
s=s.replace('<p class="small">Crea la cuenta comercial', '<p class="small">Ingresa el RUC y CONTSERTRIB consultará automáticamente el catastro público del SRI para completar los datos disponibles. Luego selecciona el plan y la vigencia.</p><p class="small">Crea la cuenta comercial', 1)
# detail modal add plan select/buttons. replace tabs line
old='<div class="tabs"><button class="tab" onclick="activar(\'${id}\')">Activar 30 días</button><button class="tab" onclick="suspender(\'${id}\')">Suspender</button><button class="tab" onclick="reenviar(\'${id}\')">Regenerar acceso</button><button class="tab" onclick="agregarRuc(\'${id}\')">+ Contribuyente</button></div>'
new='<div class="tabs"><button class="tab" onclick="activar(\'${id}\')">▶ Activar 30 días</button><button class="tab" onclick="renovar(\'${id}\')">＋ Renovar días</button><button class="tab" onclick="cambiarPlan(\'${id}\')">⇄ Cambiar plan</button><button class="tab" onclick="suspender(\'${id}\')">⏸ Suspender</button><button class="tab" onclick="reenviar(\'${id}\')">🔑 Regenerar acceso</button><button class="tab" onclick="agregarRuc(\'${id}\')">＋ Contribuyente</button></div>'
s=s.replace(old,new)
# JS insert functions and lookup listeners before buscar listener
needle="document.getElementById('buscar').addEventListener('input',renderClientes);"
js="""
async function activar(id){try{await api('/proveedor/clientes/'+id+'/suscripcion',{method:'PATCH',body:JSON.stringify({estado:'activa',dias:30})});alert('Servicio activado por 30 días desde hoy.');cerrar();await cargar()}catch(e){alert(e.message)}}
async function renovar(id){const dias=prompt('¿Cuántos días deseas agregar?','30');if(dias===null)return;const n=Number(dias);if(!Number.isFinite(n)||n<1)return alert('Ingresa un número de días válido.');try{await api('/proveedor/clientes/'+id+'/pago',{method:'POST',body:JSON.stringify({monto:0.01,dias:n,metodo:'ajuste_comercial',nota:'Renovación/ajuste desde panel. Sustituir por cobro real cuando corresponda.'})});alert('Vigencia renovada. Para un cobro real usa el botón Pago.');await cargar()}catch(e){alert(e.message)}}
async function cambiarPlan(id){const x=clientes.find(c=>c.id===id);if(!x)return;const opciones=planes.filter(p=>p.activo).map((p,i)=>`${i+1}. ${p.nombre} — $${Number(p.precio_mensual).toFixed(2)}`).join('\\n');const activos=planes.filter(p=>p.activo);const sel=prompt('Selecciona el nuevo plan:\\n\\n'+opciones+'\\n\\nEscribe el número:');if(sel===null)return;const p=activos[Number(sel)-1];if(!p)return alert('Plan no válido.');if(!confirm('Cambiar a '+p.nombre+'?'))return;try{await api('/proveedor/clientes/'+id+'/suscripcion',{method:'PATCH',body:JSON.stringify({planId:p.id})});alert('Plan cambiado correctamente.');await cargar();await detalle(id)}catch(e){alert(e.message)}}
"""
s=s.replace(needle, js+needle)
# Remove duplicate activar old function line and replace it by no-op? Since inserted same name and old later causes override. Replace old exact.
s=s.replace("async function activar(id){try{await api('/proveedor/clientes/'+id+'/suscripcion',{method:'PATCH',body:JSON.stringify({estado:'activa',dias:30})});cerrar();await cargar()}catch(e){alert(e.message)}}", "")
# Add lookup listener before final cargar
end="document.getElementById('buscar').addEventListener('input',renderClientes);"
lookup="""
let rucTimer=null;
async function consultarRucNuevo(){const el=document.getElementById('rucNuevo');if(!el)return;const ruc=el.value.replace(/\\D/g,'');el.value=ruc;if(ruc.length!==13)return;const info=document.getElementById('rucInfo');info.style.display='block';info.textContent='Consultando información del RUC en el SRI…';try{const d=await api('/proveedor/ruc/'+ruc);const x=d.datos||{};document.getElementById('razonNuevo').value=x.razonSocial||'';document.getElementById('nombreNuevo').value=x.nombreComercial||'';document.getElementById('direccionNuevo').value=x.direccion||'';document.getElementById('emailNuevo').value=x.correo||'';document.getElementById('estadoNuevo').value=x.estado||'';document.getElementById('actividadNuevo').value=x.actividadPrincipal||'';info.innerHTML='<b>Datos SRI encontrados.</b> '+esc(x.tipoContribuyente||'')+' · Contabilidad: '+(x.obligadoContabilidad===true?'Sí':x.obligadoContabilidad===false?'No':'No informado')+' · Régimen: '+esc(x.regimen||'No informado')+' · Establecimientos SRI: '+(d.establecimientos||[]).length;}catch(e){info.textContent='No se pudo consultar el RUC: '+e.message;}}
document.getElementById('rucNuevo').addEventListener('input',()=>{clearTimeout(rucTimer);rucTimer=setTimeout(consultarRucNuevo,350)});
document.getElementById('rucNuevo').addEventListener('blur',consultarRucNuevo);
"""
s=s.replace(end, lookup+end)
# Add plan info in result and prevent readonly fields being reset after success? reset will clear; okay.
f.write_text(s)
