import type { FastifyInstance } from 'fastify';
import { supabase } from '../db/supabase.js';
import { notificarNuevaSolicitudSaas } from '../services/notificacionesSaas.js';
import { crearLinkPagoSaas, procesarNotificacionPayphone, estadoPayphone } from '../services/pagosSaas.js';
import { crearOEncontrarUsuario, agregarUsuarioANegocio } from '../auth/sesiones.js';
import { fechaIsoEcuador } from '../utils/fechaEcuador.js';
import { env } from '../config/env.js';

interface SolicitudRegistroBody {
  ruc?: string;
  razonSocial?: string;
  nombreComercial?: string;
  email?: string;
  direccionMatriz?: string;
  planCodigo?: string;
  ambiente?: 'pruebas' | 'produccion';
  password?: string;
}

const RUC_REGEX = /^\d{13}$/;
const registroPorIp = new Map<string, { inicio:number; cantidad:number }>();
const VENTANA_REGISTRO_MS = 10 * 60 * 1000;
const MAX_REGISTROS_POR_IP = 8;

async function obtenerPromocionPublica() {
  const { data } = await supabase.from('promociones_saas').select('activa,dias_prueba,fecha_desde,fecha_hasta,aplicar_automaticamente,nombre,texto_publico').eq('codigo','TRIAL_PUBLICO').maybeSingle();
  if (!data) return { activa:false, dias:0, vigente:false, nombre:'', textoPublico:'' };
  const hoy = fechaIsoEcuador();
  const vigente = Boolean(data.activa && data.aplicar_automaticamente && Number(data.dias_prueba||0) > 0 && (!data.fecha_desde || hoy >= data.fecha_desde) && (!data.fecha_hasta || hoy <= data.fecha_hasta));
  return { activa:Boolean(data.activa), dias:vigente ? Number(data.dias_prueba||0) : 0, vigente, nombre:String(data.nombre||''), textoPublico:String(data.texto_publico||'') };
}

/**
 * Registro público CONTROLADO.
 *
 * Registro autoservicio: crea la cuenta y aplica únicamente la promoción
 * comercial vigente configurada por ROOT. Si no existe promoción activa,
 * la suscripción queda vencida hasta que exista un pago/activación.
 */
