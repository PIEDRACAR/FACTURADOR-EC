import type { FastifyInstance } from 'fastify';
import { supabase } from '../db/supabase.js';
import { notificarNuevaSolicitudSaas } from '../services/notificacionesSaas.js';

interface SolicitudRegistroBody {
  ruc?: string;
  razonSocial?: string;
  nombreComercial?: string;
  email?: string;
  direccionMatriz?: string;
  planCodigo?: string;
  ambiente?: 'pruebas' | 'produccion';
}

const RUC_REGEX = /^\d{13}$/;
const registroPorIp = new Map<string, { inicio:number; cantidad:number }>();
const VENTANA_REGISTRO_MS = 10 * 60 * 1000;
const MAX_REGISTROS_POR_IP = 8;

/**
 * Registro público CONTROLADO.
 *
 * Una persona que encuentre el enlace público puede solicitar el servicio,
 * pero NO se crea un usuario, NO se crea una empresa operativa, NO se crea
 * una suscripción activa y NO se entrega una sesión. La solicitud queda
 * pendiente para que el ROOT/administrador de CONTSERTRIB la revise y cree
 * el cliente desde el panel maestro.
 */
export async function registrarRutasEmisores(app: FastifyInstance) {
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

    return reply.status(201).send({
      ok: true, solicitudId: solicitud.id, correoAdminEnviado, correoAdminError,
      mensaje: 'Solicitud recibida. CONTSERTRIB la revisará y, una vez activada, recibirás tus credenciales de acceso.'
    });
  });
}
