import type { FastifyInstance } from 'fastify';
import { supabase } from '../db/supabase.js';
import { notificarNuevaSolicitudSaas } from '../services/notificacionesSaas.js';
import { crearLinkPagoSaas, procesarNotificacionPayphone } from '../services/pagosSaas.js';
import { crearOEncontrarUsuario, agregarUsuarioANegocio } from '../auth/sesiones.js';
import { fechaIsoEcuador } from '../utils/fechaEcuador.js';

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

/**
 * Registro público CONTROLADO.
 *
 * Registro autoservicio: crea la cuenta operativa inmediatamente con una
 * prueba inicial de 30 días. El pago/renovación posterior sigue controlado
 * por el flujo SaaS/PayPhone y por ROOT.
 */
export async function registrarRutasEmisores(app: FastifyInstance) {
  // Notificación Externa de Payphone: solo procesa referencias de cobro creadas por CONTSERTRIB.
  // Se mantienen ambas rutas para compatibilidad con la configuración actual y con el nombre
  // de método indicado por Payphone para Notificación Externa.
  const notificacionPayphone = async (request: any, reply: any) => {
    try {
      const resultado = await procesarNotificacionPayphone(request.body ?? {});
      // Payphone espera esta confirmación JSON para considerar consumida la notificación.
      return reply.send({ Response: true, ErrorCode: '000', ok: true, recibido: true, resultado: { pagoId: resultado.pago?.id ?? null, duplicado: Boolean(resultado.duplicado) } });
    } catch (err) {
      request.log.error({ err }, 'Notificación Payphone no procesada');
      return reply.status(400).send({ Response: false, ErrorCode: '222', ok: false, recibido: false, error: err instanceof Error ? err.message : String(err) });
    }
  };
  app.post('/pagos/payphone/notificacion', notificacionPayphone);
  app.post('/pagos/payphone/NotificacionPago', notificacionPayphone);

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
    // La cuenta recibe 30 días de prueba; después queda sujeta al estado de la suscripción.
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

      const userId = await crearOEncontrarUsuario(email, password);
      await agregarUsuarioANegocio(userId, emisorId, 'admin');

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

      const { data: rel } = await supabase.from('contribuyentes_cliente_saas').select('id').eq('emisor_id', emisorId).maybeSingle();
      if (rel) await supabase.from('contribuyentes_cliente_saas').update({ cuenta_id:cuentaId, activo:true }).eq('id',rel.id);
      else await supabase.from('contribuyentes_cliente_saas').insert({ cuenta_id:cuentaId, emisor_id:emisorId, activo:true });

      const inicio = fechaIsoEcuador();
      const vencimiento = new Date(`${inicio}T12:00:00-05:00`); vencimiento.setDate(vencimiento.getDate()+30);
      const vence = vencimiento.toISOString().slice(0,10);
      const { data: sub } = await supabase.from('suscripciones').select('id').eq('emisor_id',emisorId).maybeSingle();
      if (sub) await supabase.from('suscripciones').update({ cuenta_id:cuentaId, plan_id:plan.id, estado:'activa', fecha_inicio:inicio, proximo_vencimiento:vence, updated_at:new Date().toISOString() }).eq('id',sub.id);
      else await supabase.from('suscripciones').insert({ emisor_id:emisorId, cuenta_id:cuentaId, plan_id:plan.id, estado:'activa', fecha_inicio:inicio, proximo_vencimiento:vence });
      await supabase.from('configuracion_iva').upsert({ emisor_id:emisorId, tarifa_general:15, codigo_general:'4', tarifa_reducida:5, codigo_reducida:'5', tarifa_turismo:8, codigo_turismo:'8', activo:true }, {onConflict:'emisor_id'});

      return reply.status(201).send({
        ok:true, solicitudId:solicitud.id, emisorId, puntoEmisionId:punto.id, userId,
        acceso:{ url:`${env.appUrl}/login`, email, password },
        prueba:{ dias:30, fechaInicio:inicio, proximoVencimiento:vence },
        mensaje:'Cuenta creada correctamente. Ya puedes iniciar sesión con tu correo y contraseña. Tienes 30 días de prueba para completar la configuración, incluida la firma electrónica.'
      });
    } catch (err) {
      request.log.error({err, solicitudId:solicitud.id}, 'Alta autoservicio no completada');
      return reply.status(500).send({ error:'La solicitud se registró, pero no se pudo completar la creación de la cuenta.', solicitudId:solicitud.id, detalle:err instanceof Error ? err.message : String(err) });
    }
  });
}
