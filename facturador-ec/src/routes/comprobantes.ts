import type { FastifyInstance } from 'fastify';
import type { FacturaData } from 'facturacion-electronica-ec';
import { supabase } from '../db/supabase.js';
import { emitirFactura } from '../services/facturacion.js';
import { generarRidePdf } from '../services/ride.js';
import { enviarComprobantePorCorreo } from '../services/email.js';
import { archivarComprobanteAutorizado, obtenerArchivosComprobante } from '../services/archivoComprobante.js';
import { registrarAuditoria } from '../services/auditoria.js';

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

  /**
   * Reimpresión rápida del ticket térmico. No vuelve a emitir ni consulta al SRI:
   * reconstruye la venta autorizada desde la información persistida y deja el
   * navegador listo para imprimir en 58/80 mm.
   */
  app.get<{ Params: { id: string } }>('/comprobantes/:id/ticket', async (request, reply) => {
    const { data: c, error } = await supabase.from('comprobantes').select(`
      id, emisor_id, estado, secuencial, clave_acceso, numero_autorizacion, fecha_autorizacion,
      importe_total, subtotal_0, subtotal_5, subtotal_8, subtotal_15, total_iva, total_descuento,
      created_at, emisores(razon_social,nombre_comercial,ruc,direccion_matriz),
      puntos_emision(establecimiento,punto_emision,direccion), clientes(razon_social,identificacion),
      comprobante_items(descripcion,cantidad,precio_unitario,descuento,precio_total_sin_impuesto,valor_iva),
      comprobante_formas_pago(forma_pago_codigo,valor)
    `).eq('id', request.params.id).single();
    if (error || !c) return reply.status(404).type('text/plain').send('Comprobante no encontrado.');
    if (c.estado !== 'autorizado') return reply.status(409).type('text/plain').send('Solo se puede reimprimir un comprobante autorizado por el SRI.');

    const emisor = c.emisores as any;
    const punto = c.puntos_emision as any;
    const cliente = c.clientes as any;
    const items = (c.comprobante_items as any[]) ?? [];
    const pagos = (c.comprobante_formas_pago as any[]) ?? [];
    const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'} as any)[m]);
    const money = (v: unknown) => Number(v ?? 0).toFixed(2);
    const rucProveedor = process.env.RUC_PROVEEDOR_FACTURACION?.trim();
    const filas = items.map(i => `<tr><td>${esc(i.descripcion)}</td><td class="qty">${money(i.cantidad)}</td><td class="num">${money(i.precio_unitario)}</td><td class="num">${money(i.precio_total_sin_impuesto)}</td></tr>`).join('');
    const pagoHtml = pagos.map(p => `<div>${esc(p.forma_pago_codigo)}: $${money(p.valor)}</div>`).join('');
    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ticket ${esc(c.secuencial)}</title><style>
      @page{size:80mm auto;margin:0}*{box-sizing:border-box}body{font-family:Arial,sans-serif;width:80mm;margin:0 auto;padding:4mm;color:#111;font-size:11px}.center{text-align:center}.brand{font-weight:800;font-size:15px}.small{font-size:9px;color:#444}.line{border-top:1px dashed #111;margin:7px 0}table{width:100%;border-collapse:collapse;font-size:10px}th,td{padding:3px 0;text-align:left;vertical-align:top}th{border-bottom:1px solid #111}.qty{width:11%;text-align:center}.num{text-align:right}.tot{font-size:12px;font-weight:800}.sri{font-size:9px}.print{position:fixed;right:12px;top:12px;background:#111;color:#fff;border:0;border-radius:8px;padding:9px 12px;cursor:pointer}@media print{.print{display:none}body{width:80mm}}</style></head><body>
      <button class="print" onclick="window.print()">🖨 Imprimir</button><div class="center"><div class="brand">${esc(emisor?.nombre_comercial || emisor?.razon_social || 'CONTSERTRIB')}</div><div>RUC ${esc(emisor?.ruc)}</div><div class="small">${esc(emisor?.direccion_matriz)}</div><div class="small">Est. ${esc(punto?.establecimiento)} · Pto. ${esc(punto?.punto_emision)}</div></div>
      <div class="line"></div><div class="center"><b>FACTURA</b><br>No. ${esc(punto?.establecimiento)}-${esc(punto?.punto_emision)}-${esc(c.secuencial)}<br><span class="sri">Autorización: ${esc(c.numero_autorizacion || c.clave_acceso)}</span></div>
      <div class="line"></div><div>Cliente: <b>${esc(cliente?.razon_social || 'Consumidor Final')}</b><br>Identificación: ${esc(cliente?.identificacion || '9999999999999')}</div>
      <div class="line"></div><table><thead><tr><th>Descripción</th><th class="qty">Cant.</th><th class="num">P.Unit.</th><th class="num">Total</th></tr></thead><tbody>${filas}</tbody></table>
      <div class="line"></div><div class="num">Subtotal: $${money(Number(c.subtotal_0||0)+Number(c.subtotal_5||0)+Number(c.subtotal_8||0)+Number(c.subtotal_15||0))}</div><div class="num">IVA: $${money(c.total_iva)}</div><div class="num tot">TOTAL: $${money(c.importe_total)}</div><div class="line"></div><div><b>Forma de pago</b>${pagoHtml || '<div>—</div>'}</div>
      ${rucProveedor ? `<div class="line"></div><div class="sri">RUC proveedor del sistema: ${esc(rucProveedor)}</div>` : ''}
      <div class="line"></div><div class="center sri">Clave de acceso<br>${esc(c.clave_acceso)}<br><br>Documento electrónico autorizado por el SRI.<br>Ticket / copia de impresión.</div>
      <script>window.addEventListener('load',()=>setTimeout(()=>window.print(),250));</script></body></html>`;
    await registrarAuditoria({ emisorId: c.emisor_id, userId: request.usuarioSesion?.userId, evento: 'REIMPRESION_TICKET', estado: c.estado, claveAcceso: c.clave_acceso, secuencial: c.secuencial, comprobanteId: c.id, detalle: { formato: '80mm' } });
    return reply.header('Cache-Control','no-store').type('text/html; charset=utf-8').send(html);
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
