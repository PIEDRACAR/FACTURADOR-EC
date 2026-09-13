import type { FastifyInstance } from 'fastify';
import { env } from '../config/env.js';
import { enviarComprobantePorCorreo } from '../services/email.js';

export async function registrarRutasCorreo(app: FastifyInstance) {
  app.post<{ Body: { emisorId?: string; to?: string } }>('/correo-prueba/enviar', async (request, reply) => {
    const to = request.body?.to?.trim().toLowerCase();
    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return reply.status(400).send({ error: 'Indica un correo válido.' });
    if (!env.resendApiKey || !env.emailFrom) return reply.status(503).send({ error: 'Resend no está configurado en Railway. Verifica RESEND_API_KEY y EMAIL_FROM.' });

    try {
      const resultado = await enviarComprobantePorCorreo({
        to,
        subject: 'Prueba de correo — CONTSERTRIB FACTURACIÓN',
        html: `<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#172033"><div style="padding:22px;background:#123b8f;color:white;border-radius:14px 14px 0 0"><h2 style="margin:0">CONTSERTRIB FACTURACIÓN</h2><p style="margin:5px 0 0;opacity:.85">Prueba de correo transaccional</p></div><div style="padding:24px;border:1px solid #e5e7eb;border-top:0;border-radius:0 0 14px 14px"><p>Este mensaje confirma que el sistema puede comunicarse con Resend y enviar correos desde el backend.</p><p><strong>Configuración detectada correctamente.</strong></p><p style="color:#64748b;font-size:12px">Prueba enviada desde el backend seguro del sistema.</p></div></div>`,
      });
      return reply.send({ ok: true, emailId: resultado?.id ?? null, destinatario: to, mensaje: 'Correo de prueba enviado. Revisa bandeja de entrada y spam.' });
    } catch (err) {
      request.log.error(err);
      return reply.status(502).send({ error: 'Resend rechazó el envío.', detalle: err instanceof Error ? err.message : String(err) });
    }
  });
}
