import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { supabase } from '../db/supabase.js';
import { env } from '../config/env.js';
import { obtenerSesion, crearOEncontrarUsuario, agregarUsuarioANegocio } from '../auth/sesiones.js';
import { enviarComprobantePorCorreo } from '../services/email.js';
import { fechaIsoEcuador } from '../utils/fechaEcuador.js';
import { facturarPagoSaas } from '../services/facturacionSaas.js';
import { registrarAuditoriaSaas } from '../services/auditoriaSaas.js';
import { obtenerEmailsAdminSaas, notificarNuevaSolicitudSaas } from '../services/notificacionesSaas.js';

const COOKIE = 'sesion';
const RUC_REGEX = /^\d{13}$/;
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

  // El Panel Maestro y su API quedan reservados exclusivamente al correo ROOT.
  // PROVEEDOR_ADMIN_EMAILS se mantiene para notificaciones administrativas,
  // pero NO concede acceso al panel.
  const email = await obtenerEmailAuth(sesion.userId);
  if (email && email.trim().toLowerCase() === env.rootAdminEmail) {
    return { ok: true, userId: sesion.userId, email };
  }
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

function mapearDatosSRI(data: any) {
  const item = Array.isArray(data) ? data[0] : data?.data?.[0] ?? data?.data ?? data;
  if (!item) return null;
  return {
    razonSocial: item.razonSocial ?? item.razon_social ?? item.nombreRazonSocial ?? item.nombre ?? null,
    nombreComercial: item.nombreComercial ?? item.nombre_comercial ?? null,
    estado: item.estadoContribuyenteRuc ?? item.estado ?? item.estadoContribuyente ?? null,
    direccionMatriz: item.direccionMatriz ?? item.direccion ?? item.domicilioFiscal ?? null,
    actividadPrincipal: item.actividadEconomicaPrincipal ?? item.actividadPrincipal ?? item.actividad_economica_principal ?? null,
    regimen: item.regimen ?? null,
    tipoContribuyente: item.tipoContribuyente ?? item.tipo_contribuyente ?? null,
    obligadoContabilidad: item.obligadoLlevarContabilidad ?? item.obligado_contabilidad ?? null,
    fuente: 'SRI',
  };
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

  app.get('/proveedor/salud', async (request, reply) => {
    if (!await exigirProveedor(request, reply)) return;
    const inicio = Date.now();
    const checks: Array<{ clave:string; nombre:string; estado:'ok'|'error'|'advertencia'; detalle?:string; ms?:number }> = [];
    const tDb=Date.now();
    const { error: dbError } = await supabase.from('emisores').select('id').limit(1);
    checks.push({clave:'base_datos',nombre:'Base de datos',estado:dbError?'error':'ok',detalle:dbError?.message,ms:Date.now()-tDb});
    let sriOk=true;
    try { const u=new URL(env.sriRucLookupUrl); sriOk=Boolean(u.protocol && u.hostname); } catch { sriOk=false; }
    checks.push({clave:'sri_config',nombre:'Conexión SRI configurada',estado:sriOk?'ok':'error',detalle:sriOk?'URL configurada':'SRI_RUC_LOOKUP_URL no es válida'});
    const correoOk=Boolean(env.resendApiKey && env.emailFrom);
    checks.push({clave:'correo',nombre:'Correo transaccional',estado:correoOk?'ok':'advertencia',detalle:correoOk?'RESEND_API_KEY y EMAIL_FROM configurados':'Faltan RESEND_API_KEY y/o EMAIL_FROM'});
    const storageOk=Boolean(env.supabaseUrl && env.supabaseServiceRoleKey);
    checks.push({clave:'almacenamiento',nombre:'Supabase Storage / backend',estado:storageOk?'ok':'error',detalle:storageOk?'Credenciales del backend presentes':'Faltan credenciales del backend'});
    const certificados = await supabase.from('certificados').select('id').eq('activo',true).limit(1);
    checks.push({clave:'firma',nombre:'Repositorio de firmas',estado:certificados.error?'advertencia':'ok',detalle:certificados.error?.message});
    const estado=checks.some(x=>x.estado==='error')?'error':checks.some(x=>x.estado==='advertencia')?'advertencia':'ok';
    return reply.send({ok:estado!=='error',estado,latenciaMs:Date.now()-inicio,checks,fecha:new Date().toISOString()});
  });

  // Motor tributario maestro: las vigencias por decreto son globales para todo CONTSERTRIB.
  // Los clientes no crean ni modifican estas reglas; ROOT las administra una sola vez.
  app.get('/proveedor/iva-decretos', async (request, reply) => {
    if (!await exigirProveedor(request, reply)) return;
    const { data, error } = await supabase.from('catalogo_iva_sri').select('*')
      .eq('tipo', 'TARIFA_ESPECIAL').order('fecha_desde', { ascending: false });
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(data ?? []);
  });

  app.post<{ Body: { descripcion?: string; tarifa?: number; codigoPorcentaje?: string; sector?: string; fechaDesde?: string; fechaHasta?: string | null; baseLegal?: string; activo?: boolean; aplicacionAutomatica?: boolean; requiereTurismo?: boolean } }>('/proveedor/iva-decretos', async (request, reply) => {
    const auth = await exigirProveedor(request, reply);
    if (!auth) return;
    const b = request.body ?? {};
    const tarifa = Number(b.tarifa);
    const desde = String(b.fechaDesde ?? '').trim();
    const hasta = b.fechaHasta ? String(b.fechaHasta).trim() : null;
    if (!b.descripcion || !Number.isFinite(tarifa) || tarifa < 0 || tarifa > 100 || !/^\d+$/.test(String(b.codigoPorcentaje ?? '')) || !/^\d{4}-\d{2}-\d{2}$/.test(desde)) {
      return reply.status(400).send({ error: 'Descripción, tarifa, código SRI y fecha desde son obligatorios y deben ser válidos.' });
    }
    if (hasta && !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) return reply.status(400).send({ error: 'Fecha hasta inválida.' });
    if (hasta && hasta < desde) return reply.status(400).send({ error: 'La fecha hasta no puede ser anterior a la fecha desde.' });
    const { data, error } = await supabase.from('catalogo_iva_sri').insert({
      codigo_porcentaje: String(b.codigoPorcentaje).trim(), descripcion: String(b.descripcion).trim(), tarifa,
      tipo: 'TARIFA_ESPECIAL', sector: String(b.sector ?? 'turismo').trim() || null,
      fecha_desde: desde, fecha_hasta: hasta, base_legal: String(b.baseLegal ?? '').trim() || null,
      activo: b.activo !== false, aplicacion_automatica: b.aplicacionAutomatica !== false,
      requiere_turismo: b.requiereTurismo !== false, updated_at: new Date().toISOString()
    }).select('*').single();
    if (error) return reply.status(500).send({ error: error.message });
    return reply.status(201).send({ ok: true, regla: data });
  });

  app.patch<{ Params: { id: string }; Body: { descripcion?: string; tarifa?: number; codigoPorcentaje?: string; sector?: string; fechaDesde?: string; fechaHasta?: string | null; baseLegal?: string; activo?: boolean; aplicacionAutomatica?: boolean; requiereTurismo?: boolean } }>('/proveedor/iva-decretos/:id', async (request, reply) => {
    if (!await exigirProveedor(request, reply)) return;
    const b = request.body ?? {};
    const cambios: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (b.descripcion !== undefined) cambios.descripcion = String(b.descripcion).trim();
    if (b.tarifa !== undefined) { const n = Number(b.tarifa); if (!Number.isFinite(n) || n < 0 || n > 100) return reply.status(400).send({ error: 'Tarifa inválida.' }); cambios.tarifa = n; }
    if (b.codigoPorcentaje !== undefined) { if (!/^\d+$/.test(String(b.codigoPorcentaje))) return reply.status(400).send({ error: 'Código SRI inválido.' }); cambios.codigo_porcentaje = String(b.codigoPorcentaje).trim(); }
    if (b.sector !== undefined) cambios.sector = String(b.sector).trim() || null;
    if (b.fechaDesde !== undefined) { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.fechaDesde))) return reply.status(400).send({ error: 'Fecha desde inválida.' }); cambios.fecha_desde = String(b.fechaDesde); }
    if (b.fechaHasta !== undefined) { if (b.fechaHasta && !/^\d{4}-\d{2}-\d{2}$/.test(String(b.fechaHasta))) return reply.status(400).send({ error: 'Fecha hasta inválida.' }); cambios.fecha_hasta = b.fechaHasta || null; }
    if (b.baseLegal !== undefined) cambios.base_legal = String(b.baseLegal).trim() || null;
    if (b.precioAnual !== undefined) { const precio = Number(b.precioAnual); if (!Number.isFinite(precio) || precio < 0) return reply.status(400).send({ error: 'El precio anual no es válido.' }); cambios.precio_anual = precio; }
    if (b.periodicidad !== undefined) { if (b.periodicidad !== 'mensual' && b.periodicidad !== 'anual') return reply.status(400).send({ error: 'Periodicidad no válida.' }); cambios.periodicidad = b.periodicidad; }
    if (b.activo !== undefined) cambios.activo = Boolean(b.activo);
    if (b.maxDocumentosAnio !== undefined) cambios.max_documentos_anio = b.maxDocumentosAnio == null || Number(b.maxDocumentosAnio) < 0 ? null : Math.floor(Number(b.maxDocumentosAnio));
    if (b.aplicacionAutomatica !== undefined) cambios.aplicacion_automatica = Boolean(b.aplicacionAutomatica);
    if (b.requiereTurismo !== undefined) cambios.requiere_turismo = Boolean(b.requiereTurismo);
    const { data, error } = await supabase.from('catalogo_iva_sri').update(cambios).eq('id', request.params.id).eq('tipo', 'TARIFA_ESPECIAL').select('*').single();
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({ ok: true, regla: data });
  });

  app.delete<{ Params: { id: string } }>('/proveedor/iva-decretos/:id', async (request, reply) => {
    if (!await exigirProveedor(request, reply)) return;
    const { error } = await supabase.from('catalogo_iva_sri').update({ activo: false, updated_at: new Date().toISOString() }).eq('id', request.params.id).eq('tipo', 'TARIFA_ESPECIAL');
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({ ok: true });
  });

  app.get('/proveedor/planes', async (request, reply) => {
    if (!await exigirProveedor(request, reply)) return;
    const { data, error } = await supabase.from('planes_suscripcion').select('*').order('orden');
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(data ?? []);
  });

  app.patch<{ Params: { id: string }; Body: { nombre?: string; descripcion?: string; precioMensual?: number; precioAnual?: number; periodicidad?: 'mensual'|'anual'; activo?: boolean; maxDocumentosMes?: number | null; maxDocumentosAnio?: number | null; maxContribuyentes?: number; maxEstablecimientos?: number; maxPuntosEmision?: number; maxUsuarios?: number; incluyeInventario?: boolean; incluyeAts?: boolean; incluyeCargaElectronica?: boolean; incluyeReportesAvanzados?: boolean } }>('/proveedor/planes/:id', async (request, reply) => {
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
    if (b.precioAnual !== undefined) {
      const precio = Number(b.precioAnual);
      if (!Number.isFinite(precio) || precio < 0) return reply.status(400).send({ error: 'El precio anual no es válido.' });
      cambios.precio_anual = precio;
    }
    if (b.periodicidad !== undefined) {
      if (b.periodicidad !== 'mensual' && b.periodicidad !== 'anual') return reply.status(400).send({ error: 'Periodicidad no válida.' });
      cambios.periodicidad = b.periodicidad;
    }
    if (b.activo !== undefined) cambios.activo = Boolean(b.activo);
    if (b.maxDocumentosAnio !== undefined) cambios.max_documentos_anio = b.maxDocumentosAnio == null || Number(b.maxDocumentosAnio) < 0 ? null : Math.floor(Number(b.maxDocumentosAnio));
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

  app.get<{ Querystring: { ruc?: string } }>('/proveedor/ruc-consultar', async (request, reply) => {
    if (!await exigirProveedor(request, reply)) return;
    const ruc = String(request.query.ruc ?? '').replace(/\D/g, '');
    if (!/^\d{13}$/.test(ruc)) return reply.status(400).send({ error: 'El RUC debe tener 13 dígitos.' });
    try {
      const u = new URL(env.sriRucLookupUrl);
      u.searchParams.set('ruc', ruc);
      u.searchParams.set('numeroRuc', ruc);
      const r = await fetch(u, { headers: { Accept: 'application/json', 'User-Agent': 'CONTSERTRIB/9.8.0' } });
      if (!r.ok) return reply.status(502).send({ error: `SRI respondió HTTP ${r.status}.` });
      const datos = mapearDatosSRI(await r.json());
      if (!datos) return reply.status(404).send({ encontrado: false, mensaje: 'RUC no encontrado en el catastro consultado.' });
      return reply.send({ encontrado: true, datos });
    } catch (e) {
      request.log.error({ err: e }, 'Consulta RUC SaaS falló');
      return reply.status(502).send({ error: 'No fue posible consultar el SRI en este momento.', detalle: e instanceof Error ? e.message : String(e) });
    }
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

  // Configuración de notificaciones administrativas. Solo ROOT puede leer/modificarla.
  app.get('/proveedor/configuracion-notificaciones', async (request, reply) => {
    if (!await exigirProveedor(request, reply)) return;
    const { data, error } = await supabase.from('configuracion_proveedor').select('id,admin_emails,updated_at').eq('id', 1).maybeSingle();
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({ adminEmails: Array.isArray(data?.admin_emails) && data.admin_emails.length ? data.admin_emails : await obtenerEmailsAdminSaas(), actualizadoAt: data?.updated_at ?? null, fuente: data?.admin_emails?.length ? 'base_datos' : 'PROVEEDOR_ADMIN_EMAILS' });
  });

  app.patch<{ Body: { adminEmails?: string[] | string } }>('/proveedor/configuracion-notificaciones', async (request, reply) => {
    const auth = await exigirProveedor(request, reply);
    if (!auth) return;
    const raw = request.body?.adminEmails;
    const lista = Array.isArray(raw) ? raw : String(raw ?? '').split(',');
    const emails = [...new Set(lista.map(x => String(x).trim().toLowerCase()).filter(Boolean))];
    if (!emails.length) return reply.status(400).send({ error: 'Debes indicar al menos un correo ROOT.' });
    if (emails.length > 10) return reply.status(400).send({ error: 'Puedes configurar como máximo 10 correos ROOT.' });
    if (emails.some(x => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x))) return reply.status(400).send({ error: 'Uno de los correos ROOT no es válido.' });
    const { data, error } = await supabase.from('configuracion_proveedor').upsert({ id: 1, admin_emails: emails, actualizado_por: auth.userId ?? null, updated_at: new Date().toISOString() }, { onConflict: 'id' }).select('id,admin_emails,updated_at').single();
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({ ok: true, adminEmails: data.admin_emails, actualizadoAt: data.updated_at });
  });

  app.post('/proveedor/configuracion-notificaciones/prueba', async (request, reply) => {
    if (!await exigirProveedor(request, reply)) return;
    const emails = await obtenerEmailsAdminSaas();
    if (!emails.length) return reply.status(400).send({ error: 'No hay correos ROOT configurados.' });
    const html = `<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto"><h2>✅ Prueba de notificaciones CONTSERTRIB</h2><p>El correo administrativo está configurado correctamente.</p><p>Las nuevas solicitudes del registro público se enviarán a esta lista.</p></div>`;
    try {
      for (const to of emails) await enviarComprobantePorCorreo({ to, subject: 'Prueba · Notificaciones ROOT CONTSERTRIB', html });
      return reply.send({ ok: true, destinatarios: emails });
    } catch (err) {
      return reply.status(502).send({ error: 'No se pudo enviar la prueba de correo.', detalle: err instanceof Error ? err.message : String(err) });
    }
  });

  // Solicitudes provenientes del registro público. No crean acceso por sí mismas.
  app.get('/proveedor/solicitudes-registro', async (request, reply) => {
    if (!await exigirProveedor(request, reply)) return;
    const { data, error } = await supabase.from('solicitudes_registro_saas')
      .select('*').order('creado_at', { ascending: false }).limit(100);
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(data ?? []);
  });

  app.post<{ Params: { id: string } }>('/proveedor/solicitudes-registro/:id/notificar', async (request, reply) => {
    if (!await exigirProveedor(request, reply)) return;
    const { data: solicitud, error } = await supabase.from('solicitudes_registro_saas').select('*').eq('id', request.params.id).maybeSingle();
    if (error) return reply.status(500).send({ error: error.message });
    if (!solicitud) return reply.status(404).send({ error: 'Solicitud no encontrada.' });
    try {
      const r = await notificarNuevaSolicitudSaas({
        id: solicitud.id, ruc: solicitud.ruc, razonSocial: solicitud.razon_social, nombreComercial: solicitud.nombre_comercial,
        email: solicitud.email, direccionMatriz: solicitud.direccion_matriz, planCodigo: solicitud.plan_codigo, ambiente: solicitud.ambiente, creadoAt: solicitud.creado_at
      });
      await supabase.from('solicitudes_registro_saas').update({ notificacion_admin_estado:'enviado', notificacion_admin_detalle:'Reenvío manual realizado por ROOT.', notificacion_admin_enviado_at:new Date().toISOString() }).eq('id', solicitud.id);
      return reply.send({ ok:true, destinatarios:r.destinatarios });
    } catch (err) {
      const detalle=err instanceof Error?err.message:String(err);
      await supabase.from('solicitudes_registro_saas').update({ notificacion_admin_estado:'error', notificacion_admin_detalle:detalle }).eq('id', solicitud.id);
      return reply.status(502).send({ error:'No se pudo enviar el aviso al ROOT.', detalle });
    }
  });

  app.patch<{ Params: { id: string }; Body: { estado?: 'pendiente'|'en_revision'|'atendida'|'rechazada'; observacion?: string } }>('/proveedor/solicitudes-registro/:id', async (request, reply) => {
    const auth = await exigirProveedor(request, reply);
    if (!auth) return;
    const estado = request.body?.estado;
    if (!estado || !['pendiente','en_revision','atendida','rechazada'].includes(estado)) {
      return reply.status(400).send({ error: 'Estado de solicitud no válido.' });
    }
    const { data, error } = await supabase.from('solicitudes_registro_saas').update({
      estado, observacion: String(request.body?.observacion ?? '').trim() || null,
      revisado_at: new Date().toISOString(), revisado_por: auth.userId ?? null
    }).eq('id', request.params.id).select('*').single();
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(data);
  });

  app.post<{ Body: { ruc?: string; razonSocial?: string; nombreComercial?: string; direccionMatriz?: string; emailAdmin?: string; passwordTemporal?: string; planCodigo?: string; ambiente?: 'pruebas'|'produccion'; diasIniciales?: number; datosSri?: Record<string, unknown> } }>('/proveedor/clientes', async (request, reply) => {
    const proveedorAuth = await exigirProveedor(request, reply);
    if (!proveedorAuth) return;
    const b = request.body ?? {};
    const ruc = String(b.ruc ?? '').trim();
    const razonSocial = String(b.razonSocial ?? '').trim();
    const direccion = String(b.direccionMatriz ?? '').trim();
    const email = String(b.emailAdmin ?? '').trim().toLowerCase();
    if (!RUC_REGEX.test(ruc)) return reply.status(400).send({ error: 'El RUC debe tener 13 dígitos.' });
    if (!razonSocial || !direccion || !email) return reply.status(400).send({ error: 'RUC, razón social, dirección y correo son obligatorios.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply.status(400).send({ error: 'El correo del administrador no es válido.' });

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
    const planCode = String(b.planCodigo ?? 'BASICO_A_25').toUpperCase();
    const { data: plan } = await supabase.from('planes_suscripcion').select('id,codigo,nombre,precio_mensual,precio_anual,periodicidad').eq('codigo', planCode).eq('activo', true).maybeSingle();
    if (!plan) return reply.status(400).send({ error: `El plan ${planCode} no existe o está inactivo.` });
    let emisor: { id: string } | null = emisorReutilizado;
    if (emisor) {
      const { error: uErr } = await supabase.from('emisores').update({
        razon_social: razonSocial,
        nombre_comercial: String(b.nombreComercial ?? '').trim() || null,
        direccion_matriz: direccion,
        ambiente
      }).eq('id', emisor.id);
      if (uErr) return reply.status(500).send({ error: 'No se pudo reutilizar el RUC archivado.', detalle: uErr.message });
    } else {
      const { data: nuevoEmisor, error: eError } = await supabase.from('emisores').insert({ ruc, razon_social: razonSocial, nombre_comercial: String(b.nombreComercial ?? '').trim() || null, direccion_matriz: direccion, obligado_contabilidad: false, ambiente }).select('id').single();
      if (eError || !nuevoEmisor) return reply.status(500).send({ error: 'No se pudo crear la empresa.', detalle: eError?.message });
      emisor = nuevoEmisor;
    }
    if (!emisor) return reply.status(500).send({ error: 'No se pudo completar la creación o recuperación del RUC.' });

    const { error: estError } = await supabase.from('establecimientos_emisor').upsert({ emisor_id: emisor.id, codigo: '001', tipo_establecimiento: 'MATRIZ', nombre_comercial: String(b.nombreComercial ?? '').trim() || null, direccion, activo: true }, { onConflict: 'emisor_id,codigo' });
    if (estError) return reply.status(500).send({ error: 'No se pudo preparar la matriz 001.', detalle: estError.message });
    const { data: puntoExistente } = await supabase.from('puntos_emision').select('id').eq('emisor_id', emisor.id).eq('establecimiento','001').eq('punto_emision','001').maybeSingle();
    let punto: { id: string } | null = puntoExistente;
    if (punto) {
      const { error: pu } = await supabase.from('puntos_emision').update({ direccion, activo: true }).eq('id', punto.id);
      if (pu) return reply.status(500).send({ error: 'No se pudo reactivar el punto 001-001.', detalle: pu.message });
    } else {
      const { data: nuevoPunto, error: pError } = await supabase.from('puntos_emision').insert({ emisor_id: emisor.id, establecimiento: '001', punto_emision: '001', direccion, activo: true }).select('id').single();
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

    const dias = Math.max(1, Math.min(365, Number(b.diasIniciales ?? (plan.periodicidad === 'anual' ? 365 : 30))));
    const inicio = hoyEcuadorIso();
    const vencimiento = fechaMasDias(dias);
    const datosSri = (b.datosSri && typeof b.datosSri === 'object') ? b.datosSri : {};
    // Creación/reanudación robusta de la cuenta SaaS. Esta parte está diseñada
    // para recuperar altas que quedaron a medias (empresa + usuario creados)
    // sin duplicar cuentas ni perder el historial del RUC. También mantiene
    // compatibilidad con bases que todavía no tienen la columna datos_sri.
    let cuenta: any = null;
    let cuentaError: any = null;

    const { data: cuentaExistentePorUsuario, error: cuentaLookupError } = await supabase
      .from('cuentas_cliente_saas')
      .select('*')
      .eq('admin_user_id', userId)
      .maybeSingle();

    if (cuentaLookupError) {
      // Si la columna admin_user_id existe (v9.7+), este lookup debe funcionar.
      // En caso de una instalación antigua, continuamos con el alta normal y
      // dejamos el detalle disponible para diagnóstico.
      cuentaError = cuentaLookupError;
    } else if (cuentaExistentePorUsuario) {
      cuenta = cuentaExistentePorUsuario;
    }

    if (!cuenta) {
      const { data: cuentaExistentePorCorreo } = await supabase
        .from('cuentas_cliente_saas')
        .select('*')
        .eq('email_admin', email)
        .maybeSingle();
      if (cuentaExistentePorCorreo) cuenta = cuentaExistentePorCorreo;
    }

    if (cuenta) {
      // Reanuda una cuenta existente en lugar de generar otra.
      const actualizacionBase = {
        nombre: razonSocial,
        email_admin: email,
        admin_user_id: userId,
        plan_id: plan.id,
        estado: 'activa'
      };
      const actualizado = await supabase
        .from('cuentas_cliente_saas')
        .update(actualizacionBase)
        .eq('id', cuenta.id)
        .select('*')
        .single();
      cuenta = actualizado.data ?? cuenta;
      cuentaError = actualizado.error;

      // datos_sri es opcional para mantener compatibilidad con instalaciones
      // que aún no ejecutaron v9.8. Si existe, se actualiza; si no, no bloquea.
      if (!cuentaError) {
        const conDatos = await supabase.from('cuentas_cliente_saas')
          .update({ datos_sri: datosSri })
          .eq('id', cuenta.id);
        if (conDatos.error && !/datos_sri|column/i.test(conDatos.error.message)) cuentaError = conDatos.error;
      }
    } else {
      const altaBase = await supabase.from('cuentas_cliente_saas')
        .insert({ nombre: razonSocial, email_admin: email, admin_user_id: userId, plan_id: plan.id, estado: 'activa' })
        .select('*').single();
      cuenta = altaBase.data;
      cuentaError = altaBase.error;

      // Intento complementario para instalaciones con v9.8+. Nunca convierte
      // la ausencia de datos_sri en un bloqueo de todo el registro SaaS.
      if (cuenta && !cuentaError) {
        const conDatos = await supabase.from('cuentas_cliente_saas')
          .update({ datos_sri: datosSri })
          .eq('id', cuenta.id)
          .select('*').single();
        if (!conDatos.error) cuenta = conDatos.data ?? cuenta;
        else if (!/datos_sri|column/i.test(conDatos.error.message)) cuentaError = conDatos.error;
      }
    }

    if (cuentaError || !cuenta) {
      return reply.status(500).send({
        error: 'No se pudo completar la cuenta SaaS. La empresa y el usuario ya existen; puedes reintentar sin perder el RUC ni el historial.',
        emisorId: emisor.id,
        detalle: cuentaError?.message ?? 'No se obtuvo la cuenta SaaS.'
      });
    }
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
      const r = await supabase.from('suscripciones').update({ cuenta_id: cuenta.id, plan_id: plan.id, estado: 'activa', fecha_inicio: inicio, proximo_vencimiento: vencimiento, fecha_cancelacion: null, updated_at: new Date().toISOString() }).eq('id', subExistente.id).select('*').single();
      sub = r.data; sError = r.error;
    } else {
      const r = await supabase.from('suscripciones').insert({ emisor_id: emisor.id, cuenta_id: cuenta.id, plan_id: plan.id, estado: 'activa', fecha_inicio: inicio, proximo_vencimiento: vencimiento }).select('*').single();
      sub = r.data; sError = r.error;
    }
    if (sError || !sub) return reply.status(500).send({ error: 'La empresa y usuario quedaron creados, pero falló la suscripción.', emisorId: emisor.id, detalle: sError?.message });

    // Cada emisor nuevo recibe un motor tributario inicial con la tarifa general
    // vigente; el administrador puede cambiarla por fecha/reforma sin tocar código.
    await supabase.from('configuracion_iva').upsert({
      emisor_id: emisor.id, tarifa_general: 15, codigo_general: '4',
      tarifa_reducida: 5, codigo_reducida: '5', tarifa_turismo: 8, codigo_turismo: '8', activo: true
    }, { onConflict: 'emisor_id' });

    let correoEnviado = false;
    let correoError: string | null = null;
    try {
      await enviarComprobantePorCorreo({ to: email, subject: 'Acceso a CONTSERTRIB', html: `<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto"><h2>Bienvenido a CONTSERTRIB</h2><p>Su empresa <strong>${razonSocial.replace(/[<>]/g,'')}</strong> fue registrada.</p><p><strong>Acceso:</strong> <a href="${env.appUrl}/login">${env.appUrl}/login</a></p><p><strong>Usuario:</strong> ${email}</p><p><strong>Contraseña temporal:</strong> ${password}</p><p>Por seguridad, cambie esta contraseña después de ingresar.</p><p>Plan: ${plan.nombre}</p><p>Vigencia inicial: ${dias} días.</p></div>` });
      correoEnviado = true;
    } catch (err) { correoError = err instanceof Error ? err.message : String(err); }

    return reply.status(201).send({ ok: true, emisorId: emisor.id, puntoEmisionId: punto.id, userId, plan: { codigo: plan.codigo, nombre: plan.nombre, precioMensual: plan.precio_mensual, precioAnual: plan.precio_anual, periodicidad: plan.periodicidad }, fechaInicio: inicio, proximoVencimiento: vencimiento, correoEnviado, correoError, acceso: { url: `${env.appUrl}/login`, email, passwordTemporal: password } });
  });

  app.get<{ Params: { emisorId: string } }>('/proveedor/clientes/:emisorId/iva', async (request, reply) => {
    if (!await exigirProveedor(request, reply)) return;
    const { data, error } = await supabase.from('configuracion_iva').select('*').eq('emisor_id', request.params.emisorId).maybeSingle();
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(data ?? { tarifa_general:15, codigo_general:'4', tarifa_reducida:5, codigo_reducida:'5', tarifa_turismo:8, codigo_turismo:'8', activo:true });
  });

  app.patch<{ Params: { emisorId: string }; Body: { tarifaGeneral?: number; codigoGeneral?: string; tarifaReducida?: number; codigoReducida?: string; tarifaTurismo?: number; codigoTurismo?: string; turismoHabilitado?: boolean; registroTurismo?: string; luaf?: string } }>('/proveedor/clientes/:emisorId/iva', async (request, reply) => {
    if (!await exigirProveedor(request, reply)) return;
    const b=request.body??{};
    const valid=(v:any)=>Number.isFinite(Number(v))&&Number(v)>=0&&Number(v)<=100;
    for(const [k,v] of Object.entries({tarifaGeneral:b.tarifaGeneral,tarifaReducida:b.tarifaReducida,tarifaTurismo:b.tarifaTurismo})){
      if(v!==undefined&&!valid(v)) return reply.status(400).send({error:`${k} no es una tarifa válida.`});
    }
    const payload={
      emisor_id:request.params.emisorId,
      tarifa_general:b.tarifaGeneral===undefined?15:Number(b.tarifaGeneral),
      codigo_general:String(b.codigoGeneral??'4').trim(),
      tarifa_reducida:b.tarifaReducida===undefined?5:Number(b.tarifaReducida),
      codigo_reducida:String(b.codigoReducida??'5').trim(),
      tarifa_turismo:b.tarifaTurismo===undefined?8:Number(b.tarifaTurismo),
      codigo_turismo:String(b.codigoTurismo??'8').trim(),
      turismo_habilitado:b.turismoHabilitado===undefined ? undefined : Boolean(b.turismoHabilitado),
      registro_turismo:b.registroTurismo===undefined ? undefined : String(b.registroTurismo).trim() || null,
      luaf:b.luaf===undefined ? undefined : String(b.luaf).trim() || null,
      activo:true,
      actualizado_por:(await esProveedorAdmin(request)).userId ?? null
    };
    const {data,error}=await supabase.from('configuracion_iva').upsert(payload,{onConflict:'emisor_id'}).select('*').single();
    if(error)return reply.status(500).send({error:error.message});
    return reply.send({ok:true,configuracion:data});
  });

  app.patch<{ Params: { emisorId: string }; Body: { planCodigo?: string; dias?: number; nota?: string } }>('/proveedor/clientes/:emisorId/plan', async (request, reply) => {
    const proveedorAuth = await exigirProveedor(request, reply);
    if (!proveedorAuth) return;
    const planCodigo = String(request.body?.planCodigo ?? '').trim();
    if (!planCodigo) return reply.status(400).send({ error: 'Indica el código del nuevo plan.' });
    const { data: plan, error: pErr } = await supabase.from('planes_suscripcion')
      .select('id,codigo,nombre,precio_mensual,precio_anual,periodicidad,activo').eq('codigo', planCodigo).eq('activo', true).maybeSingle();
    if (pErr) return reply.status(500).send({ error: pErr.message });
    if (!plan) return reply.status(404).send({ error: 'El plan no existe o está inactivo.' });
    const { data: sub, error: sErr } = await supabase.from('suscripciones')
      .select('id,cuenta_id,estado,proximo_vencimiento').eq('emisor_id', request.params.emisorId).maybeSingle();
    if (sErr) return reply.status(500).send({ error: sErr.message });
    if (!sub) return reply.status(404).send({ error: 'El cliente no tiene una suscripción.' });
    const { error: uSub } = await supabase.from('suscripciones').update({
      plan_id: plan.id, updated_at: new Date().toISOString()
    }).eq('id', sub.id);
    if (uSub) return reply.status(500).send({ error: uSub.message });
    if (sub.cuenta_id) {
      const { error: uCuenta } = await supabase.from('cuentas_cliente_saas').update({ plan_id: plan.id, updated_at: new Date().toISOString() }).eq('id', sub.cuenta_id);
      if (uCuenta) return reply.status(500).send({ error: uCuenta.message });
    }
    await registrarAuditoriaSaas({userId:proveedorAuth.userId,emisorId:request.params.emisorId,evento:'SAAS_PLAN_CAMBIADO',recurso:'suscripcion',recursoId:sub.id,detalle:{planCodigo:plan.codigo}});
    return reply.send({ ok: true, plan, suscripcionId: sub.id, proximoVencimiento: sub.proximo_vencimiento });
  });

  app.patch<{ Params: { emisorId: string }; Body: { estado?: Estado; dias?: number; nota?: string } }>('/proveedor/clientes/:emisorId/suscripcion', async (request, reply) => {
    const proveedorAuth = await exigirProveedor(request, reply);
    if (!proveedorAuth) return;
    const b = request.body ?? {};
    if (b.estado && !ESTADOS.includes(b.estado)) return reply.status(400).send({ error: 'Estado de suscripción no válido.' });
    const cambios: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (b.estado) cambios.estado = b.estado;
    if (b.nota !== undefined) cambios.nota = String(b.nota).trim() || null;
    if (b.dias !== undefined) {
      const dias=Math.max(0, Math.min(3650, Number(b.dias)));
      // Activar 30 días no debe recortar una vigencia ya pagada.
      const { data: actual } = await supabase.from('suscripciones').select('proximo_vencimiento').eq('emisor_id', request.params.emisorId).maybeSingle();
      const nueva=fechaMasDias(dias);
      cambios.proximo_vencimiento = (actual?.proximo_vencimiento && actual.proximo_vencimiento > nueva) ? actual.proximo_vencimiento : nueva;
    }
    const { data, error } = await supabase.from('suscripciones').update(cambios).eq('emisor_id', request.params.emisorId).select('*').single();
    if (error) return reply.status(500).send({ error: error.message });
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

    // Todo pago comercial SaaS genera su comprobante. La factura se emite con
    // el RUC/proveedor central configurado y conserva el pago aunque el SRI
    // rechace temporalmente la emisión, para permitir reintento sin perder trazabilidad.
    const factura = await facturarPagoSaas(pago.id);
    return reply.send({ ok: true, pago, suscripcion: actualizada, factura });
  });

  app.get<{ Params: { emisorId: string } }>('/proveedor/clientes/:emisorId/facturas-saas', async (request, reply) => {
    if (!await exigirProveedor(request, reply)) return;
    const { data, error } = await supabase.from('facturas_saas').select('*,pagos_suscripcion(fecha_pago,monto,periodo_desde,periodo_hasta,metodo),comprobantes(secuencial,clave_acceso,numero_autorizacion,estado)').eq('cliente_emisor_id', request.params.emisorId).order('created_at',{ascending:false}).limit(100);
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(data ?? []);
  });

  app.post<{ Params: { pagoId: string } }>('/proveedor/pagos/:pagoId/facturar', async (request, reply) => {
    if (!await exigirProveedor(request, reply)) return;
    const factura = await facturarPagoSaas(request.params.pagoId);
    return reply.send(factura);
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
    const proveedorAuth = await exigirProveedor(request, reply);
    if (!proveedorAuth) return;
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
    await registrarAuditoriaSaas({userId:proveedorAuth.userId,emisorId:emisor.id,evento:'SAAS_CLIENTE_CREADO',recurso:'emisor',recursoId:emisor.id,detalle:{ruc,planId:cuentaPlan?.plan_id ?? null,emailAdmin:email}});
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


  // Catálogo público de planes: solo expone información comercial, nunca datos de clientes.
  app.get('/planes-publicos', async (_request, reply) => {
    const { data, error } = await supabase.from('planes_suscripcion')
      .select('codigo,nombre,descripcion,precio_mensual,precio_anual,periodicidad,orden,max_documentos_mes,max_documentos_anio,max_contribuyentes,max_establecimientos,max_puntos_emision,max_usuarios,incluye_inventario,incluye_ats,incluye_carga_electronica,incluye_reportes_avanzados,descripcion_comercial')
      .eq('activo', true).order('orden');
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(data ?? []);
  });

}
