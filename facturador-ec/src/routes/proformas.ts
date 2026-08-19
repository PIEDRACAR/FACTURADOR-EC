import type { FastifyInstance } from 'fastify';
import type { FacturaData, TotalTax, FacturaDetail } from 'facturacion-electronica-ec';
import { supabase } from '../db/supabase.js';
import { obtenerPuntoEmisionActivo } from '../db/consultas.js';
import { emitirFactura } from '../services/facturacion.js';

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

const CODIGO_PORCENTAJE_IVA: Record<string, string> = { '0': '0', '5': '5', '15': '4', exento: '7', no_objeto: '6' };
const TASA_POR_TARIFA: Record<string, number> = { '0': 0, '5': 0.05, '15': 0.15, exento: 0, no_objeto: 0 };

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

    const { data: cliente, error: errorCliente } = await supabase
      .from('clientes')
      .upsert(
        {
          emisor_id: body.emisorId,
          tipo_identificacion: datosCliente.tipoIdentificacion,
          identificacion: datosCliente.identificacion,
          razon_social: datosCliente.razonSocial,
          email: (datosCliente as { email?: string }).email ?? null,
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

    return reply.status(201).send({ id: proforma.id, numeroProforma: proforma.numero_proforma, subtotal, totalIva, total });
  });

  /** Lista las proformas de un emisor. */
  app.get<{ Querystring: { emisorId?: string } }>('/proformas/listado', async (request, reply) => {
    const { emisorId } = request.query;
    if (!emisorId) return reply.status(400).send({ error: 'Falta el parámetro emisorId.' });

    const { data, error } = await supabase
      .from('proformas')
      .select('id, numero_proforma, fecha_emision, fecha_validez, estado, total, clientes(razon_social)')
      .eq('emisor_id', emisorId)
      .order('created_at', { ascending: false });

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
      const codigoPorcentaje = CODIGO_PORCENTAJE_IVA[tarifaIva] ?? '4';
      const porcentaje = TASA_POR_TARIFA[tarifaIva] ?? 0;
      const valorIva = redondear(base * porcentaje);

      if (tarifaIva === '15') subtotal15 = redondear(subtotal15 + base);
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
        codigoPrincipal: item.producto_id ? (codigosPorProducto.get(item.producto_id) ?? 'VARIOS').slice(0, 25) : 'VARIOS',
        descripcion: item.descripcion,
        cantidad: item.cantidad,
        precioUnitario: item.precio_unitario,
        descuento: item.descuento,
        precioTotalSinImpuesto: base,
        impuestos: [{ codigo: '2', codigoPorcentaje, tarifa: porcentaje * 100, baseImponible: base, valor: valorIva }],
      });
    }

    const totalSinImpuestos = redondear(subtotal0 + subtotal5 + subtotal15);
    const importeTotal = redondear(totalSinImpuestos + totalIva);

    const { data: comprobanteId, error: errorVenta } = await supabase.rpc('crear_venta', {
      p_emisor_id: proforma.emisor_id,
      p_punto_emision_id: puntoEmision.id,
      p_cliente_id: proforma.cliente_id,
      p_tipo: 'factura',
      p_subtotal_0: subtotal0,
      p_subtotal_5: subtotal5,
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
    const totalConImpuestos: TotalTax[] = [];
    if (subtotal0 > 0) totalConImpuestos.push({ codigo: '2', codigoPorcentaje: '0', baseImponible: subtotal0, valor: 0 });
    if (subtotal5 > 0) totalConImpuestos.push({ codigo: '2', codigoPorcentaje: '5', baseImponible: subtotal5, valor: redondear(subtotal5 * 0.05) });
    if (subtotal15 > 0) totalConImpuestos.push({ codigo: '2', codigoPorcentaje: '4', baseImponible: subtotal15, valor: redondear(subtotal15 * 0.15) });

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
