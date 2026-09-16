import { randomBytes } from 'node:crypto';
import { supabase } from '../db/supabase.js';
import { env } from '../config/env.js';
import { enviarComprobantePorCorreo } from './email.js';
import { obtenerEmailsAdminSaas } from './notificacionesSaas.js';
import { crearOEncontrarUsuario, agregarUsuarioANegocio } from '../auth/sesiones.js';
import { fechaIsoEcuador } from '../utils/fechaEcuador.js';

function esc(v: unknown): string { return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function txId(): string { return ('CT' + Date.now().toString(36) + randomBytes(3).toString('hex')).toUpperCase().slice(-15); }

export function payphoneConfigurado(): boolean { return Boolean(env.payphoneToken && env.payphoneStoreId); }
export const PAYPHONE_CONFIRM_TIMEOUT_MS = 10_000;

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
  // Si ya existe un link, nunca generamos otro innecesariamente: reintentamos
  // únicamente la notificación al cliente si el correo anterior falló o quedó pendiente.
  if (previo?.payment_link && !regenerar) {
    if (previo.notificacion_cliente_estado !== 'enviado') {
      try { await enviarLinkPagoCliente({ solicitud, plan, pago: previo }); }
      catch (err) {
        await supabase.from('pagos_solicitud_saas').update({
          notificacion_cliente_estado:'error',
          respuesta_proveedor:{...(previo.respuesta_proveedor || {}), correo_error:String(err), correo_error_at:new Date().toISOString()},
          updated_at:new Date().toISOString()
        }).eq('id',previo.id);
      }
    }
    return previo;
  }
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
    const detalle = typeof parsed === 'string' ? parsed : JSON.stringify(parsed);
    const error = new Error(`Payphone no pudo generar el link (HTTP ${response.status}): ${detalle}`);
    await supabase.from('solicitudes_registro_saas').update({
      pago_estado:'error',
      notificacion_admin_estado:'error',
      notificacion_admin_detalle:`PayPhone: ${error.message}`
    }).eq('id',solicitudId);
    throw error;
  }
  const paymentLink = parsed;
  const payload = { solicitud_id: solicitudId, plan_id: plan.id, monto, moneda:'USD', proveedor:'payphone', estado:'link_generado', client_transaction_id:clientTransactionId, payment_link:paymentLink, referencia:`CONTSERTRIB ${plan.codigo}`, respuesta_proveedor:{created:true}, updated_at:new Date().toISOString() };
  const { data: pago, error } = await supabase.from('pagos_solicitud_saas').upsert(payload,{onConflict:'client_transaction_id'}).select('*').single();
  if (error || !pago) throw new Error(`No se pudo guardar el cobro: ${error?.message ?? 'sin respuesta'}`);
  await supabase.from('solicitudes_registro_saas').update({ pago_id:pago.id, pago_estado:'link_generado', pago_link:paymentLink, pago_monto:monto }).eq('id',solicitudId);
  try {
    await enviarLinkPagoCliente({ solicitud, plan, pago });
  } catch (err) {
    // El enlace ya está generado y guardado. Un fallo de correo jamás debe
    // borrar ni invalidar el cobro; ROOT podrá reenviarlo desde el Panel Maestro.
    await supabase.from('pagos_solicitud_saas').update({
      notificacion_cliente_estado:'error',
      respuesta_proveedor:{...(pago.respuesta_proveedor || {}), correo_error:String(err), correo_error_at:new Date().toISOString()},
      updated_at:new Date().toISOString()
    }).eq('id',pago.id);
    pago.notificacion_cliente_estado='error';
    pago.respuesta_proveedor={...(pago.respuesta_proveedor || {}), correo_error:String(err)};
  }
  return pago;
}

