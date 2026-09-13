import { supabase } from '../db/supabase.js';
import { env } from '../config/env.js';
import { enviarComprobantePorCorreo } from './email.js';

function esc(v: unknown): string {
  return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

/** Obtiene los destinatarios ROOT configurados en la base; si aún no existen, usa PROVEEDOR_ADMIN_EMAILS. */
export async function obtenerEmailsAdminSaas(): Promise<string[]> {
  try {
    const { data, error } = await supabase.from('configuracion_proveedor').select('admin_emails').eq('id', 1).maybeSingle();
    if (!error && Array.isArray(data?.admin_emails) && data.admin_emails.length) {
      return data.admin_emails.map((x: unknown) => String(x).trim().toLowerCase()).filter(Boolean);
    }
  } catch { /* fallback a variables de entorno */ }
  return (env.proveedorAdminEmails ?? '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
}

export async function notificarNuevaSolicitudSaas(solicitud: {
  id: string; ruc: string; razonSocial: string; nombreComercial?: string | null;
  email: string; direccionMatriz: string; planCodigo: string; ambiente: string; creadoAt?: string;
}) {
  const destinatarios = await obtenerEmailsAdminSaas();
  if (!destinatarios.length) throw new Error('No hay correos ROOT configurados para recibir solicitudes SaaS.');
  const panelUrl = `${env.appUrl.replace(/\/$/,'')}/admin-proveedor`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:680px;margin:auto;color:#172033">`+
    `<div style="background:#0f2747;color:#fff;padding:20px;border-radius:14px 14px 0 0"><h2 style="margin:0">🔔 Nueva solicitud de CONTSERTRIB</h2><p style="margin:6px 0 0">Requiere revisión del administrador ROOT.</p></div>`+
    `<div style="border:1px solid #e5e7eb;border-top:0;padding:20px;border-radius:0 0 14px 14px">`+
    `<p>Una persona ha solicitado el servicio desde el registro público.</p>`+
    `<table style="width:100%;border-collapse:collapse">`+
    `<tr><td style="padding:7px;font-weight:bold">RUC</td><td style="padding:7px">${esc(solicitud.ruc)}</td></tr>`+
    `<tr><td style="padding:7px;font-weight:bold">Razón social</td><td style="padding:7px">${esc(solicitud.razonSocial)}</td></tr>`+
    `<tr><td style="padding:7px;font-weight:bold">Nombre comercial</td><td style="padding:7px">${esc(solicitud.nombreComercial || '—')}</td></tr>`+
    `<tr><td style="padding:7px;font-weight:bold">Correo</td><td style="padding:7px">${esc(solicitud.email)}</td></tr>`+
    `<tr><td style="padding:7px;font-weight:bold">Plan solicitado</td><td style="padding:7px">${esc(solicitud.planCodigo)}</td></tr>`+
    `<tr><td style="padding:7px;font-weight:bold">Ambiente inicial</td><td style="padding:7px">${esc(solicitud.ambiente)}</td></tr>`+
    `</table><p style="margin-top:22px"><a href="${esc(panelUrl)}" style="display:inline-block;background:#0f2747;color:#fff;text-decoration:none;padding:12px 18px;border-radius:9px;font-weight:bold">Ver solicitud en Panel ROOT</a></p>`+
    `<p style="font-size:12px;color:#64748b">La solicitud no crea acceso ni activa una empresa automáticamente.</p></div></div>`;
  const resultados: unknown[] = [];
  for (const to of destinatarios) {
    resultados.push(await enviarComprobantePorCorreo({ to, subject: `🔔 Nueva solicitud CONTSERTRIB · ${solicitud.ruc}`, html }));
  }
  return { destinatarios, resultados };
}
