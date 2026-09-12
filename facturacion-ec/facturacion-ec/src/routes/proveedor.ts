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
    if (b.activo !== undefined) cambios.activo = Boolean(b.activo);
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

  // Catálogo público de planes: solo expone información comercial, nunca datos de clientes.
  app.get('/planes-publicos', async (request, reply) => {
    const { data, error } = await supabase.from('planes_suscripcion')
      .select('codigo,nombre,descripcion,precio_mensual,precio_anual,periodicidad,orden,max_documentos_mes,max_documentos_anio,max_contribuyentes,max_establecimientos,max_puntos_emision,max_usuarios,incluye_inventario,incluye_ats,incluye_carga_electronica,incluye_reportes_avanzados,descripcion_comercial')
      .eq('activo', true).order('orden');
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(data ?? []);
  });

 