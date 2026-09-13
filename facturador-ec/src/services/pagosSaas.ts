import { randomBytes } from 'node:crypto';
import { supabase } from '../db/supabase.js';
import { env } from '../config/env.js';
import { enviarComprobantePorCorreo } from './email.js';
import { obtenerEmailsAdminSaas } from './notificacionesSaas.js';

function esc(v: unknown): string { return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function txId(): string { return ('CT' + Date.now().toString(36) + randomBytes(3).toString('hex')).toUpperCase().slice(-15); }

export function payphoneConfigurado(): boolean { return Boolean(env.payphoneToken && env.payphoneStoreId); }

export async function crearLinkPagoSaas(solicitudId: string, regenerar = false) {
  const { data: solicitud, error: se } = await supabase.from('solicitudes_registro_saas').select('*').eq('id', solicitudId).maybeSingle();
  if (se || !solicitud) throw new Error('Solicitud SaaS no encontrada.');
  const { data: plan, error: pe } = await supabase.from('planes_suscripcion').select('id,codigo,nombre,precio_mensual,precio_anual,periodicidad').eq('codigo', solicitud.plan_codigo).eq('activo', true).maybeSingle();
  if (pe || !plan) throw new Error('El plan solicitado no existe o está inactivo.');
  const monto = Number(plan.periodicidad === 'anual' ? plan.precio_anual : plan.precio_mensual);
  if (!Number.isFinite(monto) || monto <= 0) throw new Error('El plan no tiene un precio válido para generar el cobro.');
  if (!payphoneConfigurado()) throw new Error('El pago en línea no está configurado: faltan PAYPHONE_TOKEN y PAYPHONE_STORE_ID en Railway.');

  const { data: previo } = await supabase.from('pagos_solicitud_saas').select('*').eq('solicitud_id', solicitudId).in('estado',['pendiente_pago','link_generado','pagado']).maybeSingle();
  if (previo?.estado === 'pagado') return previo;
  if (previo?.payment_link && !regenerar) return previo;
  if (previo?.id && regenerar) { await supabase.from('pagos_solicitud_saas').update({estado:'expirado',updated_at:new Date().toISOString()}).eq('id',previo.id); }

  const clientTransactionId = txId();
  const body = {
    amount: Math.round(monto * 100),
    amountWithoutTax: Math.round(monto * 100),
    amountWithTax: 0,
    tax: 0,
    service: 0,
    tip: 0,
    currency: 'USD',
    reference: `CONTSERTRIB ${plan.codigo}`.slice(0,100),
    clientTransactionId,
    storeId: env.payphoneStoreId,
    additionalData: `RUC ${solicitud.ruc} · ${plan.nombre}`.slice(0,250),
    oneTime: true,
    expireIn: env.payphoneLinkExpireHours,
    isAmountEditable: false,
  };
  const response = await fetch('https://pay.payphonetodoesposible.com/api/Links', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.payphoneToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const raw = await response.text();
  let parsed: unknown = raw; try { parsed = JSON.parse(raw); } catch {}
  if (!response.ok || typeof parsed !== 'string' || !parsed.startsWith('http')) {
    throw new Error(`Payphone no pudo generar el link: ${typeof parsed === 'string' ? parsed : JSON.stringify(parsed)}`);
  }
  const paymentLink = parsed;
  const payload = { solicitud_id: solicitudId, plan_id: plan.id, monto, moneda:'USD', proveedor:'payphone', estado:'link_generado', client_transaction_id:clientTransactionId, payment_link:paymentLink, referencia:`CONTSERTRIB ${plan.codigo}`, respuesta_proveedor:{created:true}, updated_at:new Date().toISOString() };
  const { data: pago, error } = await supabase.from('pagos_solicitud_saas').upsert(payload,{onConflict:'client_transaction_id'}).select('*').single();
  if (error || !pago) throw new Error(`No se pudo guardar el cobro: ${error?.message ?? 'sin respuesta'}`);
  await supabase.from('solicitudes_registro_saas').update({ pago_id:pago.id, pago_estado:'link_generado', pago_link:paymentLink, pago_monto:monto }).eq('id',solicitudId);
  await enviarLinkPagoCliente({ solicitud, plan, pago });
  return pago;
}

async function enviarLinkPagoCliente({solicitud,plan,pago}:{solicitud:any;plan:any;pago:any}) {
  const html = `<div style="font-family:Arial,sans-serif;max-width:680px;margin:auto;color:#172033"><div style="background:#0f2747;color:#fff;padding:22px;border-radius:14px 14px 0 0"><h2 style="margin:0">Tu solicitud CONTSERTRIB está lista para pago</h2></div><div style="border:1px solid #e5e7eb;border-top:0;padding:22px;border-radius:0 0 14px 14px"><p>Hola, <b>${esc(solicitud.razon_social)}</b>.</p><p>Seleccionaste el plan <b>${esc(plan.nombre)}</b> (${esc(plan.codigo)}).</p><p style="font-size:18px">Total a pagar: <b>$${Number(pago.monto).toFixed(2)} USD</b></p><p><a href="${esc(pago.payment_link)}" style="display:inline-block;background:#0f2747;color:#fff;text-decoration:none;padding:14px 22px;border-radius:10px;font-weight:800">💳 PAGAR AHORA</a></p><p style="font-size:13px;color:#64748b">El enlace es único para esta solicitud. Una vez aprobado el pago, CONTSERTRIB recibirá una notificación y el administrador ROOT realizará la activación.</p><p style="font-size:12px;color:#64748b">RUC: ${esc(solicitud.ruc)} · Referencia: ${esc(pago.client_transaction_id)}</p></div></div>`;
  try { await enviarComprobantePorCorreo({to:solicitud.email,subject:`💳 Pago de tu plan CONTSERTRIB · ${plan.nombre}`,html}); await supabase.from('pagos_solicitud_saas').update({notificacion_cliente_estado:'enviado'}).eq('id',pago.id); }
  catch (err) { await supabase.from('pagos_solicitud_saas').update({notificacion_cliente_estado:'error',respuesta_proveedor:{correo_error:String(err)}}).eq('id',pago.id); throw err; }
}

export async function procesarNotificacionPayphone(body:any) {
  const tx = String(body?.ClientTransactionId ?? body?.clientTransactionId ?? '').trim();
  const store = String(body?.StoreId ?? body?.storeId ?? '').trim();
  if (!tx) throw new Error('Notificación Payphone sin ClientTransactionId.');
  if (!store) throw new Error('Notificación Payphone sin StoreId.');
  if (env.payphoneStoreId && store !== env.payphoneStoreId) throw new Error('StoreId Payphone no corresponde a CONTSERTRIB.');
  const { data:pago, error } = await supabase.from('pagos_solicitud_saas').select('*,solicitudes_registro_saas(*)').eq('client_transaction_id',tx).maybeSingle();
  if (error || !pago) throw new Error('Cobro Payphone no encontrado para la referencia recibida.');
  const status = String(body?.TransactionStatus ?? body?.transactionStatus ?? '').toLowerCase();
  const approved = status === 'approved' || Number(body?.StatusCode ?? body?.statusCode) === 3;
  const montoRecibido = Number(body?.Amount ?? body?.amount ?? 0) / 100;
  if (approved && Math.abs(montoRecibido - Number(pago.monto)) > 0.01) throw new Error('El monto notificado por Payphone no coincide con el cobro de la solicitud.');
  if (pago.estado === 'pagado') return {ok:true,duplicado:true,pago};
  const nuevoEstado = approved ? 'pagado' : 'rechazado';
  const { data: actualizado, error: ue } = await supabase.from('pagos_solicitud_saas').update({ estado:nuevoEstado, payment_id:String(body?.PaymentId??body?.paymentId??'')||null, transaction_id:String(body?.TransactionId??body?.transactionId??'')||null, authorization_code:String(body?.AuthorizationCode??body?.authorizationCode??'')||null, transaction_status:String(body?.TransactionStatus??body?.transactionStatus??'')||null, metodo_pago:String(body?.CardType??body?.cardType??'')||null, respuesta_proveedor:body, pagado_at:approved?new Date().toISOString():null, updated_at:new Date().toISOString(), notificacion_admin_estado:approved?'pendiente': 'no_aplica' }).eq('id',pago.id).select('*').single();
  if (ue || !actualizado) throw new Error(`No se pudo actualizar el pago: ${ue?.message??'sin respuesta'}`);
  await supabase.from('solicitudes_registro_saas').update({pago_estado:nuevoEstado,pago_notificado_at:approved?new Date().toISOString():null}).eq('id',pago.solicitud_id);
  if (approved) await notificarPagoAroot(actualizado, pago.solicitudes_registro_saas);
  return {ok:true,pago:actualizado};
}

async function notificarPagoAroot(pago:any, solicitud:any) {
  const destinatarios = await obtenerEmailsAdminSaas();
  if (!destinatarios.length) throw new Error('Pago aprobado pero no hay correos ROOT configurados.');
  const panelUrl = `${env.appUrl.replace(/\/$/,'')}/admin-proveedor`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:680px;margin:auto;color:#172033"><div style="background:#166534;color:#fff;padding:22px;border-radius:14px 14px 0 0"><h2 style="margin:0">💰 Pago SaaS aprobado</h2><p style="margin:6px 0 0">Requiere activación manual de ROOT.</p></div><div style="border:1px solid #e5e7eb;border-top:0;padding:22px;border-radius:0 0 14px 14px"><table style="width:100%;border-collapse:collapse"><tr><td><b>RUC</b></td><td>${esc(solicitud.ruc)}</td></tr><tr><td><b>Empresa</b></td><td>${esc(solicitud.razon_social)}</td></tr><tr><td><b>Correo</b></td><td>${esc(solicitud.email)}</td></tr><tr><td><b>Plan</b></td><td>${esc(solicitud.plan_codigo)}</td></tr><tr><td><b>Monto</b></td><td>$${Number(pago.monto).toFixed(2)} USD</td></tr><tr><td><b>Referencia</b></td><td>${esc(pago.client_transaction_id)}</td></tr></table><p style="margin-top:22px"><a href="${esc(panelUrl)}" style="display:inline-block;background:#166534;color:#fff;text-decoration:none;padding:13px 20px;border-radius:9px;font-weight:800">ABRIR PANEL ROOT Y ACTIVAR</a></p><p style="font-size:12px;color:#64748b">El sistema NO activa automáticamente la cuenta. La activación queda bajo control de ROOT.</p></div></div>`;
  for (const to of destinatarios) await enviarComprobantePorCorreo({to,subject:`💰 Pago aprobado · ${solicitud.ruc} · CONTSERTRIB`,html});
  await supabase.from('pagos_solicitud_saas').update({notificacion_admin_estado:'enviado'}).eq('id',pago.id);
}
