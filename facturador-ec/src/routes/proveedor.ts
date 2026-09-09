import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { supabase } from '../db/supabase.js';
import { env } from '../config/env.js';
import { obtenerSesion, crearOEncontrarUsuario, agregarUsuarioANegocio } from '../auth/sesiones.js';
import { enviarComprobantePorCorreo } from '../services/email.js';
import { fechaIsoEcuador } from '../utils/fechaEcuador.js';

const COOKIE = 'sesion';
const RUC_REGEX = /^\d{13}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function validarRucEcuador(ruc: string): { ok: boolean; tipo?: 'natural'|'sociedad'; mensaje?: string } {
  if (!RUC_REGEX.test(ruc)) return { ok: false, mensaje: 'El RUC debe tener exactamente 13 dígitos.' };
  const provincia = Number(ruc.slice(0, 2));
  if (!(provincia >= 1 && provincia <= 24) && provincia !== 30) return { ok: false, mensaje: 'Los dos primeros dígitos del RUC no corresponden a una provincia/código válido.' };
  const tercer = Number(ruc[2]);
  const base = ruc.slice(0, 10).split('').map(Number);
  if (tercer < 6) {
    const coef = [2,1,2,1,2,1,2,1,2];
    let suma = 0; for (let i=0;i<9;i++) { const v=base[i]*coef[i]; suma += v >= 10 ? v-9 : v; }
    const ver = (10 - (suma % 10)) % 10;
    if (ver !== base[9]) return { ok: false, mensaje: 'El dígito verificador del RUC no es válido.' };
    if (ruc.slice(10) !== '001') return { ok: false, mensaje: 'Para persona natural, el RUC debe terminar en 001.' };
    return { ok: true, tipo: 'natural' };
  }
  if (tercer === 6) {
    const coef = [3,2,7,6,5,4,3,2];
    let suma = 0; for (let i=0;i<8;i++) suma += base[i]*coef[i];
    const ver = (11 - (suma % 11)) % 11;
    if (ver > 9 || ver !== base[8]) return { ok: false, mensaje: 'El dígito verificador del RUC de sociedad pública no es válido.' };
  } else if (tercer === 9) {
    const coef = [4,3,2,7,6,5,4,3,2];
    let suma = 0; for (let i=0;i<9;i++) suma += base[i]*coef[i];
    const ver = (11 - (suma % 11)) % 11;
    if (ver > 9 || ver !== base[9]) return { ok: false, mensaje: 'El dígito verificador del RUC de sociedad privada no es válido.' };
  } else return { ok: false, mensaje: 'El tercer dígito del RUC no corresponde a una estructura válida.' };
  if (ruc.slice(10) !== '001') return { ok: false, mensaje: 'El RUC de este tipo debe terminar en 001.' };
  return { ok: true, tipo: tercer === 6 ? 'sociedad' : 'sociedad' };
}
const ESTADOS = ['activa', 'pendiente', 'vencida', 'suspendida', 'cancelada'] as const;
type Estado = typeof ESTADOS[number];

async function obtenerEmailAuth(userId: string): Promise<string | null> {
  const r = await fetch(`${env.supabaseUrl}/auth/v1/admin/users/${userId}`, {
    headers: { apikey: env.supabaseServiceRoleKey, Authorization: `Bearer ${env.supabaseServiceRoleKey}` },
  });
  if (!r.ok) return null;
  const d = await r.json() as { email?: string };
  return d.email ?? null;
}

