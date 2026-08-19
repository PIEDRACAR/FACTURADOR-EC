import type { FastifyInstance } from 'fastify';
import type { FacturaData, TotalTax, FacturaDetail } from 'facturacion-electronica-ec';
import { supabase } from '../db/supabase.js';
import { obtenerPuntoEmisionActivo } from '../db/consultas.js';
import { emitirFactura } from '../services/facturacion.js';

/**
 * Este endpoint es el puente entre "lo que el cajero ve en pantalla" (el
 * carrito) y el motor de facturación ya probado en `services/facturacion.ts`.
 * Arma en un solo paso lo que antes se hizo a mano por SQL durante las
 * pruebas: la fila de `comprobantes`, sus `comprobante_items`, sus
 * `comprobante_formas_pago`, y finalmente llama a `emitirFactura` — la
 * misma función que ya se validó de punta a punta contra el SRI real.
 *
 * DECISIÓN DE DISEÑO IMPORTANTE: los precios y tarifas de IVA de cada línea
 * se recalculan aquí, en el servidor, a partir de `productos` — nunca se
 * confía en el precio que venga del navegador. Un carrito es, ante todo,
 * dinero: si el precio se tomara tal cual del body de la petición, bastaría
 * con interceptar la llamada desde el navegador para "comprar" cualquier
 * cosa al precio que se quiera.
 */

const CONSUMIDOR_FINAL = {
  tipo_identificacion: '07',
  identificacion: '9999999999999',
  razon_social: 'CONSUMIDOR FINAL',
};

interface ItemCarritoBody {
  productoId?: string; // si se omite, es una línea libre (descripcionLibre obligatoria)
  descripcionLibre?: string;
  precioUnitarioLibre?: number;
  tarifaIvaLibre?: '0' | '15' | 'exento' | 'no_objeto';
  cantidad: number;
  descuento?: number;
}

interface PagoBody {
  formaPagoCodigo: string; // catálogo SRI: '01' efectivo, '19' tarjeta de crédito, '20' otros con sistema financiero, etc.
  valor: number;
}

interface ClienteBody {
  tipoIdentificacion: string;
  identificacion: string;
  razonSocial: string;
  email?: string;
  telefono?: string;
  direccion?: string;
}

interface VentaBody {
  emisorId: string;
  cliente?: ClienteBody; // si se omite, se usa consumidor final
  items: ItemCarritoBody[];
  pagos: PagoBody[];
  propina?: number;
}

// Códigos de porcentaje de IVA que exige el SRI en cada línea (catálogo oficial).
const CODIGO_PORCENTAJE_IVA: Record<string, string> = {
  '0': '0',
  '5': '5',
  '15': '4',
  exento: '7',
  no_objeto: '6',
};

// Tasa real aplicada según la tarifa — normativa vigente (2026): 15%
// general, 5% para materiales de construcción, 0%/exento/no objeto sin IVA.
const TASA_POR_TARIFA: Record<string, number> = {
  '0': 0,
  '5': 0.05,
  '15': 0.15,
  exento: 0,
  no_objeto: 0,
};

function redondear(valor: number): number {
  return Math.round(valor * 100) / 100;
}