export async function registrarRutasEmisores(app: FastifyInstance) {
  // Notificación Externa de Payphone: solo procesa referencias de cobro creadas por CONTSERTRIB.
  // Se mantienen ambas rutas para compatibilidad con la configuración actual y con el nombre
  // de método indicado por Payphone para Notificación Externa.
  const notificacionPayphone = async (request: any, reply: any) => {
    try {
      const resultado = await procesarNotificacionPayphone(request.body ?? {});
      // Payphone espera esta confirmación JSON para considerar consumida la notificación.
      return reply.send({ Response: true, ErrorCode: '000' });
    } catch (err) {
      request.log.error({ err }, 'Notificación Payphone no procesada');
      return reply.status(400).send({ Response: false, ErrorCode: '222' });
    }
  };
  app.post('/pagos/payphone/notificacion', notificacionPayphone);
  app.post('/pagos/payphone/NotificacionPago', notificacionPayphone);
  app.get('/pagos/payphone/health', async (_request, reply) => { return reply.send({ ok:true, proveedor:'payphone', ...estadoPayphone(), timestamp:new Date().toISOString() }); });

  app.post<{ Body: SolicitudRegistroBody }>('/emisores/registrar', async (request, reply) => {
    const b = request.body ?? {};
    const ruc = String(b.ruc ?? '').replace(/\D/g, '');
    const razonSocial = String(b.razonSocial ?? '').trim();
    const nombreComercial = String(b.nombreComercial ?? '').trim() || null;
    const email = String(b.email ?? '').trim().toLowerCase();
    const direccionMatriz = String(b.direccionMatriz ?? '').trim();
    const planCodigo = String(b.planCodigo ?? 'BASICO').trim().toUpperCase();
    const ambiente = b.ambiente === 'pruebas' ? 'pruebas' : 'produccion';

    if (!RUC_REGEX.test(ruc)) return reply.status(400).send({ error: 'El RUC debe tener exactamente 13 dígitos.' });
    if (!razonSocial || !email || !direccionMatriz) return reply.status(400).send({ error: 'RUC, razón social, correo y dirección son obligatorios.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply.status(400).send({ error: 'El correo no es válido.' });
    const password = String(b.password ?? '').trim();
    if (password.length < 8) return reply.status(400).send({ error: 'La contraseña debe tener al menos 8 caracteres.' });

    const ahora=Date.now(); const ip=String(request.ip||'desconocida'); const limite=registroPorIp.get(ip);
    if (!limite || ahora-limite.inicio>=VENTANA_REGISTRO_MS) registroPorIp.set(ip,{inicio:ahora,cantidad:1});
    else { limite.cantidad+=1; if(limite.cantidad>MAX_REGISTROS_POR_IP) return reply.status(429).send({error:'Demasiadas solicitudes desde esta conexión. Intenta nuevamente en unos minutos.'}); }

    const { data: planActivo } = await supabase.from('planes_suscripcion').select('id,codigo').eq('codigo', planCodigo).eq('activo', true).maybeSingle();
    if (!planActivo) return reply.status(400).send({ error: 'El plan seleccionado no está disponible actualmente.' });

    const { data: emisor } = await supabase.from('emisores').select('id').eq('ruc', ruc).maybeSingle();
    if (emisor) {
      const { data: activa } = await supabase.from('contribuyentes_cliente_saas')
        .select('id,activo,cuentas_cliente_saas(estado)')
        .eq('emisor_id', emisor.id).eq('activo', true).maybeSingle();
      if (activa && (activa as any).cuentas_cliente_saas?.estado !== 'eliminada') {
        return reply.status(409).send({ error: 'Ese RUC ya está registrado como cliente de CONTSERTRIB.' });
      }
    }

    const { data: pendiente } = await supabase.from('solicitudes_registro_saas')
      .select('id,estado')
      .eq('ruc', ruc)
      .in('estado', ['pendiente','en_revision'])
      .maybeSingle();
    if (pendiente) return reply.status(409).send({ error: 'Ya existe una solicitud pendiente para este RUC.', solicitudId: pendiente.id });

    const { data: solicitud, error } = await supabase.from('solicitudes_registro_saas').insert({
      ruc, razon_social: razonSocial, nombre_comercial: nombreComercial, email,
      direccion_matriz: direccionMatriz, plan_codigo: planCodigo, ambiente, estado: 'pendiente'
    }).select('id,creado_at').single();
    if (error || !solicitud) {
      request.log.error(error);
      return reply.status(500).send({ error: 'No se pudo registrar la solicitud.', detalle: error?.message });
    }

    let correoAdminEnviado = false;
    let correoAdminError: string | null = null;
    try {
      await notificarNuevaSolicitudSaas({
        id: solicitud.id, ruc, razonSocial, nombreComercial, email, direccionMatriz,
        planCodigo, ambiente, creadoAt: solicitud.creado_at
      });
      correoAdminEnviado = true;
      await supabase.from('solicitudes_registro_saas').update({
        notificacion_admin_estado: 'enviado', notificacion_admin_detalle: 'Solicitud notificada a ROOT.',
        notificacion_admin_enviado_at: new Date().toISOString()
      }).eq('id', solicitud.id);
    } catch (err) {
      correoAdminError = err instanceof Error ? err.message : String(err);
      request.log.error({ err, solicitudId: solicitud.id }, 'No se pudo notificar la nueva solicitud al ROOT');
      await supabase.from('solicitudes_registro_saas').update({
        notificacion_admin_estado: 'error', notificacion_admin_detalle: correoAdminError
      }).eq('id', solicitud.id);
    }

    // Alta inmediata: el usuario debe poder entrar con la contraseña que acaba de crear.
    // La vigencia inicial depende exclusivamente de la promoción configurada por ROOT.
    try {
      const { data: plan } = await supabase.from('planes_suscripcion')
        .select('id,codigo,nombre,precio_mensual,precio_anual,periodicidad')
        .eq('codigo', planCodigo).eq('activo', true).maybeSingle();
      if (!plan) throw new Error('El plan seleccionado no está disponible.');

      const { data: emisorExistente } = await supabase.from('emisores').select('id').eq('ruc', ruc).maybeSingle();
      let emisorId = emisorExistente?.id as string | undefined;
      if (!emisorId) {
        const { data: nuevo, error: e } = await supabase.from('emisores').insert({
          ruc, razon_social: razonSocial, nombre_comercial: nombreComercial,
          direccion_matriz: direccionMatriz, obligado_contabilidad: false, ambiente
        }).select('id').single();
        if (e || !nuevo) throw new Error(`No se pudo crear la empresa: ${e?.message ?? 'sin detalle'}`);
        emisorId = nuevo.id;
      } else {
        await supabase.from('emisores').update({ razon_social: razonSocial, nombre_comercial: nombreComercial, direccion_matriz: direccionMatriz, ambiente }).eq('id', emisorId);
      }

      const { error: estErr } = await supabase.from('establecimientos_emisor').upsert({
        emisor_id: emisorId, codigo:'001', tipo_establecimiento:'MATRIZ', nombre_comercial:nombreComercial, direccion:direccionMatriz, activo:true
      }, { onConflict:'emisor_id,codigo' });
      if (estErr) throw new Error(`No se pudo crear la matriz: ${estErr.message}`);
      const { data: puntoExistente } = await supabase.from('puntos_emision').select('id').eq('emisor_id',emisorId).eq('establecimiento','001').eq('punto_emision','001').maybeSingle();
      let punto: any = puntoExistente;
      if (punto) {
        const {error:pErr}=await supabase.from('puntos_emision').update({direccion:direccionMatriz,activo:true}).eq('id',punto.id);
        if(pErr) throw new Error(`No se pudo activar el punto de emisión: ${pErr.message}`);
      } else {
        const {data:nuevoPunto,error:pErr}=await supabase.from('puntos_emision').insert({emisor_id:emisorId,establecimiento:'001',punto_emision:'001',direccion:direccionMatriz,activo:true}).select('id').single();
        if(pErr||!nuevoPunto) throw new Error(`No se pudo crear el punto de emisión: ${pErr?.message ?? 'sin detalle'}`);
        punto=nuevoPunto;
      }

      if (!emisorId) throw new Error('No se pudo determinar el emisor creado para la cuenta.');
      const emisorIdFinal: string = emisorId;

      const userId = await crearOEncontrarUsuario(email, password);
      await agregarUsuarioANegocio(userId, emisorIdFinal, 'admin');

      const { data: cuentaExistente } = await supabase.from('cuentas_cliente_saas').select('id').eq('admin_user_id', userId).maybeSingle();
      let cuentaId = cuentaExistente?.id as string | undefined;
      if (!cuentaId) {
        const { data: cuenta, error: cErr } = await supabase.from('cuentas_cliente_saas').insert({
          nombre: razonSocial, email_admin: email, admin_user_id:userId, plan_id:plan.id, estado:'activa'
        }).select('id').single();
        if (cErr || !cuenta) throw new Error(`No se pudo crear la cuenta SaaS: ${cErr?.message ?? 'sin detalle'}`);
        cuentaId = cuenta.id;
      } else {
        await supabase.from('cuentas_cliente_saas').update({ nombre:razonSocial, email_admin:email, plan_id:plan.id, estado:'activa' }).eq('id', cuentaId);
      }

      const { data: rel } = await supabase.from('contribuyentes_cliente_saas').select('id').eq('emisor_id', emisorIdFinal).maybeSingle();
      if (rel) await supabase.from('contribuyentes_cliente_saas').update({ cuenta_id:cuentaId, activo:true }).eq('id',rel.id);
      else await supabase.from('contribuyentes_cliente_saas').insert({ cuenta_id:cuentaId, emisor_id:emisorIdFinal, activo:true });

      const inicio = fechaIsoEcuador();
      const promocion = await obtenerPromocionPublica();
      const diasPrueba = promocion.vigente ? promocion.dias : 0;
      const vencimiento = new Date(`${inicio}T12:00:00-05:00`);
      if (diasPrueba > 0) vencimiento.setDate(vencimiento.getDate()+diasPrueba);
      else vencimiento.setDate(vencimiento.getDate()-1);
      const vence = vencimiento.toISOString().slice(0,10);
      const estadoInicial = diasPrueba > 0 ? 'activa' : 'vencida';
      const { data: sub } = await supabase.from('suscripciones').select('id').eq('emisor_id',emisorIdFinal).maybeSingle();
      if (sub) await supabase.from('suscripciones').update({ cuenta_id:cuentaId, plan_id:plan.id, estado:estadoInicial, fecha_inicio:inicio, proximo_vencimiento:vence, updated_at:new Date().toISOString() }).eq('id',sub.id);
      else await supabase.from('suscripciones').insert({ emisor_id:emisorIdFinal, cuenta_id:cuentaId, plan_id:plan.id, estado:estadoInicial, fecha_inicio:inicio, proximo_vencimiento:vence });
      await supabase.from('configuracion_iva').upsert({ emisor_id:emisorIdFinal, tarifa_general:15, codigo_general:'4', tarifa_reducida:5, codigo_reducida:'5', tarifa_turismo:8, codigo_turismo:'8', activo:true }, {onConflict:'emisor_id'});

      // Si no existe una promoción de prueba vigente, generar automáticamente el cobro
      // PayPhone. Un fallo de PayPhone NO invalida el registro: queda visible para ROOT
      // con el motivo exacto y puede reintentarse desde el Panel Maestro.
      let pagoAutomatico:any = null;
      let pagoAutomaticoError:string|null = null;
      if (diasPrueba <= 0) {
        try {
          pagoAutomatico = await crearLinkPagoSaas(solicitud.id, false);
        } catch (err) {
          pagoAutomaticoError = err instanceof Error ? err.message : String(err);
          request.log.error({err, solicitudId:solicitud.id}, 'No se pudo generar automáticamente el link PayPhone');
          await supabase.from('solicitudes_registro_saas').update({
            pago_estado:'pendiente_pago',
            notificacion_admin_detalle:`Solicitud registrada. Link PayPhone pendiente: ${pagoAutomaticoError}`
          }).eq('id', solicitud.id);
        }
      }

      return reply.status(201).send({
        ok:true, solicitudId:solicitud.id, emisorId:emisorIdFinal, puntoEmisionId:punto.id, userId,
        acceso:{ url:`${env.appUrl}/login`, email, password },
        prueba: diasPrueba > 0 ? { dias:diasPrueba, fechaInicio:inicio, proximoVencimiento:vence, promocion:promocion.nombre } : { dias:0, fechaInicio:inicio, proximoVencimiento:vence, promocion:null },
        pago: pagoAutomatico ? { estado:pagoAutomatico.estado, monto:pagoAutomatico.monto, paymentLink:pagoAutomatico.payment_link, referencia:pagoAutomatico.client_transaction_id, correoCliente:pagoAutomatico.notificacion_cliente_estado ?? 'pendiente' } : { estado:'pendiente', error:pagoAutomaticoError },
        notificaciones: { correoAdmin: correoAdminEnviado ? 'enviado' : 'error', correoAdminError, correoCliente: pagoAutomatico?.notificacion_cliente_estado ?? (diasPrueba > 0 ? 'no_aplica_por_promocion' : 'pendiente') },
        mensaje: diasPrueba > 0
          ? `Cuenta creada correctamente. Tienes ${diasPrueba} días de promoción para completar la configuración, incluida la firma electrónica.`
          : 'Solicitud registrada correctamente. La promoción de prueba gratuita no está activa; el servicio requiere la contratación y activación del plan.'
      });
    } catch (err) {
      request.log.error({err, solicitudId:solicitud.id}, 'Alta autoservicio no completada');
      return reply.status(500).send({ error:'La solicitud se registró, pero no se pudo completar la creación de la cuenta.', solicitudId:solicitud.id, detalle:err instanceof Error ? err.message : String(err) });
    }
  });
}