async function enviarLinkPagoCliente({solicitud,plan,pago}:{solicitud:any;plan:any;pago:any}) {
  const html = `<div style="font-family:Arial,sans-serif;max-width:680px;margin:auto;color:#172033"><div style="background:#0f2747;color:#fff;padding:22px;border-radius:14px 14px 0 0"><h2 style="margin:0">Tu solicitud CONTSERTRIB está lista para pago</h2></div><div style="border:1px solid #e5e7eb;border-top:0;padding:22px;border-radius:0 0 14px 14px"><p>Hola, <b>${esc(solicitud.razon_social)}</b>.</p><p>Seleccionaste el plan <b>${esc(plan.nombre)}</b> (${esc(plan.codigo)}).</p><p style="font-size:18px">Total a pagar: <b>$${Number(pago.monto).toFixed(2)} USD</b></p><p><a href="${esc(pago.payment_link)}" style="display:inline-block;background:#0f2747;color:#fff;text-decoration:none;padding:14px 22px;border-radius:10px;font-weight:800">💳 PAGAR AHORA</a></p><p style="font-size:13px;color:#64748b">El enlace es único para esta solicitud. Una vez aprobado el pago, PayPhone notificará a CONTSERTRIB y tu plan se activará automáticamente después de validar la transacción.</p><p style="font-size:12px;color:#64748b">RUC: ${esc(solicitud.ruc)} · Referencia: ${esc(pago.client_transaction_id)}</p></div></div>`;
  try { await enviarComprobantePorCorreo({to:solicitud.email,subject:`💳 Pago de tu plan CONTSERTRIB · ${plan.nombre}`,html}); await supabase.from('pagos_solicitud_saas').update({notificacion_cliente_estado:'enviado'}).eq('id',pago.id); }
  catch (err) { await supabase.from('pagos_solicitud_saas').update({notificacion_cliente_estado:'error',respuesta_proveedor:{correo_error:String(err)}}).eq('id',pago.id); throw err; }
}

export function estadoPayphone() {
  return {
    configured: payphoneConfigurado(),
    tokenConfigured: Boolean(env.payphoneToken),
    storeIdConfigured: Boolean(env.payphoneStoreId),
    webhookPath: '/pagos/payphone/NotificacionPago',
    linkExpireHours: env.payphoneLinkExpireHours
  };
}

export async function consultarTransaccionPayphone(clientTransactionId:string, transactionId?:string, fetchImpl:typeof fetch = fetch, timeoutMs=PAYPHONE_CONFIRM_TIMEOUT_MS): Promise<any> {
  if (!payphoneConfigurado()) throw new Error('PayPhone no está configurado para verificar la transacción.');
  const identificador = transactionId && /^\d+$/.test(transactionId)
    ? encodeURIComponent(transactionId)
    : `client/${encodeURIComponent(clientTransactionId)}`;
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`https://pay.payphonetodoesposible.com/api/Sale/${identificador}`, {
      method:'GET', signal:controller.signal,
      headers:{Authorization:`Bearer ${env.payphoneToken}`,'Content-Type':'application/json'},
    });
    const raw = await response.text();
    if (!response.ok) throw new Error(`PayPhone no pudo confirmar la transacción (HTTP ${response.status}).`);
    try { return raw ? JSON.parse(raw) : {}; }
    catch { throw new Error('PayPhone devolvió una respuesta JSON inválida.'); }
  } catch (error) {
    if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) throw new Error('PayPhone no respondió dentro del tiempo permitido.');
    throw error;
  } finally { clearTimeout(timer); }
}

export function validarConfirmacionPayphone(confirmacion:any, esperado:{clientTransactionId:string;monto:number;transactionId?:string}): void {
  const tx=String(confirmacion?.clientTransactionId??confirmacion?.ClientTransactionId??'').trim();
  const id=String(confirmacion?.transactionId??confirmacion?.TransactionId??'').trim();
  const estado=String(confirmacion?.transactionStatus??confirmacion?.TransactionStatus??'').trim().toLowerCase();
  const codigo=Number(confirmacion?.statusCode??confirmacion?.StatusCode);
  const moneda=String(confirmacion?.currency??confirmacion?.Currency??'').trim().toUpperCase();
  const monto=Number(confirmacion?.amount??confirmacion?.Amount??NaN)/100;
  if (tx!==esperado.clientTransactionId) throw new Error('PayPhone confirmó una referencia diferente.');
  if (esperado.transactionId && id!==esperado.transactionId) throw new Error('PayPhone confirmó un TransactionId diferente.');
  if (estado!=='approved'||codigo!==3) throw new Error('PayPhone no confirmó la transacción como aprobada.');
  if (!id) throw new Error('PayPhone confirmó la operación sin TransactionId.');
  if (moneda!=='USD') throw new Error(`Moneda PayPhone no válida: ${moneda||'(vacía)'}.`);
  if (!Number.isFinite(monto)||Math.abs(monto-esperado.monto)>0.01) throw new Error('El monto confirmado por PayPhone no coincide con el cobro registrado.');
}

