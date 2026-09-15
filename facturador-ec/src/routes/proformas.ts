import type { FastifyInstance } from 'fastify';
import type { FacturaData, TotalTax, FacturaDetail } from 'facturacion-electronica-ec';
import { supabase } from '../db/supabase.js';
import { obtenerPuntoEmisionActivo } from '../db/consultas.js';
import { emitirFactura } from '../services/facturacion.js';
import { generarProformaPdf } from '../services/proformaPdf.js';
import { validarFacturaAntesDeGuardar } from '../services/validacionFacturaSri.js';
import { enviarComprobantePorCorreo } from '../services/email.js';

/**
 * Proformas: cotizaciones sin efecto tributario ni de inventario. Una vez
 * el cliente acepta, `POST /proformas/:id/convertir` la transforma en una
 * venta real, reusando exactamente el mismo camino que `/pos/venta`
 * (función `crear_venta` en Postgres + `emitirFactura`), así que la lógica
 * de negocio (impuestos, inventario, emisión SRI) vive en un solo lugar.
 */

const CONSUMIDOR_FINAL = {
  tipoIdentificacion: '07',
  identificacion: '9999999999999',
  razonSocial: 'CONSUMIDOR FINAL',
};

const CODIGO_PORCENTAJE_IVA: Record<string, string> = { '0': '0', exento: '7', no_objeto: '6' };
const TASA_POR_TARIFA: Record<string, number> = { '0': 0, exento: 0, no_objeto: 0 };

interface ItemProformaBody {
  productoId?: string;
  descripcionLibre?: string;
  precioUnitarioLibre?: number;
  cantidad: number;
  descuento?: number;
}

interface CrearProformaBody {
  emisorId: string;
  cliente?: { tipoIdentificacion: string; identificacion: string; razonSocial: string; email?: string; telefono?: string; direccion?: string };
  items: ItemProformaBody[];
  fechaValidez: string; // 'YYYY-MM-DD'
}

function redondear(v: number): number {
  return Math.round(v * 100) / 100;
}

async function generarNumeroProforma(emisorId: string): Promise<string> {
  const { count } = await supabase
    .from('proformas')
    .select('id', { count: 'exact', head: true })
    .eq('emisor_id', emisorId);
  return 'P-' + String((count ?? 0) + 1).padStart(6, '0');
}

