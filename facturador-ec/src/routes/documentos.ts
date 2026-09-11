import type { FastifyInstance } from 'fastify';
import { supabase } from '../db/supabase.js';
import { comprobarLimiteDocumentos } from '../services/saas.js';
import { emitirDocumentoSri, normalizarDatosDocumento, validarDatosDocumento } from '../services/documentosSri.js';
import { obtenerDocumentoSriPdf } from '../services/documentoSriPdf.js';
import { enviarComprobantePorCorreo } from '../services/email.js';

const TIPOS = new Set(['nota_credito','nota_debito','liquidacion_compra','guia_remision','retencion']);
const ESTADOS = new Set(['borrador','listo','procesando','autorizado','rechazado','devuelto','anulado']);

export async function registrarRutasDocumentos(app: FastifyInstance) {
  app.get<{ Querystring:{emisorId?:string;tipo?:string} }>('/api/documentos', async (request, reply) => {
    const { emisorId, tipo } = request.query;
    if (!emisorId) return reply.status(400).send({error:'Falta emisorId.'});
    let q=supabase.from('documentos_sri_borrador').select('*').eq('emisor_id',emisorId).order('created_at',{ascending:false}).limit(100);
    if (tipo && TIPOS.has(tipo)) q=q.eq('tipo',tipo);
    const {data,error}=await q;
    if(error) return reply.status(500).send({error:error.message});
    return reply.send(data??[]);
  });

  app.get<{ Querystring:{emisorId?:string} }>('/api/documentos/sustentos', async (request, reply) => {
    const { emisorId } = request.query;
    if (!emisorId) return reply.status(400).send({ error: 'Falta emisorId.' });
    const { data, error } = await supabase.from('comprobantes')
      .select('id,emisor_id,secuencial,clave_acceso,created_at,importe_total,subtotal_0,subtotal_5,subtotal_8,subtotal_15,clientes(razon_social,identificacion,tipo_identificacion),puntos_emision(establecimiento,punto_emision),comprobante_items(producto_id,descripcion,cantidad,precio_unitario,descuento,precio_total_sin_impuesto,valor_iva)')
      .eq('emisor_id', emisorId)
      .eq('estado', 'autorizado')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) return reply.status(500).send({ error: error.message });
    const productoIds = [...new Set((data ?? []).flatMap((c: any) => (c.comprobante_items || []).map((i: any) => i.producto_id).filter(Boolean)))];
    let productos: any[] = [];
    let errorProductos: any = null;
    if (productoIds.length) {
      const r = await supabase.from('productos').select('id,codigo_principal').in('id', productoIds);
      productos = r.data || [];
      errorProductos = r.error || null;
    }
    if (errorProductos) return reply.status(500).send({ error: errorProductos.message });
    const codigoPorProducto = new Map((productos ?? []).map((p: any) => [p.id, p.codigo_principal]));
    return reply.send((data ?? []).map((c: any) => ({
      id: c.id,
      numero: c.puntos_emision ? `${c.puntos_emision.establecimiento}-${c.puntos_emision.punto_emision}-${String(c.secuencial ?? '').padStart(9,'0')}` : c.secuencial,
      claveAcceso: c.clave_acceso,
      fecha: c.created_at,
      total: Number(c.importe_total ?? 0),
      base: Number(c.subtotal_0 ?? 0) + Number(c.subtotal_5 ?? 0) + Number(c.subtotal_8 ?? 0) + Number(c.subtotal_15 ?? 0),
      razonSocial: c.clientes?.razon_social ?? '',
      identificacion: c.clientes?.identificacion ?? '',
      tipoIdentificacion: c.clientes?.tipo_identificacion ?? '04',
      items: (c.comprobante_items||[]).map((i:any)=>({productoId:i.producto_id||null,codigo:codigoPorProducto.get(i.producto_id)||'',descripcion:i.descripcion,cantidad:Number(i.cantidad||0),precio:Number(i.precio_unitario||0),descuento:Number(i.descuento||0),ivaCodigo:Number(i.valor_iva||0)>0?'4':'0'})),
    })));
  });

  app.post<{Body:{emisorId?:string;tipo?:string;clienteId?:string;comprobanteSustentoId?:string;datos?:Record<string,unknown>}}>('/api/documentos', async (request,reply)=>{
    const b=request.body??{};
    if(!b.emisorId||!b.tipo||!TIPOS.has(b.tipo)) return reply.status(400).send({error:'Tipo de comprobante no válido.'});
    const datos=normalizarDatosDocumento(b.tipo,b.datos??{});
    const correo=String((datos as any).correoElectronico??'').trim();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) return reply.status(400).send({error:'El correo electrónico es obligatorio y debe ser válido para cualquier documento.'});
    const {data,error}=await supabase.from('documentos_sri_borrador').insert({emisor_id:b.emisorId,tipo:b.tipo,cliente_id:b.clienteId||null,comprobante_sustento_id:b.comprobanteSustentoId||null,datos,estado:'borrador'}).select('id').single();
    if(error||!data) return reply.status(500).send({error:error?.message??'No se pudo guardar el documento.'});
    return reply.status(201).send({ok:true,id:data.id,mensaje:'Borrador guardado.'});
  });

  app.patch<{Params:{id:string};Body:{estado?:string;datos?:Record<string,unknown>}}>('/api/documentos/:id',async(request,reply)=>{
    const cambios:Record<string,unknown>={};
    if(request.body?.estado && ESTADOS.has(request.body.estado)) cambios.estado=request.body.estado;
    if(request.body?.datos) cambios.datos=normalizarDatosDocumento('',request.body.datos);
    const {error}=await supabase.from('documentos_sri_borrador').update(cambios).eq('id',request.params.id);
    if(error)return reply.status(500).send({error:error.message}); return reply.send({ok:true});
  });

  app.post<{Params:{id:string}}>('/api/documentos/:id/emitir', async (request, reply) => {
    const { data: doc, error } = await supabase.from('documentos_sri_borrador').select('*').eq('id',request.params.id).single();
    if(error || !doc) return reply.status(404).send({error:'Documento no encontrado.'});
    if(doc.estado === 'autorizado') return reply.status(409).send({error:'El documento ya fue autorizado; no se debe emitir nuevamente.'});
    const consumo = await comprobarLimiteDocumentos(doc.emisor_id);
    if (!consumo.ok) return reply.status(402).send({error:consumo.mensaje,consumo:consumo.usados,limite:consumo.limite,plan:consumo.plan});
    await supabase.from('documentos_sri_borrador').update({estado:'procesando',motivo_error:null}).eq('id',doc.id);
    try {
      const datosNormalizados = normalizarDatosDocumento(doc.tipo, doc.datos ?? {});
      validarDatosDocumento(doc.tipo, datosNormalizados);

      // Regla SRI: una factura transmitida como CONSUMIDOR FINAL no puede
      // ser anulada ni modificada mediante nota de crédito. Además, una nota
      // de crédito posterior a la ventana de anulación debe referenciar una
      // operación real y emitirse dentro de los 12 meses establecidos.
      if (doc.tipo === 'nota_credito' && doc.comprobante_sustento_id) {
        const { data: sustento } = await supabase.from('comprobantes')
          .select('id,emisor_id,estado,clave_acceso,secuencial,created_at')
          .eq('id', doc.comprobante_sustento_id).eq('emisor_id', doc.emisor_id).maybeSingle();
        if (!sustento) throw new Error('No se encontró el comprobante de sustento de la nota de crédito.');
        if (sustento.estado !== 'autorizado' && sustento.estado !== 'AUTORIZADO') throw new Error('La nota de crédito solo puede sustentarse en un comprobante autorizado por el SRI.');
        if (String(datosNormalizados.identificacionComprador ?? '') === '9999999999999') throw new Error('SRI: una factura emitida a CONSUMIDOR FINAL no puede ser anulada ni modificada mediante nota de crédito una vez transmitida.');
        const fechaSustento = new Date(sustento.created_at);
        const limite = new Date(fechaSustento);
        limite.setMonth(limite.getMonth() + 12);
        if (Date.now() > limite.getTime()) throw new Error('SRI: la nota de crédito supera el plazo máximo de 12 meses desde la emisión del comprobante de sustento.');
        if (!datosNormalizados.numDocModificado && sustento.secuencial) datosNormalizados.numDocModificado = String(sustento.secuencial);
        if (!datosNormalizados.numAutDocModificado && sustento.clave_acceso) datosNormalizados.numAutDocModificado = String(sustento.clave_acceso);
      }

      await supabase.from('documentos_sri_borrador').update({intentos: Number(doc.intentos ?? 0) + 1, ultimo_error:null}).eq('id',doc.id);
      const result:any = await emitirDocumentoSri(doc.emisor_id, doc.tipo, datosNormalizados);
      const estado = result.estado === 'AUTORIZADO' ? 'autorizado' : result.estado === 'DEVUELTA' ? 'devuelto' : 'rechazado';
      await supabase.from('documentos_sri_borrador').update({
        estado,
        secuencial:result.secuencial,
        clave_acceso:result.claveAcceso,
        numero_autorizacion:result.numeroAutorizacion,
        xml_firmado:result.xmlFirmado,
        xml_original:result.xmlOriginal,
        fecha_autorizacion:result.fechaAutorizacion ?? null,
        motivo_error:result.estado==='AUTORIZADO'?null:(result.mensaje??JSON.stringify(result)),
        email_estado: estado === 'autorizado' ? 'pendiente' : 'no_aplica',
        email_detalle: null,
        email_enviado_at: null,
      }).eq('id',doc.id);

      let emailEstado: 'enviado'|'error'|'pendiente'|'no_aplica' = estado === 'autorizado' ? 'pendiente' : 'no_aplica';
      let emailDetalle: string | null = null;
      if (estado === 'autorizado') {
        try {
          const pdf = await obtenerDocumentoSriPdf(doc.id);
          const destinatario = String((datosNormalizados as any).correoElectronico ?? '').trim().toLowerCase();
          const nombreTipo = ({nota_credito:'Nota de crédito',nota_debito:'Nota de débito',liquidacion_compra:'Liquidación de compra',guia_remision:'Guía de remisión',retencion:'Comprobante de retención'} as Record<string,string>)[doc.tipo] ?? 'Comprobante electrónico';
          const asunto = `${nombreTipo} ${result.secuencial} — autorizado por el SRI`;
          const mail = await enviarComprobantePorCorreo({
            to: destinatario,
            subject: asunto,
            html: `<div style="font-family:Arial,sans-serif;color:#172033;max-width:680px;margin:auto"><h2 style="color:#0f2747">${nombreTipo}</h2><p>Su comprobante electrónico <strong>${result.secuencial}</strong> fue autorizado por el SRI.</p><p>Adjuntamos el <strong>RIDE en PDF</strong> y el <strong>XML firmado</strong>.</p><p style="font-size:12px;color:#64748b">Clave de acceso: ${result.claveAcceso ?? '—'}<br>Número de autorización: ${result.numeroAutorizacion ?? '—'}</p></div>`,
            attachments: [
              { filename: pdf.filename, content: pdf.buffer.toString('base64'), type: 'application/pdf' },
              { filename: `${result.claveAcceso ?? doc.id}.xml`, content: Buffer.from(result.xmlFirmado ?? '', 'utf8').toString('base64'), type: 'application/xml' },
            ],
          });
          emailEstado = 'enviado';
          emailDetalle = `ID Resend: ${mail?.id ?? '—'}`;
          await supabase.from('documentos_sri_borrador').update({email_estado:'enviado',email_detalle:emailDetalle,email_enviado_at:new Date().toISOString()}).eq('id',doc.id);
        } catch (emailError) {
          emailEstado = 'error';
          emailDetalle = emailError instanceof Error ? emailError.message : String(emailError);
          await supabase.from('documentos_sri_borrador').update({email_estado:'error',email_detalle:emailDetalle}).eq('id',doc.id);
          request.log.error({ err: emailError, documentoId: doc.id }, 'Documento autorizado por SRI, pero falló el correo.');
        }
      }
      return reply.send({ok:estado==='autorizado',estado,...result,emailEstado,emailDetalle});
    } catch (e) {
      const mensaje=e instanceof Error?e.message:String(e);
      await supabase.from('documentos_sri_borrador').update({estado:'rechazado',motivo_error:mensaje}).eq('id',doc.id);
      return reply.status(422).send({ok:false,error:mensaje});
    }
  });

  /** XML firmado de cualquier comprobante SRI complementario autorizado. */
  app.get<{ Params:{id:string} }>('/api/documentos/:id/xml', async (request, reply) => {
    const { data, error } = await supabase.from('documentos_sri_borrador')
      .select('id,estado,clave_acceso,secuencial,xml_firmado')
      .eq('id',request.params.id).single();
    if (error || !data) return reply.status(404).send({error:'Documento electrónico no encontrado.'});
    if (data.estado !== 'autorizado') return reply.status(409).send({error:'El XML firmado solo está disponible para documentos autorizados por el SRI.'});
    if (!data.xml_firmado) return reply.status(404).send({error:'Este documento no tiene XML firmado guardado.'});
    const nombre = data.clave_acceso || `documento-${data.secuencial || data.id}`;
    return reply.header('Cache-Control','no-store').header('Content-Type','application/xml; charset=utf-8').header('Content-Disposition',`attachment; filename="${nombre}.xml"`).send(data.xml_firmado);
  });

  /** RIDE PDF profesional de cualquier comprobante SRI complementario autorizado. */
  app.get<{ Params:{id:string} }>('/api/documentos/:id/pdf', async (request, reply) => {
    try {
      const pdf = await obtenerDocumentoSriPdf(request.params.id);
      return reply.header('Cache-Control','no-store').header('Content-Type','application/pdf').header('Content-Disposition',`inline; filename="${pdf.filename}"`).send(pdf.buffer);
    } catch (err) {
      return reply.status(409).send({error:'No se pudo generar el PDF del comprobante.',detalle:err instanceof Error ? err.message : String(err)});
    }
  });

  /** Reenvío manual de cualquier comprobante SRI complementario autorizado. */
  app.post<{ Params:{id:string}; Body:{email?:string} }>('/api/documentos/:id/reenviar-email', async (request, reply) => {
    const { data: doc, error } = await supabase.from('documentos_sri_borrador').select('*').eq('id',request.params.id).single();
    if (error || !doc) return reply.status(404).send({error:'Documento electrónico no encontrado.'});
    if (doc.estado !== 'autorizado') return reply.status(409).send({error:'Solo se pueden enviar documentos autorizados por el SRI.'});
    const datos = (doc.datos ?? {}) as Record<string,unknown>;
    const destinatario = String(request.body?.email ?? datos.correoElectronico ?? '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destinatario)) return reply.status(400).send({error:'El correo electrónico no es válido.'});
    try {
      const pdf = await obtenerDocumentoSriPdf(doc.id);
      const tipo = ({nota_credito:'Nota de crédito',nota_debito:'Nota de débito',liquidacion_compra:'Liquidación de compra',guia_remision:'Guía de remisión',retencion:'Comprobante de retención'} as Record<string,string>)[doc.tipo] ?? 'Comprobante electrónico';
      const resultado = await enviarComprobantePorCorreo({
        to: destinatario,
        subject: `${tipo} ${doc.secuencial} — CONTSERTRIB FACTURACIÓN`,
        html: `<div style="font-family:Arial,sans-serif;color:#172033;max-width:680px;margin:auto"><h2>${tipo}</h2><p>Reenvío del comprobante electrónico <strong>${doc.secuencial}</strong>, autorizado por el SRI.</p><p>Se adjuntan RIDE PDF y XML firmado.</p></div>`,
        attachments:[
          {filename:pdf.filename,content:pdf.buffer.toString('base64'),type:'application/pdf'},
          {filename:`${doc.clave_acceso || doc.id}.xml`,content:Buffer.from(String(doc.xml_firmado || ''),'utf8').toString('base64'),type:'application/xml'},
        ],
      });
      await supabase.from('documentos_sri_borrador').update({email_estado:'enviado',email_detalle:`Reenvío manual. ID Resend: ${resultado?.id ?? '—'}`,email_enviado_at:new Date().toISOString()}).eq('id',doc.id);
      return reply.send({ok:true,destinatario,emailId:resultado?.id ?? null,mensaje:'Comprobante reenviado correctamente.'});
    } catch (err) {
      const detalle=err instanceof Error?err.message:String(err);
      await supabase.from('documentos_sri_borrador').update({email_estado:'error',email_detalle:detalle}).eq('id',doc.id);
      return reply.status(502).send({error:'No se pudo reenviar el comprobante por correo.',detalle});
    }
  });

}