async function reclamarActivacion(pago:any): Promise<any|null> {
  if (!pago?.id || !pago?.updated_at || pago.activacion_at) return null;
  const ahora=new Date().toISOString();
  const { data, error }=await supabase.from('pagos_solicitud_saas').update({activacion_detalle:{estado:'procesando',iniciada_at:ahora},updated_at:ahora})
    .eq('id',pago.id).eq('updated_at',pago.updated_at).is('activacion_at',null).select('*').maybeSingle();
  if (error) throw new Error(`No se pudo reservar la activación: ${error.message}`);
  return data??null;
}

export async function procesarNotificacionPayphone(body:any) {
  const tx = String(body?.ClientTransactionId ?? body?.clientTransactionId ?? '').trim();
  const store = String(body?.StoreId ?? body?.storeId ?? '').trim();
  const transactionId = String(body?.TransactionId ?? body?.transactionId ?? '').trim();
  const authorizationCode = String(body?.AuthorizationCode ?? body?.authorizationCode ?? '').trim();
  const currency = String(body?.Currency ?? body?.currency ?? '').trim().toUpperCase();
  const status = String(body?.TransactionStatus ?? body?.transactionStatus ?? '').trim().toLowerCase();
  const statusCode = Number(body?.StatusCode ?? body?.statusCode);
  if (!tx) throw new Error('Notificación Payphone sin ClientTransactionId.');
  if (!store) throw new Error('Notificación Payphone sin StoreId.');
  if (env.payphoneStoreId && store !== env.payphoneStoreId) throw new Error('StoreId Payphone no corresponde a CONTSERTRIB.');
  if (currency && currency !== 'USD') throw new Error(`Moneda Payphone no válida: ${currency}.`);
  let approved = status === 'approved' && statusCode === 3;
  if (approved && statusCode !== 3) throw new Error('La transacción indica Approved pero StatusCode no es 3.');
  if (approved && !transactionId) throw new Error('Pago aprobado sin TransactionId.');
  if (approved && !authorizationCode) throw new Error('Pago aprobado sin AuthorizationCode.');

  const { data:pago, error } = await supabase.from('pagos_solicitud_saas')
    .select('*,solicitudes_registro_saas(*)').eq('client_transaction_id',tx).maybeSingle();
  if (error || !pago) throw new Error('Cobro Payphone no encontrado para la referencia recibida.');

  // La notificación solo aporta identificadores. La fuente de verdad es esta
  // consulta autenticada servidor-a-servidor con el token del comercio.
  const confirmacion = await consultarTransaccionPayphone(tx, transactionId);
  validarConfirmacionPayphone(confirmacion,{clientTransactionId:tx,monto:Number(pago.monto),transactionId:transactionId||undefined});
  body=confirmacion;
  approved=true;
  const transactionIdConfirmado=String(body?.transactionId??body?.TransactionId??'').trim();
  const authorizationCodeConfirmado=String(body?.authorizationCode??body?.AuthorizationCode??'').trim();
  if (!authorizationCodeConfirmado) throw new Error('PayPhone confirmó el pago sin AuthorizationCode.');

  // Idempotencia: si el pago ya está pagado pero la activación quedó pendiente,
  // reintentamos la activación. Nunca cobramos dos veces ni duplicamos la cuenta.
  if (pago.estado === 'pagado') {
    if (pago.activacion_at) return {ok:true,duplicado:true,pago};
    const solicitudPagada = pago.solicitudes_registro_saas;
    if (!solicitudPagada) throw new Error('Pago aprobado sin solicitud SaaS asociada.');
    const reclamado=await reclamarActivacion(pago);
    if (!reclamado) return {ok:true,duplicado:true,activacionEnProceso:true,pago};
    const activacion = await activarPlanPagado(reclamado, solicitudPagada);
    await supabase.from('pagos_solicitud_saas').update({
      activacion_at:new Date().toISOString(),
      activacion_detalle:{...activacion, reintento:true},
      notificacion_admin_estado:'pendiente',
      updated_at:new Date().toISOString()
    }).eq('id',pago.id);
    try { await notificarPagoAroot(pago, solicitudPagada, activacion); } catch {}
    return {ok:true,duplicado:true,reintentoActivacion:true,pago,activacion};
  }

  const montoRecibido = Number(body?.Amount ?? body?.amount ?? NaN) / 100;
  if (approved && (!Number.isFinite(montoRecibido) || montoRecibido <= 0)) throw new Error('Payphone notificó un monto inválido.');
  if (approved && Math.abs(montoRecibido - Number(pago.monto)) > 0.01) throw new Error(`El monto notificado por Payphone (${montoRecibido.toFixed(2)}) no coincide con el cobro (${Number(pago.monto).toFixed(2)}).`);

  const nuevoEstado = approved ? 'pagado' : 'rechazado';
  const { data: actualizado, error: ue } = await supabase.from('pagos_solicitud_saas').update({
    estado:nuevoEstado,
    payment_id:String(body?.PaymentId??body?.paymentId??'')||null,
    transaction_id:transactionIdConfirmado||null,
    authorization_code:authorizationCodeConfirmado||null,
    transaction_status:String(body?.TransactionStatus??body?.transactionStatus??'')||null,
    metodo_pago:String(body?.CardType??body?.cardType??'')||null,
    respuesta_proveedor:body,
    pagado_at:approved?new Date().toISOString():null,
    updated_at:new Date().toISOString(),
    notificacion_admin_estado:approved?'pendiente':'no_aplica'
  }).eq('id',pago.id).eq('estado','link_generado').select('*').single();
  if (ue || !actualizado) {
    // Si otra entrega concurrente ya cambió el estado, tratarla como duplicada.
    const { data: estadoActual } = await supabase.from('pagos_solicitud_saas').select('*').eq('id',pago.id).maybeSingle();
    if (estadoActual?.estado === 'pagado') return {ok:true,duplicado:true,pago:estadoActual};
    throw new Error(`No se pudo actualizar el pago: ${ue?.message??'sin respuesta'}`);
  }
  await supabase.from('solicitudes_registro_saas').update({pago_estado:nuevoEstado,pago_notificado_at:approved?new Date().toISOString():null}).eq('id',pago.solicitud_id);

  if (approved) {
    // La activación es parte del procesamiento del pago, no una tarea manual de ROOT.
    // Si la activación falla, conservamos el pago aprobado y dejamos activacion_at nulo
    // para que una nueva notificación o un reintento controlado pueda completar el proceso.
    try {
      const activacion = await activarPlanPagado(actualizado, pago.solicitudes_registro_saas);
      await supabase.from('pagos_solicitud_saas').update({
        respuesta_proveedor: { ...body, contsertrib: { activado:true, activacion } },
        activacion_at:new Date().toISOString(),
        activacion_detalle:activacion,
        updated_at:new Date().toISOString(),
        notificacion_admin_estado:'pendiente'
      }).eq('id',pago.id);
      try { await notificarPagoAroot(actualizado, pago.solicitudes_registro_saas, activacion); } catch (err) {
        await supabase.from('pagos_solicitud_saas').update({
          notificacion_admin_estado:'error',
          activacion_detalle:{...activacion, avisoRootError:String(err)},
          updated_at:new Date().toISOString()
        }).eq('id',pago.id);
      }
      return {ok:true,pago:actualizado,activacion};
    } catch (err) {
      const detalle = { error:String(err), etapa:'activacion', fecha:new Date().toISOString() };
      await supabase.from('pagos_solicitud_saas').update({
        activacion_at:null, activacion_detalle:detalle, notificacion_admin_estado:'error',
        respuesta_proveedor:{...body, contsertrib:{activado:false,error:String(err)}}, updated_at:new Date().toISOString()
      }).eq('id',pago.id);
      try { await supabase.from('solicitudes_registro_saas').update({pago_estado:'pagado', pago_notificado_at:new Date().toISOString()}).eq('id',pago.solicitud_id); } catch {}
      throw err;
    }
  }
  return {ok:true,pago:actualizado};
}

