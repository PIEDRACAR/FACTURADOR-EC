import type { FastifyInstance } from 'fastify';
import type { FacturaData } from 'facturacion-electronica-ec';
import { supabase } from '../db/supabase.js';
import { emitirFactura } from '../services/facturacion.js';
import { generarRidePdf } from '../services/ride.js';
import { enviarComprobantePorCorreo } from '../services/email.js';
import { archivarComprobanteAutorizado, obtenerArchivosComprobante } from '../services/archivoComprobante.js';

interface EmitirFacturaBody {
  emisorId: string;
  comprobanteId: string;
  facturaData: FacturaData;
}

export async function registrarRutasComprobantes(app: FastifyInstance) {
  /**
   * Emite una factura ya generada en la tabla `comprobantes` (estado
   * 'generado'). El POS es responsable de haber creado esa fila y sus
   * `comprobante_items` / `comprobante_formas_pago` ANTES de llamar aquí,
   * para no perder el detalle de la venta si la emisión falla.
   */
  app.post<{ Body: EmitirFacturaBody }>('/comprobantes/factura/emitir', async (request, reply) => {
    const { emisorId, comprobanteId, facturaData } = request.body;

    if (!emisorId || !comprobanteId || !facturaData) {
      return reply.status(400).send({
        error: 'Se requieren emisorId, comprobanteId y facturaData en el cuerpo de la petición.',
      });
    }

    try {
      const resultado = await emitirFactura({ emisorId, comprobanteId, facturaData });
      return reply.send({
        estado: resultado.estado,
        claveAcceso: resultado.claveAcceso,
        numeroAutorizacion: resultado.numeroAutorizacion,
      });
    } catch (err) {
      request.log.error(err);
      return reply.status(502).send({
        error: 'No se pudo completar la emisión de la factura.',
        detalle: err instanceof Error ? err.message : String(err),
      });
    }
  });

  /** Reenvía una factura autorizada al correo del cliente, con RIDE PDF + XML firmado. */
  app.post<{ Params: { id: string }; Body: { email?: string; emisorId?: string } }>('/comprobantes/:id/reenviar-email', async (request, reply) => {
    const emisorIdBody = request.body?.emisorId?.trim();
    const emailValido = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
    const { data: comprobante, error } = await supabase
      .from('comprobantes')
      .select('id, emisor_id, secuencial, clave_acceso, numero_autorizacion, estado, xml_firmado, importe_total, created_at, clientes(razon_social, email), emisores(razon_social, nombre_comercial)')
      .eq('id', request.params.id)
      .single();

    if (error || !comprobante) return reply.status(404).send({ error: 'Comprobante no encontrado.' });
    if (emisorIdBody && emisorIdBody !== comprobante.emisor_id) return reply.status(403).send({ error: 'El comprobante no pertenece al negocio seleccionado.' });
    if (comprobante.estado !== 'autorizado') return reply.status(409).send({ error: 'Solo se pueden reenviar comprobantes autorizados por el SRI.' });
    if (!comprobante.xml_firmado) return reply.status(409).send({ error: 'La factura no tiene XML firmado guardado.' });

    const cliente = comprobante.clientes as unknown as { razon_social?: string; email?: string } | null;
    const destinatario = (request.body?.email ?? cliente?.email ?? '').trim().toLowerCase();
    if (!emailValido(destinatario)) return reply.status(400).send({ error: 'El cliente no tiene un correo válido. Puedes indicar uno para este reenvío.' });

    try {
      const ride = await generarRidePdf(comprobante.id);
      const secuencial = comprobante.secuencial ?? 'sin-secuencial';
      const emisor = comprobante.emisores as unknown as { razon_social?: string; nombre_comercial?: string | null } | null;
      const nombreCliente = cliente?.razon_social ?? 'Cliente';
      const asunto = `Reenvío de factura ${secuencial} — ${emisor?.nombre_comercial || emisor?.razon_social || 'CONTSERTRIB FACTURACIÓN'}`;
      const resultado = await enviarComprobantePorCorreo({
        to: destinatario,
        subject: asunto,
        html: `<div style="font-family:Arial,sans-serif;color:#172033;max-width:640px;margin:auto"><h2 style="color:#1d4ed8">Factura electrónica</h2><p>Estimado/a <strong>${nombreCliente}</strong>:</p><p>Te reenviamos tu factura electrónica <strong>${secuencial}</strong>, autorizada por el SRI.</p><p>Adjuntamos la representación impresa (RIDE en PDF) y el XML firmado.</p><p style="font-size:12px;color:#64748b">Clave de acceso: ${comprobante.clave_acceso ?? '—'}<br>Número de autorización: ${comprobante.numero_autorizacion ?? '—'}</p></div>`,
        attachments: [
          { filename: `factura-${secuencial}.pdf`, content: ride.toString('base64'), type: 'application/pdf' },
          { filename: `${comprobante.clave_acceso ?? comprobante.id}.xml`, content: Buffer.from(comprobante.xml_firmado, 'utf8').toString('base64'), type: 'application/xml' },
        ],
      });

      await supabase.from('email_envios').insert({ comprobante_id: comprobante.id, destinatario, estado: 'enviado', detalle: `Reenvío manual. ID Resend: ${resultado?.id ?? '—'}` });
      return reply.send({ ok: true, destinatario, emailId: resultado?.id ?? null, mensaje: 'Factura reenviada correctamente.' });
    } catch (err) {
      const detalle = err instanceof Error ? err.message : String(err);
      await supabase.from('email_envios').insert({ comprobante_id: comprobante.id, destinatario, estado: 'error', detalle });
      return reply.status(502).send({ error: 'No se pudo reenviar la factura por correo.', detalle });
    }
  });

  /** Historial de envíos de correo de una factura. */
  app.get<{ Params: { id: string } }>('/comprobantes/:id/email-historial', async (request, reply) => {
    const { data, error } = await supabase.from('email_envios').select('id, destinatario, estado, detalle, created_at').eq('comprobante_id', request.params.id).order('created_at', { ascending: false }).limit(20);
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(data ?? []);
  });

  /** Lista los archivos documentales permanentes y entrega URLs firmadas por 1 hora. */
  app.get<{ Params: { id: string } }>('/comprobantes/:id/archivos', async (request, reply) => {
    try {
      const { data: comprobante, error } = await supabase
        .from('comprobantes')
        .select('id, emisor_id, estado, clave_acceso, secuencial, xml_firmado')
        .eq('id', request.params.id)
        .single();

      if (error || !comprobante) return reply.status(404).send({ error: 'Comprobante no encontrado.' });
      if (comprobante.estado !== 'autorizado') return reply.status(409).send({ error: 'Solo se pueden archivar comprobantes autorizados por el SRI.' });

      let archivos = await obtenerArchivosComprobante(comprobante.id);

      // Permite recuperar comprobantes autorizados antes de instalar esta mejora.
      if (archivos.length < 2 && comprobante.xml_firmado && comprobante.clave_acceso) {
        await archivarComprobanteAutorizado({
          comprobanteId: comprobante.id,
          emisorId: comprobante.emisor_id,
          claveAcceso: comprobante.clave_acceso,
          xmlFirmado: comprobante.xml_firmado,
          secuencial: comprobante.secuencial,
        });
        archivos = await obtenerArchivosComprobante(comprobante.id);
      }

      return reply.send({ ok: true, comprobanteId: comprobante.id, archivos });
    } catch (err) {
      request.log.error(err);
      return reply.status(500).send({ error: 'No se pudieron obtener los archivos documentales.', detalle: err instanceof Error ? err.message : String(err) });
    }
  });

  /** Consulta rápida del estado actual de un comprobante ya emitido. */
  app.get<{ Params: { id: string } }>('/comprobantes/:id', async (request, reply) => {
    const { data, error } = await supabase
      .from('comprobantes')
      .select('*')
      .eq('id', request.params.id)
      .single();

    if (error || !data) {
      return reply.status(404).send({ error: 'Comprobante no encontrado.' });
    }
    return reply.send(data);
  });
}
