import type { FastifyInstance } from 'fastify';
import { supabase } from '../db/supabase.js';
import { comprobarLimiteDocumentos } from '../services/saas.js';
import { emitirDocumentoSri, consultarAutorizacionDocumentoSri, normalizarDatosDocumento, validarDatosDocumento } from '../services/documentosSri.js';
import { obtenerDocumentoSriPdf } from '../services/documentoSriPdf.js';
import { enviarComprobantePorCorreo } from '../services/email.js';

const TIPOS = new Set(['nota_credito','nota_debito','liquidacion_compra','guia_remision','retencion']);
const ESTADOS = new Set(['borrador','listo','procesando','autorizado','rechazado','devuelto','anulado']);

/**
 * Actualización resiliente del borrador SRI.
 *
 * Las columnas de control de procesamiento son nuevas respecto de instalaciones
 * antiguas. Si PostgREST todavía no conoce una columna opcional, nunca debemos
 * perder la persistencia crítica (clave + XML) por intentar guardar el estado
 * operativo en la misma petición.
 */
async function actualizarBorradorSeguro(id: string, cambios: Record<string, unknown>) {
  const primero = await supabase.from('documentos_sri_borrador').update(cambios).eq('id', id);
  if (!primero.error) return { error: null, fallback: false };

  const msg = primero.error.message ?? '';
  const faltante = /schema cache|Could not find the .* column|column .* does not exist/i.test(msg);
  if (!faltante) return { error: primero.error, fallback: false };

  // Campos no críticos para impedir la retransmisión. La clave/XML sí deben
  // conservarse; se reintenta sin metadatos nuevos que una BD antigua aún no tenga.
  const { recepcion_sri: _recepcion, ...sinRecepcion } = cambios as any;
  const segundo = await supabase.from('documentos_sri_borrador').update(sinRecepcion).eq('id', id);
  return { error: segundo.error ?? null, fallback: true };
}

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
    if(doc.estado === 'procesando') return reply.status(409).send({error:'El documento está en PROCESAMIENTO. Por seguridad no se retransmitirá automáticamente. Usa “Consultar SRI” para verificar su estado o revisa el XML original antes de cualquier nueva emisión.'});
    const consumo = await comprobarLimiteDocumentos(doc.emisor_id);
    if (!consumo.ok) return reply.status(402).send({error:consumo.mensaje,consumo:consumo.usados,limite:consumo.limite,plan:consumo.plan});
    await supabase.from('documentos_sri_borrador').update({estado:'procesando',motivo_error:null}).eq('id',doc.id);
    let transmisionIniciada = false;
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
      const result:any = await emitirDocumentoSri(doc.emisor_id, doc.tipo, datosNormalizados, async (preparado) => {
        const persistencia = await actualizarBorradorSeguro(doc.id, {
          secuencial: preparado.secuencial,
          clave_acceso: preparado.claveAcceso,
          xml_original: preparado.xmlOriginal,
          recepcion_sri: 'PENDIENTE_TRANSMISION',
          ultimo_error: null,
        });
        if (persistencia.error) throw new Error(`No se pudo guardar la clave de acceso y el XML original antes de transmitir: ${persistencia.error.message}. El documento NO fue transmitido al SRI. Ejecute la migración de compatibilidad de v9.9.38 y recargue el esquema PostgREST.`);
      }, async () => {
        transmisionIniciada = true;
        await actualizarBorradorSeguro(doc.id, {recepcion_sri:'TRANSMISION_INICIADA'});
      });
      const estado = result.estado === 'AUTORIZADO' ? 'autorizado' : result.estado === 'DEVUELTA' ? 'devuelto' : ['EN PROCESAMIENTO','PROCESANDO','PENDIENTE'].includes(String(result.estado).toUpperCase()) ? 'procesando' : 'rechazado';
      await actualizarBorradorSeguro(doc.id, {
        estado,
        secuencial:result.secuencial,
        clave_acceso:result.claveAcceso,
        numero_autorizacion:result.numeroAutorizacion,
        xml_firmado:result.xmlFirmado,
        xml_original:result.xmlOriginal,
        fecha_autorizacion:result.fechaAutorizacion ?? null,
        motivo_error:estado==='autorizado'||estado==='procesando'?null:(result.mensaje??JSON.stringify(result)),
        recepcion_sri: estado==='autorizado' ? 'AUTORIZADO' : estado==='procesando' ? 'EN PROCESAMIENTO' : estado==='devuelto' ? 'DEVUELTA' : 'NO AUTORIZADO',
        email_estado: estado === 'autorizado' ? 'pendiente' : 'no_aplica',
        email_detalle: null,
        email_enviado_at: null,
      });

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
      return reply.send({ok:estado==='autorizado',estado,...result,emailEstado,emailDetalle,mensaje:result.mensaje});
    } catch (e) {
      const mensaje=e instanceof Error?e.message:String(e);
      if (transmisionIniciada) {
        // Una excepción después de iniciar la transmisión NO significa rechazo.
        // El SRI puede haber recibido el XML; queda bloqueado para evitar duplicados
        // y el operador debe consultar por la misma clave de acceso.
        await actualizarBorradorSeguro(doc.id, {
          estado:'procesando',
          motivo_error:`La transmisión fue iniciada pero no se obtuvo respuesta definitiva: ${mensaje}`,
          ultimo_error:mensaje,
          recepcion_sri:'SIN_RESPUESTA_DEFINITIVA',
        });
        return reply.status(202).send({ok:false,estado:'procesando',retransmisionBloqueada:true,error:'La transmisión al SRI fue iniciada pero no se pudo confirmar el resultado. NO se retransmitirá automáticamente. Consulte el SRI usando la clave de acceso guardada.',mensaje});
      }
      await actualizarBorradorSeguro(doc.id, {estado:'rechazado',motivo_error:mensaje,ultimo_error:mensaje,recepcion_sri:'NO TRANSMITIDO'});
      return reply.status(422).send({ok:false,error:mensaje});
    }
  });

  /** Reconsulta un comprobante que quedó procesando. No vuelve a transmitirlo al SRI. */
  app.post<{ Params:{id:string} }>('/api/documentos/:id/consultar-sri', async (request, reply) => {
    const { data: doc, error } = await supabase.from('documentos_sri_borrador')
      .select('id,emisor_id,estado,clave_acceso,secuencial,xml_firmado,xml_original,datos,tipo')
      .eq('id', request.params.id).single();
    if (error || !doc) return reply.status(404).send({error:'Documento electrónico no encontrado.'});
    if (doc.estado === 'autorizado') return reply.send({ok:true,estado:'autorizado',secuencial:doc.secuencial,claveAcceso:doc.clave_acceso,numeroAutorizacion:null,mensaje:'El documento ya consta como autorizado.'});
    let claveAcceso = String(doc.clave_acceso ?? '').trim();
    const fuentesXml = [doc.xml_original, doc.xml_firmado].filter(Boolean).map(String);
    // Recuperación segura para documentos antiguos: buscamos la misma clave de
    // acceso en cualquiera de los XML ya almacenados. Nunca generamos una nueva
    // clave para un comprobante que quedó en procesamiento.
    if (!/^\d{49}$/.test(claveAcceso)) {
      for (const xmlGuardado of fuentesXml) {
        const m = xmlGuardado.match(/<claveAcceso>\s*(\d{49})\s*<\/claveAcceso>/i);
        if (m?.[1]) { claveAcceso = m[1]; break; }
      }
    }
    if (!/^\d{49}$/.test(claveAcceso)) {
      return reply.status(409).send({
        ok:false,
        estado:'procesando',
        requiereRevisionManual:true,
        retransmisionBloqueada:true,
        error:'Este documento quedó procesando y no se pudo recuperar una clave de acceso válida. Por seguridad NO se generará otra clave ni se retransmitirá automáticamente. Revise el XML original, confirme el estado en el SRI y, si corresponde, corrija el borrador y emítalo manualmente.',
      });
    }
    if (claveAcceso !== String(doc.clave_acceso ?? '').trim()) {
      await actualizarBorradorSeguro(doc.id, {clave_acceso:claveAcceso});
    }
    const r = await consultarAutorizacionDocumentoSri(doc.emisor_id, claveAcceso);
    const estado = r.estado === 'AUTORIZADO' ? 'autorizado' : r.estado === 'DEVUELTA' ? 'devuelto' : ['NO AUTORIZADO','RECHAZADA'].includes(r.estado) ? 'rechazado' : 'procesando';
    const patch:any = { estado, numero_autorizacion:r.numeroAutorizacion, fecha_autorizacion:r.fechaAutorizacion ? r.fechaAutorizacion.toISOString() : null, motivo_error: estado==='autorizado' ? null : (r.mensaje || null) };
    if (estado !== 'autorizado') patch.ultimo_error = r.mensaje || null;
    await actualizarBorradorSeguro(doc.id, patch);
    return reply.send({ok:estado==='autorizado',estado,numeroAutorizacion:r.numeroAutorizacion,fechaAutorizacion:r.fechaAutorizacion,mensaje:r.mensaje});
  });

  /** Ticket compacto para impresión térmica. No reemplaza al RIDE ni cambia el comprobante. */
  app.get<{ Params:{id:string} }>('/api/documentos/:id/ticket', async (request, reply) => {
    try {
      const { data:d, error } = await supabase.from('documentos_sri_borrador')
        .select('id,emisor_id,tipo,estado,secuencial,clave_acceso,numero_autorizacion,fecha_autorizacion,created_at,datos,emisores(razon_social,nombre_comercial,ruc,direccion_matriz)')
        .eq('id',request.params.id).single();
      if(error || !d) return reply.status(404).type('text/plain').send('Documento electrónico no encontrado.');
      const datos:any=d.datos||{}; const emisor:any=d.emisores||{}; const {data:confProv}=await supabase.from('configuracion_sistema').select('ruc_proveedor_facturacion,incluir_ruc_proveedor').eq('emisor_id',d.emisor_id).maybeSingle(); const rucProveedor=process.env.RUC_PROVEEDOR_FACTURACION?.trim()||String(confProv?.ruc_proveedor_facturacion??'').trim();
      const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,(m)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'} as any)[m]);
      const money=(v:unknown)=>Number(v??0).toFixed(2);
      const tipo=({nota_credito:'NOTA DE CRÉDITO',nota_debito:'NOTA DE DÉBITO',liquidacion_compra:'LIQUIDACIÓN DE COMPRA',guia_remision:'GUÍA DE REMISIÓN',retencion:'COMPROBANTE DE RETENCIÓN'} as Record<string,string>)[d.tipo]||String(d.tipo).toUpperCase();
      const autorizado=String(d.estado).toLowerCase()==='autorizado';
      const detalles:any[]=Array.isArray(datos.detalles)?datos.detalles:[];
      const dest:any[]=Array.isArray(datos.destinatarios)?datos.destinatarios:[];
      const filas=detalles.map((x:any)=>`<tr><td>${esc(x.codigoPrincipal??x.codigo??'')}</td><td>${esc(x.descripcion??'')}</td><td class="r">${money(x.cantidad)}</td><td class="r">${money(x.precioTotalSinImpuesto??x.valor??0)}</td></tr>`).join('');
      const extra=d.tipo==='guia_remision'?`<div class="box"><b>TRASLADO</b><div>Salida: ${esc(datos.fechaIniTransporte||'—')} ${esc(datos.horaSalida||'')}</div><div>Llegada: ${esc(datos.fechaFinTransporte||'—')} ${esc(datos.horaLlegada||'')}</div><div>Origen: ${esc(datos.dirPartida||'—')}</div><div>Destino: ${esc(datos.dirLlegada||'—')}</div><div>Transportista: ${esc(datos.razonSocialTransportista||'—')} · ${esc(datos.rucTransportista||'')}</div><div>Placa: ${esc(datos.placa||'—')}</div></div>` : dest.length?`<div class="box"><b>DESTINATARIOS</b>${dest.map((x:any)=>`<div>${esc(x.razonSocialDestinatario||'—')} · ${esc(x.identificacionDestinatario||'')}<br>${esc(x.dirDestinatario||'')} · ${esc(x.motivoTraslado||'')}</div>`).join('')}</div>`:'';
      const cliente=datos.razonSocialComprador||datos.razonSocialProveedor||datos.razonSocialSujetoRetenido||'—';
      const identificacion=datos.identificacionComprador||datos.identificacionProveedor||datos.identificacionSujetoRetenido||'—';
      const total=datos.importeTotal??datos.valorTotal??datos.valorModificacion??0;
      const html=`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(tipo)} ${esc(d.secuencial)}</title><style>@page{size:80mm auto;margin:0}*{box-sizing:border-box}body{width:80mm;margin:0 auto;padding:3.5mm;font:10px Arial,sans-serif;color:#111}.center{text-align:center}.brand{font-weight:800;font-size:13px}.muted{font-size:8px;color:#555}.line{border-top:1px dashed #222;margin:5px 0}.box{border:1px solid #777;border-radius:3px;padding:4px;margin:5px 0}.box b{display:block;font-size:9px;margin-bottom:3px}table{width:100%;border-collapse:collapse;font-size:8.5px}th,td{padding:2.5px 0;border-bottom:1px solid #ddd;text-align:left;vertical-align:top}th{font-size:8px}.r{text-align:right}.total{font-size:12px;font-weight:800}.draft{background:#fff3cd;border:1px solid #d9a441;padding:4px;text-align:center;font-weight:800}.print{position:fixed;right:10px;top:10px;background:#102a43;color:white;border:0;border-radius:6px;padding:8px 10px}@media print{.print{display:none}body{width:80mm}}</style></head><body><button class="print" onclick="window.print()">🖨 Imprimir</button><div class="center"><div class="brand">${esc(emisor.nombre_comercial||emisor.razon_social||'CONTSERTRIB')}</div><div>R.U.C. ${esc(emisor.ruc||'')}</div><div class="muted">${esc(emisor.direccion_matriz||'')}</div></div><div class="line"></div><div class="center"><b>${esc(tipo)}</b><br>No. ${esc(d.secuencial||'BORRADOR')}<br><span class="muted">${autorizado?'AUTORIZADO':'BORRADOR · SIN VALIDEZ TRIBUTARIA'}</span></div>${autorizado?`<div class="box"><b>AUTORIZACIÓN</b>${esc(d.numero_autorizacion||d.clave_acceso||'—')}<br><span class="muted">${esc(d.fecha_autorizacion||'')}</span></div>`:'<div class="draft">BORRADOR — SIN VALIDEZ TRIBUTARIA</div>'}<div class="box"><b>RECEPTOR / SUJETO</b>${esc(cliente)}<br>${esc(identificacion)}<br>${esc(datos.direccionComprador||datos.direccionProveedor||'')}</div>${rucProveedor&&confProv?.incluir_ruc_proveedor!==false?`<div class="box"><b>INFORMACIÓN ADICIONAL</b>RUC Proveedor: ${esc(rucProveedor)}</div>`:''}${extra}${detalles.length?`<div class="line"></div><table><thead><tr><th>Código</th><th>Descripción</th><th class="r">Cant.</th><th class="r">Total</th></tr></thead><tbody>${filas}</tbody></table>`:''}<div class="line"></div><div class="r">TOTAL: <span class="total">$${money(total)}</span></div>${d.clave_acceso?`<div class="line"></div><div class="center muted">Clave de acceso<br>${esc(d.clave_acceso)}</div>`:''}<div class="line"></div><div class="center muted">Ticket de impresión informativo.<br>${autorizado?'Comprobante electrónico autorizado por el SRI.':'Documento no autorizado por el SRI.'}</div></body></html>`;
      return reply.header('Cache-Control','no-store').type('text/html; charset=utf-8').send(html);
    } catch(err) { return reply.status(409).type('text/plain').send(err instanceof Error?err.message:String(err)); }
  });

  /** XML firmado: solo se entrega cuando el SRI autorizó el documento. */
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

  /** PDF de comprobantes SRI: autorizado o borrador para revisión previa. */
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