function fechaMasDias(dias:number): string {
  const [y,m,d] = fechaIsoEcuador().split('-').map(Number);
  return new Date(Date.UTC(y,m-1,d+dias,12,0,0)).toISOString().slice(0,10);
}

async function activarPlanPagado(pago:any, solicitud:any) {
  const ruc = String(solicitud?.ruc ?? '').replace(/\D/g,'');
  const email = String(solicitud?.email ?? '').trim().toLowerCase();
  const razonSocial = String(solicitud?.razon_social ?? '').trim();
  const planCodigo = String(solicitud?.plan_codigo ?? '').trim().toUpperCase();
  const direccion = String(solicitud?.direccion_matriz ?? '').trim();
  if (!/^\d{13}$/.test(ruc)) throw new Error('La solicitud pagada tiene un RUC inválido; no se activó el plan.');
  if (!email || !razonSocial) throw new Error('La solicitud pagada no tiene correo o razón social; no se activó el plan.');
  if (!direccion) throw new Error('La solicitud pagada no tiene dirección matriz; no se activó el plan.');

  const { data: plan, error: pe } = await supabase.from('planes_suscripcion').select('id,codigo,nombre,periodicidad').eq('codigo',planCodigo).eq('activo',true).maybeSingle();
  if (pe || !plan) throw new Error('El plan pagado ya no existe o está inactivo.');
  const { data: emisor, error: ee } = await supabase.from('emisores').select('id').eq('ruc',ruc).maybeSingle();
  if (ee) throw new Error(`No se pudo consultar el emisor: ${ee.message}`);
  let emisorId = emisor?.id as string | undefined;
  if (!emisorId) {
    const ins = await supabase.from('emisores').insert({ruc,razon_social:razonSocial,nombre_comercial:solicitud?.nombre_comercial??null,direccion_matriz:direccion,obligado_contabilidad:false,ambiente:solicitud?.ambiente==='pruebas'?'pruebas':'produccion'}).select('id').single();
    if (ins.error || !ins.data) throw new Error(`No se pudo crear el emisor pagado: ${ins.error?.message??'sin respuesta'}`);
    emisorId = ins.data.id;
  }
  if (!emisorId) throw new Error('No se pudo determinar el emisor.');

  const dir = direccion;
  await supabase.from('emisores').update({razon_social:razonSocial,nombre_comercial:solicitud?.nombre_comercial??null,direccion_matriz:dir}).eq('id',emisorId);
  const est = await supabase.from('establecimientos_emisor').upsert({emisor_id:emisorId,codigo:'001',tipo_establecimiento:'MATRIZ',nombre_comercial:solicitud?.nombre_comercial??null,direccion:dir,activo:true},{onConflict:'emisor_id,codigo'});
  if (est.error) throw new Error(`No se pudo activar la matriz: ${est.error.message}`);
  const puntoExistente = await supabase.from('puntos_emision').select('id').eq('emisor_id',emisorId).eq('establecimiento','001').eq('punto_emision','001').maybeSingle();
  let puntoId:string;
  if (puntoExistente.error) throw new Error(`No se pudo consultar el punto de emisión: ${puntoExistente.error.message}`);
  if (puntoExistente.data?.id) {
    const pu = await supabase.from('puntos_emision').update({direccion:dir,activo:true}).eq('id',puntoExistente.data.id);
    if (pu.error) throw new Error(`No se pudo activar el punto de emisión: ${pu.error.message}`);
    puntoId = puntoExistente.data.id;
  } else {
    const pi = await supabase.from('puntos_emision').insert({emisor_id:emisorId,establecimiento:'001',punto_emision:'001',direccion:dir,activo:true}).select('id').single();
    if (pi.error || !pi.data) throw new Error(`No se pudo crear el punto de emisión: ${pi.error?.message ?? 'sin respuesta'}`);
    puntoId = pi.data.id;
  }

  let userId:string;
  const rel = await supabase.from('contribuyentes_cliente_saas').select('cuenta_id,cuentas_cliente_saas(id,admin_user_id)').eq('emisor_id',emisorId).maybeSingle();
  const relCuenta:any = rel.data?.cuentas_cliente_saas;
  if (relCuenta?.admin_user_id) userId = relCuenta.admin_user_id;
  else {
    const tmp = `Ct${randomBytes(6).toString('base64url')}!`;
    userId = await crearOEncontrarUsuario(email,tmp);
    await agregarUsuarioANegocio(userId,emisorId,'admin');
  }

  let cuenta:any = relCuenta ?? null;
  if (!cuenta) {
    const porCorreo = await supabase.from('cuentas_cliente_saas').select('*').eq('email_admin',email).maybeSingle();
    cuenta = porCorreo.data ?? null;
  }
  if (!cuenta) {
    const c = await supabase.from('cuentas_cliente_saas').insert({nombre:razonSocial,email_admin:email,admin_user_id:userId,plan_id:plan.id,estado:'activa'}).select('*').single();
    if (c.error || !c.data) throw new Error(`No se pudo crear la cuenta SaaS: ${c.error?.message??'sin respuesta'}`);
    cuenta=c.data;
  } else {
    const c = await supabase.from('cuentas_cliente_saas').update({nombre:razonSocial,email_admin:email,admin_user_id:userId,plan_id:plan.id,estado:'activa',updated_at:new Date().toISOString()}).eq('id',cuenta.id).select('*').single();
    if (c.error) throw new Error(`No se pudo activar la cuenta SaaS: ${c.error.message}`);
    cuenta=c.data ?? cuenta;
  }
  const cr = await supabase.from('contribuyentes_cliente_saas').upsert({cuenta_id:cuenta.id,emisor_id:emisorId,activo:true},{onConflict:'emisor_id'});
  if (cr.error) throw new Error(`No se pudo vincular el RUC con la cuenta: ${cr.error.message}`);

  const inicio = fechaIsoEcuador();
  const dias = String(plan.periodicidad).toLowerCase()==='anual' ? 365 : 30;
  const vencimiento = fechaMasDias(dias);
  const sub = await supabase.from('suscripciones').select('id').eq('emisor_id',emisorId).maybeSingle();
  if (sub.data?.id) {
    const u=await supabase.from('suscripciones').update({cuenta_id:cuenta.id,plan_id:plan.id,estado:'activa',fecha_inicio:inicio,proximo_vencimiento:vencimiento,fecha_cancelacion:null,updated_at:new Date().toISOString()}).eq('id',sub.data.id);
    if (u.error) throw new Error(`No se pudo renovar la suscripción: ${u.error.message}`);
  } else {
    const i=await supabase.from('suscripciones').insert({emisor_id:emisorId,cuenta_id:cuenta.id,plan_id:plan.id,estado:'activa',fecha_inicio:inicio,proximo_vencimiento:vencimiento});
    if (i.error) throw new Error(`No se pudo crear la suscripción: ${i.error.message}`);
  }
  await supabase.from('configuracion_iva').upsert({emisor_id:emisorId,tarifa_general:15,codigo_general:'4',tarifa_reducida:5,codigo_reducida:'5',tarifa_turismo:8,codigo_turismo:'8',activo:true},{onConflict:'emisor_id'});
  return {emisorId,cuentaId:cuenta.id,plan:plan.codigo,fechaInicio:inicio,proximoVencimiento:vencimiento,dias};
}