async function esProveedorAdmin(request: { cookies?: Record<string, string | undefined> }): Promise<{ ok: boolean; userId?: string; email?: string }> {
  const token = request.cookies?.[COOKIE];
  if (!token) return { ok: false };
  const sesion = await obtenerSesion(token);
  if (!sesion) return { ok: false };

  const { data } = await supabase.from('proveedores_admin').select('user_id,activo').eq('user_id', sesion.userId).eq('activo', true).maybeSingle();
  if (data?.user_id) return { ok: true, userId: sesion.userId, email: await obtenerEmailAuth(sesion.userId) ?? undefined };

  const email = await obtenerEmailAuth(sesion.userId);
  const permitidos = (env.proveedorAdminEmails ?? '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
  if (email && permitidos.includes(email.toLowerCase())) return { ok: true, userId: sesion.userId, email };
  return { ok: false, userId: sesion.userId, email: email ?? undefined };
}

async function exigirProveedor(request: any, reply: any) {
  const auth = await esProveedorAdmin(request);
  if (!auth.ok) {
    await reply.status(403).send({ ok: false, error: 'Acceso restringido al administrador de CONTSERTRIB.' });
    return null;
  }
  return auth;
}

function fechaMasDias(dias: number): string {
  const [y, m, d] = fechaIsoEcuador().split('-').map(Number);
  const fecha = new Date(Date.UTC(y, m - 1, d + dias, 12, 0, 0));
  return fecha.toISOString().slice(0, 10);
}

function hoyEcuadorIso(): string {
  return fechaIsoEcuador();
}

function generarPasswordTemporal(): string {
  return `Ct${randomBytes(6).toString('base64url')}!`;
}

async function consultarRucSRI(ruc: string, request: any): Promise<any | null> {
  const u = new URL(env.sriRucLookupUrl); u.searchParams.set('ruc', ruc); u.searchParams.set('numeroRuc', ruc);
  const r = await fetch(u, { headers: { Accept: 'application/json', 'User-Agent': 'CONTSERTRIB/9.7.7' } });
  if (!r.ok) throw new Error(`El servicio de consulta del SRI respondió HTTP ${r.status}.`);
  const raw = await r.json() as any; const item = Array.isArray(raw) ? raw[0] : raw?.data?.[0] ?? raw?.data ?? raw;
  if (!item) return null;
  return {
    ruc, razonSocial: item.razonSocial ?? item.razon_social ?? item.nombreRazonSocial ?? item.nombre ?? '',
    nombreComercial: item.nombreComercial ?? item.nombre_comercial ?? '',
    estado: item.estadoContribuyenteRuc ?? item.estado ?? item.estadoContribuyente ?? '',
    direccionMatriz: item.direccionMatriz ?? item.direccion ?? item.domicilioFiscal ?? '',
    actividadPrincipal: item.actividadEconomicaPrincipal ?? item.actividadPrincipal ?? item.actividad_economica_principal ?? '',
    regimen: item.regimen ?? '', tipoContribuyente: item.tipoContribuyente ?? item.tipo_contribuyente ?? '',
    obligadoContabilidad: item.obligadoLlevarContabilidad ?? item.obligado_contabilidad ?? null, fuente: 'SRI'
  };
}

async function auditarSaas(accion: string, emisorId: string | null, actorUserId: string | null, detalle: Record<string, unknown>) {
  try {
    let cuentaId: string | null = null;
    if (emisorId) cuentaId = (await supabase.from('contribuyentes_cliente_saas').select('cuenta_id').eq('emisor_id',emisorId).maybeSingle()).data?.cuenta_id ?? null;
    await supabase.from('auditoria_saas').insert({cuenta_id:cuentaId,emisor_id:emisorId,actor_user_id:actorUserId,accion,detalle});
  } catch {}
}

export async function registrarRutasProveedor(app: FastifyInstance) {
  app.get('/proveedor/resumen', async (request, reply) => {
    if (!await exigirProveedor(request, reply)) return;
    const inicioMes = new Date(); inicioMes.setDate(1); inicioMes.setHours(0,0,0,0);
    const [{ count: empresas }, { count: activas }, { count: vencidas }, { data: ingresos }, { count: documentosMes }, { count: contribuyentes }] = await Promise.all([
      supabase.from('emisores').select('id', { count: 'exact', head: true }),
      supabase.from('suscripciones').select('id', { count: 'exact', head: true }).eq('estado', 'activa'),
      supabase.from('suscripciones').select('id', { count: 'exact', head: true }).in('estado', ['vencida', 'suspendida']),
      supabase.from('pagos_suscripcion').select('monto').gte('fecha_pago', inicioMes.toISOString().slice(0, 10)),
      supabase.from('comprobantes').select('id', { count: 'exact', head: true }).eq('estado','autorizado').gte('created_at', inicioMes.toISOString()),
      supabase.from('contribuyentes_cliente_saas').select('id', { count: 'exact', head: true }).eq('activo',true),
    ]);
    const ingresosMes = (ingresos ?? []).reduce((s, x) => s + Number(x.monto || 0), 0);
    return reply.send({ empresas: empresas ?? 0, activas: activas ?? 0, vencidas: vencidas ?? 0, ingresosMes, documentosMes: documentosMes ?? 0, contribuyentes: contribuyentes ?? 0 });
  });

  app.get<{ Querystring: { ruc?: string } }>('/proveedor/ruc/consultar', async (request, reply) => {
    if (!await exigirProveedor(request, reply)) return;
    const ruc = String(request.query.ruc ?? '').replace(/\D/g, '');
    const vr = validarRucEcuador(ruc);
    if (!vr.ok) return reply.status(400).send({ encontrado: false, error: vr.mensaje });
    try {
      const u = new URL(env.sriRucLookupUrl);
      u.searchParams.set('ruc', ruc); u.searchParams.set('numeroRuc', ruc);
      const r = await fetch(u, { headers: { Accept: 'application/json', 'User-Agent': 'CONTSERTRIB/9.7.7' } });
      if (!r.ok) return reply.status(502).send({ encontrado: false, error: `El servicio de consulta del SRI respondió HTTP ${r.status}.` });
      const raw = await r.json() as any;
      const item = Array.isArray(raw) ? raw[0] : raw?.data?.[0] ?? raw?.data ?? raw;
      if (!item) return reply.status(404).send({ encontrado: false, error: 'El RUC no fue encontrado en la consulta configurada.' });
      const datos = {
        ruc,
        razonSocial: item.razonSocial ?? item.razon_social ?? item.nombreRazonSocial ?? item.nombre ?? '',
        nombreComercial: item.nombreComercial ?? item.nombre_comercial ?? '',
        estado: item.estadoContribuyenteRuc ?? item.estado ?? item.estadoContribuyente ?? '',
        direccionMatriz: item.direccionMatriz ?? item.direccion ?? item.domicilioFiscal ?? '',
        actividadPrincipal: item.actividadEconomicaPrincipal ?? item.actividadPrincipal ?? item.actividad_economica_principal ?? '',
        regimen: item.regimen ?? '',
        tipoContribuyente: item.tipoContribuyente ?? item.tipo_contribuyente ?? '',
        obligadoContabilidad: item.obligadoLlevarContabilidad ?? item.obligado_contabilidad ?? null,
        fuente: 'SRI'
      };
      return reply.send({ encontrado: true, datos, validacion: vr });
    } catch (err) {
      request.log.error({ err }, 'Consulta RUC proveedor falló');
      return reply.status(502).send({ encontrado: false, error: 'No fue posible consultar el catastro del SRI en este momento.' });
    }
  });

  app.get('/proveedor/planes', async (request, reply) => {
    if (!await exigirProveedor(request, reply)) return;
    const { data, error } = await supabase.from('planes_suscripcion').select('*').order('orden');
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(data ?? []);
  });

  app.patch<{ Params: { id: string }; Body: { nombre?: string; descripcion?: string; precioMensual?: number; activo?: boolean; maxDocumentosMes?: number | null; maxContribuyentes?: number; maxEstablecimientos?: number; maxPuntosEmision?: number; maxUsuarios?: number; incluyeInventario?: boolean; incluyeAts?: boolean; incluyeCargaElectronica?: boolean; incluyeReportesAvanzados?: boolean } }>('/proveedor/planes/:id', async (request, reply) => {
    if (!await exigirProveedor(request, reply)) return;
    const b = request.body ?? {};
    const cambios: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (b.nombre !== undefined) cambios.nombre = String(b.nombre).trim();
    if (b.descripcion !== undefined) cambios.descripcion = String(b.descripcion).trim() || null;
    if (b.precioMensual !== undefined) {
      const precio = Number(b.precioMensual);
      if (!Number.isFinite(precio) || precio < 0) return reply.status(400).send({ error: 'El precio mensual no es válido.' });
      cambios.precio_mensual = precio;
    }
    if (b.activo !== undefined) cambios.activo = Boolean(b.activo);
    if (b.maxDocumentosMes !== undefined) cambios.max_documentos_mes = b.maxDocumentosMes == null || Number(b.maxDocumentosMes) < 0 ? null : Math.floor(Number(b.maxDocumentosMes));
    if (b.maxContribuyentes !== undefined) cambios.max_contribuyentes = Math.max(1, Math.floor(Number(b.maxContribuyentes)));
    if (b.maxEstablecimientos !== undefined) cambios.max_establecimientos = Math.max(1, Math.floor(Number(b.maxEstablecimientos)));
    if (b.maxPuntosEmision !== undefined) cambios.max_puntos_emision = Math.max(1, Math.floor(Number(b.maxPuntosEmision)));
    if (b.maxUsuarios !== undefined) cambios.max_usuarios = Math.max(1, Math.floor(Number(b.maxUsuarios)));
    if (b.incluyeInventario !== undefined) cambios.incluye_inventario = Boolean(b.incluyeInventario);
    if (b.incluyeAts !== undefined) cambios.incluye_ats = Boolean(b.incluyeAts);
    if (b.incluyeCargaElectronica !== undefined) cambios.incluye_carga_electronica = Boolean(b.incluyeCargaElectronica);
    if (b.incluyeReportesAvanzados !== undefined) cambios.incluye_reportes_avanzados = Boolean(b.incluyeReportesAvanzados);
    const { data, error } = await supabase.from('planes_suscripcion').update(cambios).eq('id', request.params.id).select('*').single();
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(data);
  });

  app.get('/proveedor/clientes', async (request, reply) => {
    if (!await exigirProveedor(request, reply)) return;
    const { data: emisores, error } = await supabase.from('emisores').select('id,ruc,razon_social,nombre_comercial,direccion_matriz,ambiente,created_at').order('created_at', { ascending: false });
    if (error) return reply.status(500).send({ error: error.message });
    const ids = (emisores ?? []).map(x => x.id);
    const { data: subs } = ids.length ? await supabase.from('suscripciones').select('id,emisor_id,estado,fecha_inicio,proximo_vencimiento,plan_id,planes_suscripcion(codigo,nombre,precio_mensual)').in('emisor_id', ids) : { data: [] as any[] };
    const { data: certs } = ids.length ? await supabase.from('certificados').select('emisor_id,fecha_expiracion').in('emisor_id', ids).eq('alias','PRINCIPAL') : { data: [] as any[] };
    const { data: contribs } = ids.length ? await supabase.from('contribuyentes_cliente_saas').select('emisor_id,cuenta_id,activo,cuentas_cliente_saas(id,nombre,email_admin,plan_id,estado,planes_suscripcion(codigo,nombre,precio_mensual,max_documentos_mes,max_contribuyentes,max_establecimientos,max_puntos_emision,max_usuarios,incluye_inventario,incluye_ats,incluye_carga_electronica,incluye_reportes_avanzados))').in('emisor_id', ids) : { data: [] as any[] };
    const subMap = new Map((subs ?? []).map(x => [x.emisor_id, x]));
    const certMap = new Map((certs ?? []).map(x => [x.emisor_id, x]));
    const contribMap = new Map((contribs ?? []).map(x => [x.emisor_id, x]));
    const accountIds = [...new Set((contribs ?? []).map(x => x.cuenta_id).filter(Boolean))];
    const { data: allContribs } = accountIds.length ? await supabase.from('contribuyentes_cliente_saas').select('cuenta_id,emisor_id,activo').in('cuenta_id', accountIds) : { data: [] as any[] };
    const countMap = new Map<string, number>();
    for (const c of allContribs ?? []) if (c.activo) countMap.set(c.cuenta_id, (countMap.get(c.cuenta_id) ?? 0) + 1);
    return reply.send((emisores ?? []).filter(e => { const c:any=contribMap.get(e.id); return !!c?.activo && c?.cuentas_cliente_saas?.estado !== 'eliminada'; }).map(e => { const c:any=contribMap.get(e.id); return { ...e, suscripcion: subMap.get(e.id) ?? null, certificado: certMap.get(e.id) ?? null, configuracionPendiente: !certMap.has(e.id), cuenta: c?.cuentas_cliente_saas ?? null, contribuyentes: c?.cuenta_id ? countMap.get(c.cuenta_id) ?? 1 : 1 }; }));
  });

  app.post<{ Body: { ruc?: string; razonSocial?: string; nombreComercial?: string; direccionMatriz?: string; emailAdmin?: string; passwordTemporal?: string; planCodigo?: string; ambiente?: 'pruebas'|'produccion'; diasIniciales?: number } }>('/proveedor/clientes', async (request, reply) => {
    if (!await exigirProveedor(request, reply)) return;
    const b = request.body ?? {};
    const ruc = String(b.ruc ?? '').trim();
    const razonSocial = String(b.razonSocial ?? '').trim();
    const direccion = String(b.direccionMatriz ?? '').trim();
    const email = String(b.emailAdmin ?? '').trim().toLowerCase();
    const vr = validarRucEcuador(ruc);
    if (!vr.ok) return reply.status(400).send({ error: vr.mensaje });
    if (!EMAIL_REGEX.test(email)) return reply.status(400).send({ error: 'El correo del administrador no es válido.' });
    let datosSRI: any = null;
    try { datosSRI = await consultarRucSRI(ruc, request); } catch (err) { return reply.status(502).send({ error: err instanceof Error ? err.message : 'No fue posible consultar el SRI.' }); }
    if (!datosSRI) return reply.status(404).send({ error: 'El RUC no fue encontrado en el catastro consultado.' });
    const estadoSRI = String(datosSRI.estado || '').toUpperCase();
    if (estadoSRI && !estadoSRI.includes('ACTIVO')) return reply.status(409).send({ error: `El RUC consultado no está ACTIVO en el SRI. Estado: ${datosSRI.estado}` });
    const razonSocialFinal = String(datosSRI.razonSocial || razonSocial).trim();
    const direccionFinal = String(datosSRI.direccionMatriz || direccion).trim();
    const nombreComercialFinal = String(datosSRI.nombreComercial || b.nombreComercial || '').trim() || null;
    if (!razonSocialFinal || !direccionFinal) return reply.status(422).send({ error: 'El SRI no devolvió razón social o dirección matriz; no se puede crear el cliente automáticamente.' });

    const { data: existente } = await supabase.from('emisores').select('id').eq('ruc', ruc).maybeSingle();
    let emisorReutilizado: { id: string } | null = null;
    if (existente) {
      const { data: relActiva } = await supabase.from('contribuyentes_cliente_saas')
        .select('id,cuenta_id,activo,cuentas_cliente_saas(estado)')
        .eq('emisor_id', existente.id).eq('activo', true).maybeSingle();
      if (relActiva) return reply.status(409).send({ error: 'Ese RUC ya está registrado en una cuenta SaaS activa.', emisorId: existente.id });
      emisorReutilizado = existente;
    }

    const ambiente = b.ambiente === 'pruebas' ? 'pruebas' : 'produccion';
    const planCode = String(b.planCodigo ?? 'BASICO').toUpperCase();
    const { data: plan } = await supabase.from('planes_suscripcion').select('id,codigo,nombre,precio_mensual').eq('codigo', planCode).eq('activo', true).maybeSingle();
    if (!plan) return reply.status(400).send({ error: `El plan ${planCode} no existe o está inactivo.` });
    let emisor: { id: string } | null = emisorReutilizado;
    if (emisor) {
      const { error: uErr } = await supabase.from('emisores').update({
        razon_social: razonSocialFinal,
        nombre_comercial: nombreComercialFinal,
        direccion_matriz: direccionFinal,
        ambiente
      }).eq('id', emisor.id);
      if (uErr) return reply.status(500).send({ error: 'No se pudo reutilizar el RUC archivado.', detalle: uErr.message });
    } else {
      const { data: nuevoEmisor, error: eError } = await supabase.from('emisores').insert({ ruc, razon_social: razonSocialFinal, nombre_comercial: nombreComercialFinal, direccion_matriz: direccionFinal, obligado_contabilidad: false, ambiente }).select('id').single();
      if (eError || !nuevoEmisor) return reply.status(500).send({ error: 'No se pudo crear la empresa.', detalle: eError?.message });
      emisor = nuevoEmisor;
    }
    if (!emisor) return reply.status(500).send({ error: 'No se pudo completar la creación o recuperación del RUC.' });

    const { error: estError } = await supabase.from('establecimientos_emisor').upsert({ emisor_id: emisor.id, codigo: '001', tipo_establecimiento: 'MATRIZ', nombre_comercial: nombreComercialFinal, direccion: direccionFinal, activo: true }, { onConflict: 'emisor_id,codigo' });
    if (estError) return reply.status(500).send({ error: 'No se pudo preparar la matriz 001.', detalle: estError.message });
    const { data: puntoExistente } = await supabase.from('puntos_emision').select('id').eq('emisor_id', emisor.id).eq('establecimiento','001').eq('punto_emision','001').maybeSingle();
    let punto: { id: string } | null = puntoExistente;
    if (punto) {
      const { error: pu } = await supabase.from('puntos_emision').update({ direccion: direccionFinal, activo: true }).eq('id', punto.id);
      if (pu) return reply.status(500).send({ error: 'No se pudo reactivar el punto 001-001.', detalle: pu.message });
    } else {
      const { data: nuevoPunto, error: pError } = await supabase.from('puntos_emision').insert({ emisor_id: emisor.id, establecimiento: '001', punto_emision: '001', direccion: direccionFinal, activo: true }).select('id').single();
      if (pError || !nuevoPunto) return reply.status(500).send({ error: 'La empresa se creó pero no se pudo crear el punto de emisión.', emisorId: emisor.id, detalle: pError?.message });
      punto = nuevoPunto;
    }

    const password = String(b.passwordTemporal ?? '').trim() || generarPasswordTemporal();
    if (!punto) return reply.status(500).send({ error: 'No se pudo completar la estructura inicial del cliente.' });
    if (password.length < 8) return reply.status(400).send({ error: 'La contraseña temporal debe tener al menos 8 caracteres.' });
    let userId: string;
    try {
      userId = await crearOEncontrarUsuario(email, password);
      await agregarUsuarioANegocio(userId, emisor.id, 'admin');
    } catch (err) {
      return reply.status(500).send({ error: 'La empresa fue creada, pero no se pudo crear el usuario administrador.', emisorId: emisor.id, detalle: err instanceof Error ? err.message : String(err) });
    }

    const dias = Math.max(1, Math.min(365, Number(b.diasIniciales ?? 30)));
    const inicio = hoyEcuadorIso();
    const vencimiento = fechaMasDias(dias);
    const { data: cuenta, error: cuentaError } = await supabase.from('cuentas_cliente_saas').insert({ nombre: razonSocial, email_admin: email, admin_user_id: userId, plan_id: plan.id, estado: 'activa', ruc_principal: ruc, datos_ruc_verificados: true, ultimo_ruc_verificado_at: new Date().toISOString() }).select('*').single();
    if (cuentaError || !cuenta) return reply.status(500).send({ error: 'La empresa y usuario quedaron creados, pero no se pudo crear la cuenta SaaS.', emisorId: emisor.id, detalle: cuentaError?.message });
    const { data: relacionExistente } = await supabase.from('contribuyentes_cliente_saas').select('id').eq('emisor_id', emisor.id).maybeSingle();
    if (relacionExistente) {
      const { error: relErr } = await supabase.from('contribuyentes_cliente_saas').update({ cuenta_id: cuenta.id, activo: true }).eq('id', relacionExistente.id);
      if (relErr) return reply.status(500).send({ error: 'La cuenta se creó, pero no se pudo reactivar la relación del RUC.', detalle: relErr.message });
    } else {
      const { error: relErr } = await supabase.from('contribuyentes_cliente_saas').insert({ cuenta_id: cuenta.id, emisor_id: emisor.id, activo: true });
      if (relErr) return reply.status(500).send({ error: 'La cuenta se creó, pero no se pudo asociar el RUC.', detalle: relErr.message });
    }
    const { data: subExistente } = await supabase.from('suscripciones').select('id').eq('emisor_id', emisor.id).maybeSingle();
    let sub: any = null;
    let sError: any = null;
    if (subExistente) {
      const r = await supabase.from('suscripciones').update({ cuenta_id: cuenta.id, plan_id: plan.id, estado: 'activa', modalidad: 'prueba', ultima_activacion: inicio, dias_activacion: dias, fecha_inicio: inicio, proximo_vencimiento: vencimiento, fecha_cancelacion: null, updated_at: new Date().toISOString() }).eq('id', subExistente.id).select('*').single();
      sub = r.data; sError = r.error;
    } else {
      const r = await supabase.from('suscripciones').insert({ emisor_id: emisor.id, cuenta_id: cuenta.id, plan_id: plan.id, estado: 'activa', modalidad: 'prueba', ultima_activacion: inicio, dias_activacion: dias, fecha_inicio: inicio, proximo_vencimiento: vencimiento }).select('*').single();
      sub = r.data; sError = r.error;
    }
    if (sError || !sub) return reply.status(500).send({ error: 'La empresa y usuario quedaron creados, pero falló la suscripción.', emisorId: emisor.id, detalle: sError?.message });
    await auditarSaas('CLIENTE_CREADO', emisor.id, (await esProveedorAdmin(request)).userId ?? null, { ruc, plan: plan.codigo, diasIniciales: dias, fuenteRuc: 'SRI' });

    let correoEnviado = false;
    let correoError: string | null = null;
    try {
      await enviarComprobantePorCorreo({ to: email, subject: 'Acceso a CONTSERTRIB', html: `<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto"><h2>Bienvenido a CONTSERTRIB</h2><p>Su empresa <strong>${razonSocialFinal.replace(/[<>]/g,'')}</strong> fue registrada.</p><p><strong>Acceso:</strong> <a href="${env.appUrl}/login">${env.appUrl}/login</a></p><p><strong>Usuario:</strong> ${email}</p><p><strong>Contraseña temporal:</strong> ${password}</p><p>Por seguridad, cambie esta contraseña después de ingresar.</p><p>Plan: ${plan.nombre}</p><p>Vigencia inicial: ${dias} días.</p></div>` });
      correoEnviado = true;
    } catch (err) { correoError = err instanceof Error ? err.message : String(err); }

    return reply.status(201).send({ ok: true, emisorId: emisor.id, puntoEmisionId: punto.id, userId, plan: { codigo: plan.codigo, nombre: plan.nombre, precioMensual: plan.precio_mensual }, fechaInicio: inicio, proximoVencimiento: vencimiento, correoEnviado, correoError, acceso: { url: `${env.appUrl}/login`, email, passwordTemporal: password } });
  });

  app.patch<{ Params: { emisorId: string }; Body: { planCodigo?: string; nota?: string } }>('/proveedor/clientes/:emisorId/plan', async (request, reply) => {
    if (!await exigirProveedor(request, reply)) return;
    const emisorId = request.params.emisorId;
    const codigo = String(request.body?.planCodigo ?? '').trim().toUpperCase();
    if (!codigo) return reply.status(400).send({ error: 'Selecciona un plan.' });
    const { data: plan } = await supabase.from('planes_suscripcion').select('*').eq('codigo', codigo).eq('activo', true).maybeSingle();
    if (!plan) return reply.status(404).send({ error: 'El plan solicitado no existe o está inactivo.' });
    const { data: sub } = await supabase.from('suscripciones').select('id,plan_id,estado').eq('emisor_id', emisorId).maybeSingle();
    if (!sub) return reply.status(404).send({ error: 'El cliente no tiene una suscripción.' });
    const [{ count: docs }, { count: ests }, { count: puntos }, { data: rel }] = await Promise.all([
      supabase.from('comprobantes').select('id',{count:'exact',head:true}).eq('emisor_id',emisorId).eq('estado','autorizado').gte('created_at',`${hoyEcuadorIso().slice(0,7)}-01T00:00:00-05:00`),
      supabase.from('establecimientos_emisor').select('id',{count:'exact',head:true}).eq('emisor_id',emisorId).eq('activo',true),
      supabase.from('puntos_emision').select('id',{count:'exact',head:true}).eq('emisor_id',emisorId).eq('activo',true),
      supabase.from('contribuyentes_cliente_saas').select('cuenta_id').eq('emisor_id',emisorId).maybeSingle()
    ]);
    if (plan.max_documentos_mes != null && Number(docs ?? 0) > Number(plan.max_documentos_mes)) return reply.status(409).send({ error: `No se puede bajar al plan ${plan.nombre}: el consumo actual (${docs ?? 0}) supera su límite mensual (${plan.max_documentos_mes}).` });
    if (Number(ests ?? 0) > Number(plan.max_establecimientos ?? 999999)) return reply.status(409).send({ error: `El cliente ya tiene ${ests ?? 0} establecimientos y el plan ${plan.nombre} permite ${plan.max_establecimientos}.` });
    if (Number(puntos ?? 0) > Number(plan.max_puntos_emision ?? 999999)) return reply.status(409).send({ error: `El cliente ya tiene ${puntos ?? 0} puntos de emisión y el plan ${plan.nombre} permite ${plan.max_puntos_emision}.` });
    if (rel?.cuenta_id) { const { count: contribs } = await supabase.from('contribuyentes_cliente_saas').select('id',{count:'exact',head:true}).eq('cuenta_id',rel.cuenta_id).eq('activo',true); if (Number(contribs ?? 0) > Number(plan.max_contribuyentes ?? 999999)) return reply.status(409).send({ error: `El cliente ya tiene ${contribs ?? 0} contribuyentes y el plan ${plan.nombre} permite ${plan.max_contribuyentes}.` }); }
    const { data, error } = await supabase.from('suscripciones').update({ plan_id: plan.id, updated_at: new Date().toISOString(), nota: String(request.body?.nota ?? '').trim() || null }).eq('id',sub.id).select('*').single();
    if (error) return reply.status(500).send({ error: error.message });
    const rel = (await supabase.from('contribuyentes_cliente_saas').select('cuenta_id').eq('emisor_id',emisorId).maybeSingle()).data;
    if (rel?.cuenta_id) await supabase.from('cuentas_cliente_saas').update({ plan_id: plan.id, updated_at: new Date().toISOString() }).eq('id', rel.cuenta_id);
    await auditarSaas('PLAN_CAMBIADO', emisorId, (await esProveedorAdmin(request)).userId ?? null, { plan: plan.codigo });
    return reply.send({ ok:true, plan, suscripcion:data });
  });

  app.patch<{ Params: { emisorId: string }; Body: { estado?: Estado; dias?: number; nota?: string } }>('/proveedor/clientes/:emisorId/suscripcion', async (request, reply) => {
    if (!await exigirProveedor(request, reply)) return;
    const b = request.body ?? {};
    if (b.estado && !ESTADOS.includes(b.estado)) return reply.status(400).send({ error: 'Estado de suscripción no válido.' });
    const cambios: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (b.estado) cambios.estado = b.estado;
    if (b.nota !== undefined) cambios.nota = String(b.nota).trim() || null;
    if (b.dias !== undefined) { const dias = Math.max(0, Math.min(3650, Number(b.dias))); cambios.proximo_vencimiento = fechaMasDias(dias); if (b.estado === 'activa') { cambios.modalidad = dias === 30 ? 'prueba' : 'cortesia'; cambios.ultima_activacion = hoyEcuadorIso(); cambios.dias_activacion = dias; } }
    const { data, error } = await supabase.from('suscripciones').update(cambios).eq('emisor_id', request.params.emisorId).select('*').single();
    if (error) return reply.status(500).send({ error: error.message });
    await auditarSaas('SUSCRIPCION_ACTUALIZADA', request.params.emisorId, (await esProveedorAdmin(request)).userId ?? null, { cambios });
    return reply.send(data);
  });

  app.post<{ Params: { emisorId: string }; Body: { monto?: number; metodo?: string; referencia?: string; dias?: number; nota?: string } }>('/proveedor/clientes/:emisorId/pago', async (request, reply) => {
    if (!await exigirProveedor(request, reply)) return;
    const b = request.body ?? {};
    const monto = Number(b.monto);
    if (!Number.isFinite(monto) || monto <= 0) return reply.status(400).send({ error: 'El monto debe ser mayor que cero.' });
    const { data: sub } = await supabase.from('suscripciones').select('id,proximo_vencimiento').eq('emisor_id', request.params.emisorId).maybeSingle();
    if (!sub) return reply.status(404).send({ error: 'El cliente no tiene una suscripción.' });
    const dias = Math.max(1, Math.min(3650, Number(b.dias ?? 30)));
    const desde = sub.proximo_vencimiento && sub.proximo_vencimiento >= hoyEcuadorIso() ? sub.proximo_vencimiento : hoyEcuadorIso();
    const hastaDate = new Date(`${desde}T12:00:00`); hastaDate.setDate(hastaDate.getDate() + dias);
    const hasta = hastaDate.toISOString().slice(0,10);
    const { data: pago, error } = await supabase.from('pagos_suscripcion').insert({ suscripcion_id: sub.id, emisor_id: request.params.emisorId, monto, fecha_pago: hoyEcuadorIso(), periodo_desde: desde, periodo_hasta: hasta, metodo: String(b.metodo ?? 'efectivo'), referencia: String(b.referencia ?? '').trim() || null, nota: String(b.nota ?? '').trim() || null }).select('*').single();
    if (error) return reply.status(500).send({ error: error.message });
    const { data: actualizada, error: uError } = await supabase.from('suscripciones').update({ estado: 'activa', proximo_vencimiento: hasta, updated_at: new Date().toISOString() }).eq('id', sub.id).select('*').single();
    if (uError) return reply.status(500).send({ error: uError.message });
    await auditarSaas('PAGO_REGISTRADO', request.params.emisorId, (await esProveedorAdmin(request)).userId ?? null, { monto, dias, metodo: String(b.metodo ?? 'efectivo') });
    return reply.send({ ok: true, pago, suscripcion: actualizada });
  });

  app.post<{ Params: { emisorId: string } }>('/proveedor/clientes/:emisorId/reenvio-acceso', async (request, reply) => {
    if (!await exigirProveedor(request, reply)) return;
    const { data: emisor } = await supabase.from('emisores').select('razon_social').eq('id', request.params.emisorId).single();
    const { data: rel } = await supabase.from('usuarios_emisor').select('user_id').eq('emisor_id', request.params.emisorId).eq('rol','admin').limit(1).maybeSingle();
    if (!emisor || !rel) return reply.status(404).send({ error: 'No se encontró el administrador del cliente.' });
    const email = await obtenerEmailAuth(rel.user_id);
    if (!email) return reply.status(404).send({ error: 'No se pudo obtener el correo del administrador.' });
    const password = generarPasswordTemporal();
    const reset = await fetch(`${env.supabaseUrl}/auth/v1/admin/users/${rel.user_id}`, { method:'PUT', headers:{'Content-Type':'application/json',apikey:env.supabaseServiceRoleKey,Authorization:`Bearer ${env.supabaseServiceRoleKey}`}, body:JSON.stringify({ password }) });
    if (!reset.ok) return reply.status(500).send({ error:'No se pudo regenerar la contraseña.' });
    let correoEnviado=false;
    try { await enviarComprobantePorCorreo({to:email,subject:'Nuevo acceso a CONTSERTRIB',html:`<div style="font-family:Arial"><h2>Nuevo acceso</h2><p>${emisor.razon_social}</p><p>Usuario: <strong>${email}</strong></p><p>Contraseña temporal: <strong>${password}</strong></p><p><a href="${env.appUrl}/login">Ingresar a CONTSERTRIB</a></p></div>`}); correoEnviado=true; } catch {}
    return reply.send({ ok:true, correo: email, correoEnviado });
  });

  app.get<{ Params: { emisorId: string } }>('/proveedor/clientes/:emisorId/estructura', async (request, reply) => {
    if (!await exigirProveedor(request, reply)) return;
    const emisorId = request.params.emisorId;
    const [{ data: ests }, { data: puntos }, { data: cuentaRel }] = await Promise.all([
      supabase.from('establecimientos_emisor').select('*').eq('emisor_id',emisorId).order('codigo'),
      supabase.from('puntos_emision').select('*').eq('emisor_id',emisorId).order('establecimiento').order('punto_emision'),
      supabase.from('contribuyentes_cliente_saas').select('cuenta_id,activo,cuentas_cliente_saas(id,nombre,email_admin,plan_id,planes_suscripcion(*) )').eq('emisor_id',emisorId).maybeSingle(),
    ]);
    return reply.send({ establecimientos: ests ?? [], puntos: puntos ?? [], cuenta: cuentaRel ?? null });
  });

  app.post<{ Params: { emisorId: string }; Body: { codigo?: string; nombreComercial?: string; direccion?: string } }>('/proveedor/clientes/:emisorId/establecimientos', async (request, reply) => {
    if (!await exigirProveedor(request, reply)) return;
    const b=request.body??{}; const codigo=String(b.codigo??'').replace(/\D/g,'').padStart(3,'0');
    if(!/^\d{3}$/.test(codigo)||!String(b.direccion??'').trim()) return reply.status(400).send({error:'Código de 3 dígitos y dirección son obligatorios.'});
    const { data: plan } = await supabase.from('suscripciones').select('plan_id,planes_suscripcion(max_establecimientos)').eq('emisor_id',request.params.emisorId).maybeSingle();
    const { count } = await supabase.from('establecimientos_emisor').select('id',{count:'exact',head:true}).eq('emisor_id',request.params.emisorId).eq('activo',true);
    if (plan?.planes_suscripcion && Number(count??0) >= Number((plan.planes_suscripcion as any).max_establecimientos??9999)) return reply.status(409).send({error:'El plan contratado no permite más establecimientos activos.'});
    const { data,error}=await supabase.from('establecimientos_emisor').insert({emisor_id:request.params.emisorId,codigo,nombre_comercial:String(b.nombreComercial??'').trim()||null,direccion:String(b.direccion).trim(),activo:true}).select('*').single();
    if(error||!data)return reply.status(500).send({error:error?.message??'No se pudo crear el establecimiento.'}); return reply.status(201).send(data);
  });

  app.post<{ Params: { emisorId: string }; Body: { establecimiento?: string; puntoEmision?: string; direccion?: string } }>('/proveedor/clientes/:emisorId/puntos', async (request, reply) => {
    if (!await exigirProveedor(request, reply)) return;
    const b=request.body??{}; const establecimiento=String(b.establecimiento??'').replace(/\D/g,'').padStart(3,'0'); const puntoEmision=String(b.puntoEmision??'').replace(/\D/g,'').padStart(3,'0');
    if(!/^\d{3}$/.test(establecimiento)||!/^\d{3}$/.test(puntoEmision)) return reply.status(400).send({error:'Establecimiento y punto de emisión deben tener 3 dígitos.'});
    const {data:est}=await supabase.from('establecimientos_emisor').select('direccion,activo').eq('emisor_id',request.params.emisorId).eq('codigo',establecimiento).maybeSingle();
    if(!est||!est.activo)return reply.status(400).send({error:'El establecimiento no existe o está inactivo.'});
    const { data: plan } = await supabase.from('suscripciones').select('plan_id,planes_suscripcion(max_puntos_emision)').eq('emisor_id',request.params.emisorId).maybeSingle();
    const { count } = await supabase.from('puntos_emision').select('id',{count:'exact',head:true}).eq('emisor_id',request.params.emisorId).eq('activo',true);
    if (plan?.planes_suscripcion && Number(count??0) >= Number((plan.planes_suscripcion as any).max_puntos_emision??9999)) return reply.status(409).send({error:'El plan contratado no permite más puntos de emisión activos.'});
    const {data,error}=await supabase.from('puntos_emision').insert({emisor_id:request.params.emisorId,establecimiento,punto_emision:puntoEmision,direccion:String(b.direccion??est.direccion).trim(),activo:true}).select('*').single();
    if(error||!data)return reply.status(500).send({error:error?.message??'No se pudo crear el punto de emisión.'}); return reply.status(201).send(data);
  });

  app.post<{ Params: { emisorId: string }; Body: { ruc?: string; razonSocial?: string; direccionMatriz?: string; nombreComercial?: string; emailAdmin?: string } }>('/proveedor/clientes/:emisorId/contribuyentes', async (request, reply) => {
    if (!await exigirProveedor(request, reply)) return;
    const b=request.body??{}; const ruc=String(b.ruc??'').trim(); const razon=String(b.razonSocial??'').trim(); const direccion=String(b.direccionMatriz??'').trim();
    if(!/^\d{13}$/.test(ruc)||!razon||!direccion)return reply.status(400).send({error:'RUC, razón social y dirección matriz son obligatorios.'});
    const { data: rel }=await supabase.from('contribuyentes_cliente_saas').select('cuenta_id').eq('emisor_id',request.params.emisorId).maybeSingle();
    if(!rel?.cuenta_id)return reply.status(404).send({error:'El cliente no tiene cuenta SaaS.'});
    const { data: cuenta }=await supabase.from('cuentas_cliente_saas').select('id,plan_id,admin_user_id,email_admin,planes_suscripcion(max_contribuyentes)').eq('id',rel.cuenta_id).single();
    const { count }=await supabase.from('contribuyentes_cliente_saas').select('id',{count:'exact',head:true}).eq('cuenta_id',rel.cuenta_id).eq('activo',true);
    if(cuenta?.planes_suscripcion && Number(count??0)>=Number((cuenta.planes_suscripcion as any).max_contribuyentes??1))return reply.status(409).send({error:'El plan contratado no permite agregar más contribuyentes.'});
    const {data:exist}=await supabase.from('emisores').select('id').eq('ruc',ruc).maybeSingle(); if(exist)return reply.status(409).send({error:'Ese RUC ya está registrado en CONTSERTRIB.'});
    const {data:emisor,error:e}=await supabase.from('emisores').insert({ruc,razon_social:razon,nombre_comercial:String(b.nombreComercial??'').trim()||null,direccion_matriz:direccion,obligado_contabilidad:false,ambiente:'produccion'}).select('id').single();
    if(e||!emisor)return reply.status(500).send({error:e?.message??'No se pudo crear el contribuyente.'});
    const {error:ee}=await supabase.from('establecimientos_emisor').insert({emisor_id:emisor.id,codigo:'001',nombre_comercial:String(b.nombreComercial??'').trim()||null,direccion,activo:true});
    if(ee)return reply.status(500).send({error:ee.message});
    const {error:pe}=await supabase.from('puntos_emision').insert({emisor_id:emisor.id,establecimiento:'001',punto_emision:'001',direccion,activo:true});
    if(pe)return reply.status(500).send({error:pe.message});
    await supabase.from('contribuyentes_cliente_saas').insert({cuenta_id:rel.cuenta_id,emisor_id:emisor.id,activo:true});
    const {data:cuentaPlan}=await supabase.from('cuentas_cliente_saas').select('plan_id').eq('id',rel.cuenta_id).single();
    if(cuentaPlan?.plan_id)await supabase.from('suscripciones').insert({cuenta_id:rel.cuenta_id,emisor_id:emisor.id,plan_id:cuentaPlan.plan_id,estado:'activa',fecha_inicio:hoyEcuadorIso(),proximo_vencimiento:fechaMasDias(30)});
    const email=String(b.emailAdmin??cuenta?.email_admin??'').trim().toLowerCase();
    if(cuenta?.admin_user_id){ try { await agregarUsuarioANegocio(cuenta.admin_user_id,emisor.id,'admin'); } catch {} }
    else if(email){ try { const uid=await crearOEncontrarUsuario(email,generarPasswordTemporal()); await agregarUsuarioANegocio(uid,emisor.id,'admin'); } catch {} }
    return reply.status(201).send({ok:true,emisorId:emisor.id,ruc,razonSocial:razon});
  });

  app.delete<{ Params: { emisorId: string } }>('/proveedor/clientes/:emisorId', async (request, reply) => {
    if (!await exigirProveedor(request, reply)) return;
    const emisorId=request.params.emisorId;
    const { data: rel }=await supabase.from('contribuyentes_cliente_saas').select('cuenta_id').eq('emisor_id',emisorId).maybeSingle();
    if(!rel?.cuenta_id)return reply.status(404).send({error:'Cliente no encontrado en el esquema SaaS.'});
    await supabase.from('contribuyentes_cliente_saas').update({activo:false}).eq('cuenta_id',rel.cuenta_id);
    const { data: todos } = await supabase.from('contribuyentes_cliente_saas').select('emisor_id').eq('cuenta_id',rel.cuenta_id);
    const idsCuenta = (todos ?? []).map(x => x.emisor_id).filter(Boolean);
    if (idsCuenta.length) await supabase.from('suscripciones').update({estado:'cancelada',fecha_cancelacion:hoyEcuadorIso(),updated_at:new Date().toISOString()}).in('emisor_id',idsCuenta);
    await supabase.from('cuentas_cliente_saas').update({estado:'eliminada',updated_at:new Date().toISOString()}).eq('id',rel.cuenta_id);
    return reply.send({ok:true,mensaje:'Cliente eliminado del panel administrativo. El RUC, los comprobantes y el historial tributario se conservaron; el mismo RUC puede volver a configurarse como un nuevo cliente SaaS.'});
  });

}