export async function registrarRutasProformas(app: FastifyInstance) {
  /** Crea una proforma (cotización), resolviendo precios reales del catálogo. */
  app.post<{ Body: CrearProformaBody }>('/proformas', async (request, reply) => {
    const body = request.body;
    if (!body?.emisorId) return reply.status(400).send({ error: 'Falta emisorId.' });
    if (!Array.isArray(body.items) || body.items.length === 0) {
      return reply.status(400).send({ error: 'La proforma necesita al menos un ítem.' });
    }
    if (!body.fechaValidez) return reply.status(400).send({ error: 'Falta fechaValidez.' });

    const idsProductos = body.items.map((i) => i.productoId).filter((id): id is string => !!id);
    const productosPorId = new Map<string, { descripcion: string; precio_venta: number; tarifa_iva: string }>();

    if (idsProductos.length > 0) {
      const { data: productos, error: errorProductos } = await supabase
        .from('productos')
        .select('id, descripcion, precio_venta, tarifa_iva')
        .eq('emisor_id', body.emisorId)
        .in('id', idsProductos);
      if (errorProductos) return reply.status(500).send({ error: errorProductos.message });
      for (const p of productos ?? []) productosPorId.set(p.id, p);
      const faltantes = idsProductos.filter((id) => !productosPorId.has(id));
      if (faltantes.length > 0) {
        return reply.status(404).send({ error: `Producto(s) no encontrados: ${faltantes.join(', ')}` });
      }
    }

    const itemsParaGuardar: Array<{
      producto_id: string | null;
      descripcion: string;
      cantidad: number;
      precio_unitario: number;
      descuento: number;
    }> = [];
    let subtotal = 0;
    let totalIva = 0;

    for (const item of body.items) {
      if (!item.cantidad || item.cantidad <= 0) {
        return reply.status(400).send({ error: 'Cada ítem necesita una cantidad mayor a 0.' });
      }
      const descuento = redondear(item.descuento ?? 0);
      let descripcion: string;
      let precioUnitario: number;
      let tarifaIva: string;
      let productoId: string | null = null;

      if (item.productoId) {
        const producto = productosPorId.get(item.productoId)!;
        descripcion = producto.descripcion;
        precioUnitario = Number(producto.precio_venta);
        tarifaIva = producto.tarifa_iva;
        productoId = item.productoId;
      } else {
        if (!item.descripcionLibre || item.precioUnitarioLibre === undefined) {
          return reply.status(400).send({ error: 'Un ítem sin productoId necesita descripcionLibre y precioUnitarioLibre.' });
        }
        descripcion = item.descripcionLibre;
        precioUnitario = item.precioUnitarioLibre;
        tarifaIva = '15';
      }

      const base = redondear(item.cantidad * precioUnitario - descuento);
      const iva = tarifaIva === '15' ? redondear(base * 0.15) : 0;
      subtotal = redondear(subtotal + base);
      totalIva = redondear(totalIva + iva);

      itemsParaGuardar.push({ producto_id: productoId, descripcion, cantidad: item.cantidad, precio_unitario: precioUnitario, descuento });
    }

    const total = redondear(subtotal + totalIva);
    const datosCliente = body.cliente ?? CONSUMIDOR_FINAL;
    const correoProforma = String((datosCliente as any).email ?? '').trim().toLowerCase();
    if (!correoProforma || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correoProforma)) return reply.status(400).send({ error: 'El correo electrónico del cliente es obligatorio y debe ser válido para crear una proforma.' });

    const { data: cliente, error: errorCliente } = await supabase
      .from('clientes')
      .upsert(
        {
          emisor_id: body.emisorId,
          tipo_identificacion: datosCliente.tipoIdentificacion,
          identificacion: datosCliente.identificacion,
          razon_social: datosCliente.razonSocial,
          email: correoProforma,
          telefono: (datosCliente as { telefono?: string }).telefono ?? null,
          direccion: (datosCliente as { direccion?: string }).direccion ?? null,
        },
        { onConflict: 'emisor_id,tipo_identificacion,identificacion' }
      )
      .select('id')
      .single();
    if (errorCliente || !cliente) {
      return reply.status(500).send({ error: errorCliente?.message ?? 'No se pudo resolver el cliente.' });
    }

    const numeroProforma = await generarNumeroProforma(body.emisorId);

    const { data: proforma, error: errorProforma } = await supabase
      .from('proformas')
      .insert({
        emisor_id: body.emisorId,
        numero_proforma: numeroProforma,
        cliente_id: cliente.id,
        fecha_validez: body.fechaValidez,
        subtotal,
        total,
        estado: 'vigente',
      })
      .select('id, numero_proforma')
      .single();
    if (errorProforma || !proforma) {
      return reply.status(500).send({ error: errorProforma?.message ?? 'No se pudo crear la proforma.' });
    }

    const { error: errorItems } = await supabase
      .from('proforma_items')
      .insert(itemsParaGuardar.map((i) => ({ ...i, proforma_id: proforma.id })));
    if (errorItems) {
      return reply.status(500).send({ error: errorItems.message, proformaId: proforma.id });
    }

    // La proforma debe llegar automáticamente al correo que el solicitante
    // indicó. Se genera el PDF DESPUÉS de guardar cabecera e ítems para que
    // el documento adjunto contenga exactamente la información registrada.
    let correoEnviado = false;
    let errorCorreo = '';
    try {
      const pdf = await generarProformaPdf(proforma.id);
      await enviarComprobantePorCorreo({
        to: correoProforma,
        subject: `Proforma ${proforma.numero_proforma} · CONTSERTRIB FACTURACIÓN`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:680px;margin:auto;color:#1f2937">
            <h2 style="color:#102a43">Proforma ${proforma.numero_proforma}</h2>
            <p>Estimado/a <strong>${String(datosCliente.razonSocial).replace(/[<>]/g, '')}</strong>:</p>
            <p>Adjuntamos su proforma/cotización generada en CONTSERTRIB FACTURACIÓN.</p>
            <p><strong>Total:</strong> $${total.toFixed(2)}</p>
            <p>La proforma es una cotización y no constituye un comprobante electrónico autorizado por el SRI.</p>
          </div>`,
        attachments: [{ filename: `${proforma.numero_proforma}.pdf`, content: pdf.toString('base64'), type: 'application/pdf' }],
      });
      correoEnviado = true;
    } catch (err) {
      // No se pierde la proforma si el proveedor de correo falla. La creación
      // queda registrada y devolvemos el motivo para que la interfaz pueda
      // informar al usuario y permitir reenvío.
      errorCorreo = err instanceof Error ? err.message : String(err);
    }

    return reply.status(201).send({ id: proforma.id, numeroProforma: proforma.numero_proforma, subtotal, totalIva, total, correoEnviado, errorCorreo: errorCorreo || undefined });
  });

  app.get<{ Params: { id: string } }>('/proformas/:id/pdf', async (request, reply) => {
    try { const pdf=await generarProformaPdf(request.params.id); reply.header('Content-Type','application/pdf').header('Content-Disposition',`inline; filename="Proforma-${request.params.id}.pdf"`); return reply.send(pdf); }
    catch(e){ return reply.status(404).send({error:e instanceof Error?e.message:String(e)}); }
  });

  /** Reenvía manualmente una proforma al correo registrado del solicitante. */
  app.post<{ Params: { id: string } }>('/proformas/:id/enviar-email', async (request, reply) => {
    try {
      const { data: p, error } = await supabase.from('proformas').select('*, clientes(*)').eq('id', request.params.id).single();
      if (error || !p) return reply.status(404).send({ error: 'Proforma no encontrada.' });
      const cliente = p.clientes as any;
      const to = String(cliente?.email ?? '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return reply.status(400).send({ error: 'La proforma no tiene un correo válido registrado.' });
      const pdf = await generarProformaPdf(p.id);
      await enviarComprobantePorCorreo({
        to,
        subject: `Proforma ${p.numero_proforma} · CONTSERTRIB FACTURACIÓN`,
        html: `<div style="font-family:Arial,sans-serif;max-width:680px;margin:auto"><h2>Proforma ${p.numero_proforma}</h2><p>Adjuntamos nuevamente su proforma/cotización.</p><p><strong>Total:</strong> $${Number(p.total || 0).toFixed(2)}</p></div>`,
        attachments: [{ filename: `${p.numero_proforma}.pdf`, content: pdf.toString('base64'), type: 'application/pdf' }],
      });
      return reply.send({ ok: true, mensaje: 'Proforma enviada correctamente.', destinatario: to });
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  /** Lista las proformas de un emisor. */
  app.get<{ Querystring: { emisorId?: string } }>('/proformas/listado', async (request, reply) => {
    const { emisorId } = request.query;
    if (!emisorId) return reply.status(400).send({ error: 'Falta el parámetro emisorId.' });

    const { data, error } = await supabase
      .from('proformas')
      .select('id, numero_proforma, fecha_emision, fecha_validez, estado, total, clientes(razon_social)')
      .eq('emisor_id', emisorId)
      .order('fecha_emision', { ascending: false });

    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(data);
  });

  /** Detalle completo de una proforma (para verla o imprimirla). */
  app.get<{ Params: { id: string } }>('/proformas/:id', async (request, reply) => {
    const { data, error } = await supabase
      .from('proformas')
      .select('*, clientes(*), proforma_items(*)')
      .eq('id', request.params.id)
      .single();
    if (error || !data) return reply.status(404).send({ error: 'Proforma no encontrada.' });
    return reply.send(data);
  });

  /** Convierte una proforma vigente en una venta real: crea el comprobante (con inventario) y lo emite ante el SRI. */
  app.post<{ Params: { id: string } }>('/proformas/:id/convertir', async (request, reply) => {
    const { data: proforma, error: errorProforma } = await supabase
      .from('proformas')
      .select('*, clientes(*), proforma_items(*)')
      .eq('id', request.params.id)
      .single();

    if (errorProforma || !proforma) return reply.status(404).send({ error: 'Proforma no encontrada.' });
    if (proforma.estado !== 'vigente') {
      return reply.status(409).send({ error: `Esta proforma ya está en estado "${proforma.estado}" y no se puede convertir.` });
    }

    let puntoEmision;
    try {
      puntoEmision = await obtenerPuntoEmisionActivo(proforma.emisor_id);
    } catch (err) {
      return reply.status(404).send({ error: err instanceof Error ? err.message : String(err) });
    }

    // Se honran los precios ORIGINALES cotizados en la proforma, no los
    // precios actuales del catálogo — el cliente aceptó esa cotización.
    // La tarifa de IVA sí se resuelve fresca desde el producto (no cambia
    // con frecuencia y no se guarda por línea en `proforma_items`).
    const idsProductos = (proforma.proforma_items as Array<{ producto_id: string | null }>)
      .map((i) => i.producto_id)
      .filter((id): id is string => !!id);

    const { data: cfgIva } = await supabase.from('configuracion_iva').select('tarifa_general,codigo_general,tarifa_reducida,codigo_reducida,tarifa_turismo,codigo_turismo,turismo_habilitado').eq('emisor_id', proforma.emisor_id).maybeSingle();
    const ivaCfg = {
      general: Number(cfgIva?.tarifa_general ?? 15), generalCodigo: String(cfgIva?.codigo_general ?? '4'),
      reducida: Number(cfgIva?.tarifa_reducida ?? 5), reducidaCodigo: String(cfgIva?.codigo_reducida ?? '5'),
      turismo: Number(cfgIva?.tarifa_turismo ?? 8), turismoCodigo: String(cfgIva?.codigo_turismo ?? '8'),
    };
    const resolverIva = (tarifa:string) => {
      if (tarifa === '0' || tarifa === 'exento' || tarifa === 'no_objeto') return { codigo: CODIGO_PORCENTAJE_IVA[tarifa], tasa: 0 };
      if (tarifa === '5') return { codigo: ivaCfg.reducidaCodigo, tasa: ivaCfg.reducida / 100 };
      if (tarifa === '8') return { codigo: ivaCfg.turismoCodigo, tasa: ivaCfg.turismo / 100 };
      return { codigo: ivaCfg.generalCodigo, tasa: ivaCfg.general / 100 };
    };
    const tarifasPorProducto = new Map<string, string>();
    const codigosPorProducto = new Map<string, string>();
    if (idsProductos.length > 0) {
      const { data: productos } = await supabase.from('productos').select('id, codigo_principal, tarifa_iva').in('id', idsProductos);
      for (const p of productos ?? []) {
        tarifasPorProducto.set(p.id, p.tarifa_iva);
        codigosPorProducto.set(p.id, p.codigo_principal);
      }
    }

    let subtotal0 = 0;
    let subtotal5 = 0;
    let subtotal8 = 0;
    let subtotal15 = 0;
    let totalDescuento = 0;
    let totalIva = 0;
    const itemsParaGuardar: Array<Record<string, unknown>> = [];
    const detallesFactura: FacturaDetail[] = [];

    for (const item of proforma.proforma_items as Array<{
      producto_id: string | null;
      descripcion: string;
      cantidad: number;
      precio_unitario: number;
      descuento: number;
    }>) {
      const tarifaIva = item.producto_id ? tarifasPorProducto.get(item.producto_id) ?? '15' : '15';
      const base = redondear(item.cantidad * item.precio_unitario - item.descuento);
      const iva = resolverIva(tarifaIva);
      if (iva.codigo === '8') {
        const fechaVenta = new Date().toISOString().slice(0,10);
        const { data: vigencia8, error: errorVigencia8 } = await supabase.from('catalogo_iva_sri').select('id').eq('codigo_porcentaje','8').eq('activo',true).lte('fecha_desde',fechaVenta).or(`fecha_hasta.is.null,fecha_hasta.gte.${fechaVenta}`).limit(1);
        if (errorVigencia8) return reply.status(500).send({ error:`No se pudo validar la vigencia del IVA turismo 8%: ${errorVigencia8.message}` });
        if (!vigencia8?.length || !Boolean((cfgIva as any)?.turismo_habilitado)) return reply.status(400).send({ error:'La tarifa IVA 8% turismo no está habilitada/vigente para la fecha de conversión de esta proforma.' });
      }
      const codigoPorcentaje = iva.codigo;
      const porcentaje = iva.tasa;
      const valorIva = redondear(base * porcentaje);

      if (tarifaIva === '15') subtotal15 = redondear(subtotal15 + base);
      else if (tarifaIva === '8') subtotal8 = redondear(subtotal8 + base);
      else if (tarifaIva === '5') subtotal5 = redondear(subtotal5 + base);
      else subtotal0 = redondear(subtotal0 + base);
      totalDescuento = redondear(totalDescuento + item.descuento);
      totalIva = redondear(totalIva + valorIva);

      itemsParaGuardar.push({
        producto_id: item.producto_id,
        descripcion: item.descripcion,
        cantidad: item.cantidad,
        precio_unitario: item.precio_unitario,
        descuento: item.descuento,
        precio_total_sin_impuesto: base,
        costo_unitario_momento: 0,
        tarifa_iva: tarifaIva,
        valor_iva: valorIva,
      });

      detallesFactura.push({
        // El SRI exige codigoPrincipal de máximo 25 caracteres — nunca el
        // id interno (UUID, 36 caracteres) del producto.
        codigoPrincipal: item.producto_id ? (() => { const codigo = codigosPorProducto.get(item.producto_id) ?? 'VARIOS'; if (codigo.length > 25) throw new Error(`El producto ${item.descripcion} tiene un código principal de más de 25 caracteres. Corrígelo antes de convertir la proforma.`); return codigo; })() : 'VARIOS',
        descripcion: item.descripcion,
        cantidad: item.cantidad,
        precioUnitario: item.precio_unitario,
        descuento: item.descuento,
        precioTotalSinImpuesto: base,
        impuestos: [{ codigo: '2', codigoPorcentaje, tarifa: porcentaje * 100, baseImponible: base, valor: valorIva }],
      });
    }

    const totalSinImpuestos = redondear(subtotal0 + subtotal5 + subtotal8 + subtotal15);
    const importeTotal = redondear(totalSinImpuestos + totalIva);

    validarFacturaAntesDeGuardar({
      identificacionComprador: String((proforma.clientes as any)?.identificacion ?? ''),
      razonSocialComprador: String((proforma.clientes as any)?.razon_social ?? ''),
      direccionComprador: String((proforma.clientes as any)?.direccion ?? '') || undefined,
      detalles: detallesFactura.map((d) => ({ codigoPrincipal:String(d.codigoPrincipal), descripcion:String(d.descripcion), cantidad:Number(d.cantidad), precioUnitario:Number(d.precioUnitario), descuento:Number(d.descuento), precioTotalSinImpuesto:Number(d.precioTotalSinImpuesto) })),
      pagos: [{ formaPago:'01', total:importeTotal }],
      importeTotal,
    });

    const { data: comprobanteId, error: errorVenta } = await supabase.rpc('crear_venta', {
      p_emisor_id: proforma.emisor_id,
      p_punto_emision_id: puntoEmision.id,
      p_cliente_id: proforma.cliente_id,
      p_tipo: 'factura',
      p_subtotal_0: subtotal0,
      p_subtotal_5: subtotal5,
      p_subtotal_8: subtotal8,
      p_subtotal_15: subtotal15,
      p_total_descuento: totalDescuento,
      p_total_iva: totalIva,
      p_propina: 0,
      p_importe_total: importeTotal,
      p_items: itemsParaGuardar,
      p_pagos: [{ forma_pago_codigo: '01', valor: importeTotal }],
    });

    if (errorVenta || !comprobanteId) {
      const mensaje = errorVenta?.message ?? '';
      if (mensaje.includes('stock_insuficiente')) {
        return reply.status(409).send({ error: 'No hay stock suficiente para convertir esta proforma en venta.' });
      }
      return reply.status(500).send({ error: mensaje || 'No se pudo crear la venta a partir de la proforma.' });
    }

    const cliente = proforma.clientes as { tipo_identificacion: string; identificacion: string; razon_social: string; direccion: string | null };
    // Los totales del XML se agrupan por código de porcentaje, no solo por
    // tarifa. Esto conserva correctamente EXENTO (7) y NO OBJETO (6), que no
    // pueden transformarse en IVA 0% (0).
    const gruposTotales = new Map<string, { base: number; valor: number; tarifa: number }>();
    for (const d of detallesFactura) {
      const codigo = String(d.impuestos?.[0]?.codigoPorcentaje ?? '0');
      const base = Number(d.impuestos?.[0]?.baseImponible ?? d.precioTotalSinImpuesto ?? 0);
      const valor = Number(d.impuestos?.[0]?.valor ?? 0);
      const tarifa = Number(d.impuestos?.[0]?.tarifa ?? 0);
      const g = gruposTotales.get(codigo) ?? { base: 0, valor: 0, tarifa };
      g.base = redondear(g.base + base); g.valor = redondear(g.valor + valor); g.tarifa = tarifa;
      gruposTotales.set(codigo, g);
    }
    const totalConImpuestos: TotalTax[] = [...gruposTotales.entries()].map(([codigoPorcentaje,g]) => ({ codigo:'2', codigoPorcentaje, tarifa:g.tarifa, baseImponible:g.base, valor:g.valor }));

    const hoy = new Date();
    const fechaEmision = `${String(hoy.getDate()).padStart(2, '0')}/${String(hoy.getMonth() + 1).padStart(2, '0')}/${hoy.getFullYear()}`;

    const facturaData: FacturaData = {
      fechaEmision,
      tipoIdentificacionComprador: cliente.tipo_identificacion,
      razonSocialComprador: cliente.razon_social,
      identificacionComprador: cliente.identificacion,
      direccionComprador: cliente.direccion ?? undefined,
      totalSinImpuestos,
      totalDescuento,
      totalConImpuestos,
      propina: 0,
      importeTotal,
      pagos: [{ formaPago: '01', total: importeTotal }],
      detalles: detallesFactura,
    };

    try {
      const resultado = await emitirFactura({ emisorId: proforma.emisor_id, comprobanteId: comprobanteId as string, facturaData });

      await supabase
        .from('proformas')
        .update({ estado: 'convertida', comprobante_generado_id: comprobanteId })
        .eq('id', proforma.id);

      return reply.status(201).send({
        comprobanteId,
        estado: resultado.estado,
        claveAcceso: resultado.claveAcceso,
        secuencial: resultado.secuencial,
        numeroAutorizacion: resultado.numeroAutorizacion,
        importeTotal,
      });
    } catch (err) {
      return reply.status(502).send({
        comprobanteId,
        error: 'La venta se registró pero no se pudo emitir el comprobante ante el SRI.',
        detalle: err instanceof Error ? err.message : String(err),
      });
    }
  });
}