async function notificarPagoAroot(pago:any, solicitud:any, activacion:any = null) {
  const destinatarios = await obtenerEmailsAdminSaas();
  if (!destinatarios.length) throw new Error('Pago aprobado pero no hay correos ROOT configurados.');
  const panelUrl = `${env.appUrl.replace(/\/$/,'')}/admin-proveedor`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:680px;margin:auto;color:#172033"><div style="background:#166534;color:#fff;padding:22px;border-radius:14px 14px 0 0"><h2 style="margin:0">💰 Pago SaaS aprobado</h2><p style="margin:6px 0 0">Pago procesado y plan activado automáticamente.</p></div><div style="border:1px solid #e5e7eb;border-top:0;padding:22px;border-radius:0 0 14px 14px"><table style="width:100%;border-collapse:collapse"><tr><td><b>RUC</b></td><td>${esc(solicitud.ruc)}</td></tr><tr><td><b>Empresa</b></td><td>${esc(solicitud.razon_social)}</td></tr><tr><td><b>Correo</b></td><td>${esc(solicitud.email)}</td></tr><tr><td><b>Plan</b></td><td>${esc(solicitud.plan_codigo)}</td></tr><tr><td><b>Monto</b></td><td>$${Number(pago.monto).toFixed(2)} USD</td></tr><tr><td><b>Referencia</b></td><td>${esc(pago.client_transaction_id)}</td></tr></table><p style="margin-top:22px"><a href="${esc(panelUrl)}" style="display:inline-block;background:#166534;color:#fff;text-decoration:none;padding:13px 20px;border-radius:9px;font-weight:800">ABRIR PANEL ROOT</a></p><p style="font-size:12px;color:#64748b">Activación: ${esc(activacion?.plan ?? 'realizada')} · Vence: ${esc(activacion?.proximoVencimiento ?? '')}</p><p style="font-size:12px;color:#64748b">La cuenta fue activada automáticamente después de validar el pago. ROOT recibe este aviso para auditoría.</p></div></div>`;
  for (const to of destinatarios) await enviarComprobantePorCorreo({to,subject:`💰 Pago aprobado · ${solicitud.ruc} · CONTSERTRIB`,html});
  await supabase.from('pagos_solicitud_saas').update({notificacion_admin_estado:'enviado'}).eq('id',pago.id);
}