export async function registrarRutasPos(app: FastifyInstance) {
  /** Lista productos de un emisor, para el buscador del carrito. Por defecto solo los activos. */
  app.get<{ Querystring: { emisorId?: string; incluirInactivos?: string } }>('/productos', async (request, reply) => {
    const { emisorId, incluirInactivos } = request.query;
    if (!emisorId) {
      return reply.status(400).send({ error: 'Falta el parámetro emisorId.' });
    }

    let consulta = supabase
      .from('productos')
      .select('id, codigo_principal, codigo_auxiliar, descripcion, unidad_medida, precio_venta, costo_promedio, tarifa_iva, stock_actual, stock_minimo, activo')
      .eq('emisor_id', emisorId)
      .order('descripcion', { ascending: true });

    if (incluirInactivos !== 'true') {
      consulta = consulta.eq('activo', true);
    }

    const { data, error } = await consulta;

    if (error) {
      return reply.status(500).send({ error: error.message });
    }
    return reply.send(data);
  });

  /** Crea un producto nuevo en el catálogo de un emisor. */
  app.post<{
    Body: {
      emisorId: string;
      codigoPrincipal: string;
      codigoAuxiliar?: string;
      descripcion: string;
      unidadMedida?: string;
      precioVenta: number;
      costoPromedio?: number;
      tarifaIva: '0' | '15' | 'exento' | 'no_objeto';
      stockActual?: number;
      stockMinimo?: number;
    };
  }>('/productos', async (request, reply) => {
    const b = request.body;
    const faltantes: string[] = [];
    if (!b?.emisorId) faltantes.push('emisorId');
    if (!b?.codigoPrincipal) faltantes.push('codigoPrincipal');
    if (!b?.descripcion) faltantes.push('descripcion');
    if (b?.precioVenta === undefined || b.precioVenta < 0) faltantes.push('precioVenta');
    if (!b?.tarifaIva) faltantes.push('tarifaIva');
    if (faltantes.length > 0) {
      return reply.status(400).send({ error: `Faltan campos obligatorios: ${faltantes.join(', ')}` });
    }

    const { data, error } = await supabase
      .from('productos')
      .insert({
        emisor_id: b.emisorId,
        codigo_principal: b.codigoPrincipal,
        codigo_auxiliar: b.codigoAuxiliar || null,
        descripcion: b.descripcion,
        unidad_medida: b.unidadMedida || 'UNIDAD',
        precio_venta: b.precioVenta,
        costo_promedio: b.costoPromedio ?? 0,
        tarifa_iva: b.tarifaIva,
        stock_actual: b.stockActual ?? 0,
        stock_minimo: b.stockMinimo ?? 0,
      })
      .select('id')
      .single();

    if (error || !data) {
      return reply.status(409).send({
        error: 'No se pudo crear el producto. Es posible que el código ya exista para este negocio.',
        detalle: error?.message,
      });
    }
    return reply.status(201).send({ id: data.id });
  });

  /** Edita un producto existente (precio, stock, IVA, activo/inactivo, etc). */
  app.patch<{
    Params: { id: string };
    Body: Partial<{
      descripcion: string;
      codigoAuxiliar: string;
      unidadMedida: string;
      precioVenta: number;
      costoPromedio: number;
      tarifaIva: '0' | '15' | 'exento' | 'no_objeto';
      stockActual: number;
      stockMinimo: number;
      activo: boolean;
    }>;
  }>('/productos/:id', async (request, reply) => {
    const b = request.body ?? {};
    const cambios: Record<string, unknown> = {};
    if (b.descripcion !== undefined) cambios.descripcion = b.descripcion;
    if (b.codigoAuxiliar !== undefined) cambios.codigo_auxiliar = b.codigoAuxiliar || null;
    if (b.unidadMedida !== undefined) cambios.unidad_medida = b.unidadMedida;
    if (b.precioVenta !== undefined) cambios.precio_venta = b.precioVenta;
    if (b.costoPromedio !== undefined) cambios.costo_promedio = b.costoPromedio;
    if (b.tarifaIva !== undefined) cambios.tarifa_iva = b.tarifaIva;
    if (b.stockActual !== undefined) cambios.stock_actual = b.stockActual;
    if (b.stockMinimo !== undefined) cambios.stock_minimo = b.stockMinimo;
    if (b.activo !== undefined) cambios.activo = b.activo;

    if (Object.keys(cambios).length === 0) {
      return reply.status(400).send({ error: 'No se envió ningún campo para actualizar.' });
    }

    const { error } = await supabase.from('productos').update(cambios).eq('id', request.params.id);
    if (error) {
      return reply.status(500).send({ error: error.message });
    }
    return reply.send({ ok: true });
  });

  /**
   * Recibe el carrito completo de una venta, lo convierte en un comprobante
   * (con sus items y formas de pago) y lo emite contra el SRI en el mismo
   * paso. Devuelve el resultado final (AUTORIZADO / rechazado / error) para
   * que el POS lo muestre de inmediato al cajero.
   */
  app.post<{ Body: VentaBody }>('/pos/venta', async (request, reply) => {
    const body = request.body;

    if (!body?.emisorId) {
      return reply.status(400).send({ error: 'Falta emisorId.' });
    }
    if (!Array.isArray(body.items) || body.items.length === 0) {
      return reply.status(400).send({ error: 'El carrito no puede estar vacío.' });
    }
    if (!Array.isArray(body.pagos) || body.pagos.length === 0) {
      return reply.status(400).send({ error: 'Debe indicarse al menos una forma de pago.' });
    }

    let puntoEmision;
    try {
      puntoEmision = await obtenerPuntoEmisionActivo(body.emisorId);
    } catch (err) {
      return reply.status(404).send({ error: err instanceof Error ? err.message : String(err) });
    }

    // --- 1) Resolver cada línea del carrito contra `productos` (precio/IVA/stock reales) ---
    const idsProductos = body.items.map((i) => i.productoId).filter((id): id is string => !!id);

    const productosPorId = new Map<
      string,
      { codigo_principal: string; descripcion: string; precio_venta: number; tarifa_iva: string; costo_promedio: number; stock_actual: number }
    >();

    if (idsProductos.length > 0) {
      const { data: productos, error: errorProductos } = await supabase
        .from('productos')
        .select('id, codigo_principal, descripcion, precio_venta, tarifa_iva, costo_promedio, stock_actual')
        .eq('emisor_id', body.emisorId)
        .in('id', idsProductos);

      if (errorProductos) {
        return reply.status(500).send({ error: errorProductos.message });
      }
      for (const p of productos ?? []) {
        productosPorId.set(p.id, p);
      }
      const faltantes = idsProductos.filter((id) => !productosPorId.has(id));
      if (faltantes.length > 0) {
        return reply.status(404).send({
          error: `Producto(s) no encontrados o inactivos para este emisor: ${faltantes.join(', ')}`,
        });
      }
    }

    const sinStock: string[] = [];
    const detallesFactura: FacturaDetail[] = [];
    const itemsParaGuardar: Array<{
      producto_id: string | null;
      descripcion: string;
      cantidad: number;
      precio_unitario: number;
      descuento: number;
      precio_total_sin_impuesto: number;
      costo_unitario_momento: number;
      tarifa_iva: string;
      valor_iva: number;
    }> = [];

    let subtotal0 = 0;
    let subtotal5 = 0;
    let subtotal15 = 0;
    let totalDescuento = 0;
    let totalIva = 0;

    for (const item of body.items) {
      if (!item.cantidad || item.cantidad <= 0) {
        return reply.status(400).send({ error: 'Cada línea del carrito necesita una cantidad mayor a 0.' });
      }

      const descuento = redondear(item.descuento ?? 0);
      let descripcion: string;
      let codigoParaFactura: string;
      let precioUnitario: number;
      let tarifaIva: string;
      let costoUnitario: number;
      let productoId: string | null = null;

      if (item.productoId) {
        const producto = productosPorId.get(item.productoId)!;
        if (producto.stock_actual < item.cantidad) {
          sinStock.push(`${producto.descripcion} (disponible: ${producto.stock_actual}, pedido: ${item.cantidad})`);
        }
        descripcion = producto.descripcion;
        // El SRI exige codigoPrincipal de máximo 25 caracteres — nunca el
        // id interno (UUID, 36 caracteres) del producto.
        codigoParaFactura = producto.codigo_principal.slice(0, 25);
        precioUnitario = Number(producto.precio_venta);
        tarifaIva = producto.tarifa_iva;
        costoUnitario = Number(producto.costo_promedio);
        productoId = item.productoId;
      } else {
        if (!item.descripcionLibre || item.precioUnitarioLibre === undefined) {
          return reply.status(400).send({
            error: 'Una línea sin productoId necesita descripcionLibre y precioUnitarioLibre.',
          });
        }
        descripcion = item.descripcionLibre;
        codigoParaFactura = 'VARIOS';
        precioUnitario = item.precioUnitarioLibre;
        tarifaIva = item.tarifaIvaLibre ?? '15';
        costoUnitario = 0;
      }

      const precioTotalSinImpuesto = redondear(item.cantidad * precioUnitario - descuento);
      const codigoPorcentaje = CODIGO_PORCENTAJE_IVA[tarifaIva] ?? '4';
      const porcentajeIva = TASA_POR_TARIFA[tarifaIva] ?? 0;
      const valorIva = redondear(precioTotalSinImpuesto * porcentajeIva);

      if (tarifaIva === '15') subtotal15 = redondear(subtotal15 + precioTotalSinImpuesto);
      else if (tarifaIva === '5') subtotal5 = redondear(subtotal5 + precioTotalSinImpuesto);
      else subtotal0 = redondear(subtotal0 + precioTotalSinImpuesto);
      totalDescuento = redondear(totalDescuento + descuento);
      totalIva = redondear(totalIva + valorIva);

      itemsParaGuardar.push({
        producto_id: productoId,
        descripcion,
        cantidad: item.cantidad,
        precio_unitario: precioUnitario,
        descuento,
        precio_total_sin_impuesto: precioTotalSinImpuesto,
        costo_unitario_momento: costoUnitario,
        tarifa_iva: tarifaIva,
        valor_iva: valorIva,
      });

      detallesFactura.push({
        codigoPrincipal: codigoParaFactura,
        descripcion,
        cantidad: item.cantidad,
        precioUnitario,
        descuento,
        precioTotalSinImpuesto,
        impuestos: [
          {
            codigo: '2',
            codigoPorcentaje,
            tarifa: porcentajeIva * 100,
            baseImponible: precioTotalSinImpuesto,
            valor: valorIva,
          },
        ],
      });
    }

    if (sinStock.length > 0) {
      return reply.status(409).send({
        error: 'Stock insuficiente para completar la venta.',
        detalle: sinStock,
      });
    }

    const propina = redondear(body.propina ?? 0);
    const totalSinImpuestos = redondear(subtotal0 + subtotal5 + subtotal15);
    const importeTotal = redondear(totalSinImpuestos + totalIva + propina);

    const sumaPagos = redondear(body.pagos.reduce((acc, p) => acc + p.valor, 0));
    if (Math.abs(sumaPagos - importeTotal) > 0.01) {
      return reply.status(400).send({
        error: `La suma de las formas de pago (${sumaPagos.toFixed(2)}) no coincide con el total de la venta (${importeTotal.toFixed(2)}).`,
      });
    }

    // --- 2) Resolver cliente (o consumidor final reutilizable) ---
    const datosCliente = body.cliente
      ? {
          tipoIdentificacion: body.cliente.tipoIdentificacion,
          identificacion: body.cliente.identificacion,
          razonSocial: body.cliente.razonSocial,
          email: body.cliente.email ?? null,
          telefono: body.cliente.telefono ?? null,
          direccion: body.cliente.direccion ?? null,
        }
      : {
          tipoIdentificacion: CONSUMIDOR_FINAL.tipo_identificacion,
          identificacion: CONSUMIDOR_FINAL.identificacion,
          razonSocial: CONSUMIDOR_FINAL.razon_social,
          email: null as string | null,
          telefono: null as string | null,
          direccion: null as string | null,
        };

    const { data: cliente, error: errorCliente } = await supabase
      .from('clientes')
      .upsert(
        {
          emisor_id: body.emisorId,
          tipo_identificacion: datosCliente.tipoIdentificacion,
          identificacion: datosCliente.identificacion,
          razon_social: datosCliente.razonSocial,
          email: datosCliente.email,
          telefono: datosCliente.telefono,
          direccion: datosCliente.direccion,
        },
        { onConflict: 'emisor_id,tipo_identificacion,identificacion' }
      )
      .select('id')
      .single();

    if (errorCliente || !cliente) {
      return reply.status(500).send({ error: errorCliente?.message ?? 'No se pudo resolver el cliente.' });
    }

    // --- 3) Crear la venta completa (comprobante + items + pagos) y
    // descontar inventario, todo en una sola transacción atómica de
    // Postgres (ver sql/migracion_crear_venta_atomica.sql). El `secuencial`
    // se deja en NULL a propósito: lo asigna la librería de forma atómica
    // en el momento de emitir (ver services/facturacion.ts) — inventar un
    // número aquí antes de emitir es lo que causaba el desfase que se
    // corrigió en una sesión anterior.
    const { data: comprobanteId, error: errorVenta } = await supabase.rpc('crear_venta', {
      p_emisor_id: body.emisorId,
      p_punto_emision_id: puntoEmision.id,
      p_cliente_id: cliente.id,
      p_tipo: 'factura',
      p_subtotal_0: subtotal0,
      p_subtotal_5: subtotal5,
      p_subtotal_15: subtotal15,
      p_total_descuento: totalDescuento,
      p_total_iva: totalIva,
      p_propina: propina,
      p_importe_total: importeTotal,
      p_items: itemsParaGuardar,
      p_pagos: body.pagos.map((p) => ({ forma_pago_codigo: p.formaPagoCodigo, valor: p.valor })),
    });

    if (errorVenta || !comprobanteId) {
      const mensaje = errorVenta?.message ?? '';
      if (mensaje.includes('stock_insuficiente')) {
        return reply.status(409).send({
          error: 'Stock insuficiente al momento de confirmar la venta (alguien más vendió el mismo producto primero).',
        });
      }
      return reply.status(500).send({ error: mensaje || 'No se pudo crear la venta.' });
    }

    const comprobante = { id: comprobanteId as string };

    // --- 4) Armar el FacturaData y emitir, reusando el motor ya probado ---
    const totalConImpuestos: TotalTax[] = [];
    if (subtotal0 > 0) {
      totalConImpuestos.push({ codigo: '2', codigoPorcentaje: '0', baseImponible: subtotal0, valor: 0 });
    }
    if (subtotal5 > 0) {
      totalConImpuestos.push({
        codigo: '2',
        codigoPorcentaje: '5',
        baseImponible: subtotal5,
        valor: redondear(subtotal5 * 0.05),
      });
    }
    if (subtotal15 > 0) {
      totalConImpuestos.push({
        codigo: '2',
        codigoPorcentaje: '4',
        baseImponible: subtotal15,
        valor: totalIva,
      });
    }

    const hoy = new Date();
    const fechaEmision = `${String(hoy.getDate()).padStart(2, '0')}/${String(hoy.getMonth() + 1).padStart(2, '0')}/${hoy.getFullYear()}`;

    const facturaData: FacturaData = {
      fechaEmision,
      tipoIdentificacionComprador: datosCliente.tipoIdentificacion,
      razonSocialComprador: datosCliente.razonSocial,
      identificacionComprador: datosCliente.identificacion,
      direccionComprador: datosCliente.direccion ?? undefined,
      totalSinImpuestos,
      totalDescuento,
      totalConImpuestos,
      propina,
      importeTotal,
      pagos: body.pagos.map((p) => ({ formaPago: p.formaPagoCodigo, total: p.valor })),
      detalles: detallesFactura,
    };

    try {
      const resultado = await emitirFactura({
        emisorId: body.emisorId,
        comprobanteId: comprobante.id,
        facturaData,
      });

      return reply.status(201).send({
        comprobanteId: comprobante.id,
        estado: resultado.estado,
        claveAcceso: resultado.claveAcceso,
        secuencial: resultado.secuencial,
        numeroAutorizacion: resultado.numeroAutorizacion,
        importeTotal,
      });
    } catch (err) {
      // El comprobante queda guardado con el detalle real de la venta,
      // marcado 'rechazado' por emitirFactura() — no se pierde la venta,
      // solo falló la parte de autorización ante el SRI.
      return reply.status(502).send({
        comprobanteId: comprobante.id,
        error: 'La venta se registró pero no se pudo emitir el comprobante ante el SRI.',
        detalle: err instanceof Error ? err.message : String(err),
      });
    }
  });
}
