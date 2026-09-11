import type { FastifyInstance } from 'fastify';
import type { FacturaData, TotalTax, FacturaDetail } from 'facturacion-electronica-ec';
import { supabase } from '../db/supabase.js';
import { obtenerPuntoEmisionActivo } from '../db/consultas.js';
import { emitirFactura } from '../services/facturacion.js';
import { generarRidePdf } from '../services/ride.js';
import { contabilizarVenta } from '../services/motorContable.js';
import { enviarComprobantePorCorreo } from '../services/email.js';

import { fechaEmisionEcuador, fechaIsoEcuador } from '../utils/fechaEcuador.js';
import { comprobarLimiteDocumentos } from '../services/saas.js';
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
  tarifaIvaLibre?: string;
  cantidad: number;
  descuento?: number; // descuento total de la línea, no por unidad
  precioUnitario?: number; // precio aplicado en caja; se audita cuando difiere del catálogo
  tarifaIva?: string; // tarifa elegida en la línea del POS; si no viene, usa la del catálogo
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
  puntoEmisionId?: string;

  cliente?: ClienteBody; // si se omite, se usa consumidor final
  items: ItemCarritoBody[];
  pagos: PagoBody[];
  propina?: number;
}

// Códigos de porcentaje de IVA que exige el SRI en cada línea (catálogo oficial).
const DEFAULT_IVA = {
  general: 13,
  codigoGeneral: '10',
  reducida: 5,
  codigoReducida: '5',
  turismo: 8,
  codigoTurismo: '8',
};

function normalizarTarifaIva(valor: unknown, cfg = DEFAULT_IVA): { tarifa: string; codigo: string; tasa: number; grupo: '0'|'5'|'8'|'general'|'otros' } {
  const raw = String(valor ?? '15').toLowerCase();
  if (raw === 'exento') return { tarifa:'exento', codigo:'7', tasa:0, grupo:'0' };
  if (raw === 'no_objeto') return { tarifa:'no_objeto', codigo:'6', tasa:0, grupo:'0' };
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 100) return { tarifa:String(cfg.general), codigo:cfg.codigoGeneral, tasa:cfg.general/100, grupo:'general' };
  if (Math.abs(n-0)<0.0001) return { tarifa:'0', codigo:'0', tasa:0, grupo:'0' };
  if (Math.abs(n-cfg.general)<0.0001 || raw === '13') return { tarifa:String(cfg.general), codigo:cfg.codigoGeneral, tasa:cfg.general/100, grupo:'general' };
  // 15% se conserva únicamente para comprobantes/configuraciones históricas.
  if (raw === '15') return { tarifa:'15', codigo:'4', tasa:0.15, grupo:'general' };
  if (Math.abs(n-cfg.reducida)<0.0001 || raw === '5') return { tarifa:String(cfg.reducida), codigo:cfg.codigoReducida, tasa:cfg.reducida/100, grupo:'5' };
  if (Math.abs(n-cfg.turismo)<0.0001 || raw === '8') return { tarifa:String(cfg.turismo), codigo:cfg.codigoTurismo, tasa:cfg.turismo/100, grupo:'8' };
  return { tarifa:String(n), codigo:raw, tasa:n/100, grupo:'otros' };
}

function redondear(valor: number): number { return Math.round(valor * 100) / 100; }
function emailValido(v: string) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }

export async function registrarRutasPos(app: FastifyInstance) {
  app.get<{ Querystring: { emisorId?: string } }>('/pos/configuracion-iva', async (request, reply) => {
    const emisorId = request.query.emisorId;
    if (!emisorId) return reply.status(400).send({ error: 'Falta emisorId.' });
    const { data, error } = await supabase.from('configuracion_iva')
      .select('tarifa_general,codigo_general,tarifa_reducida,codigo_reducida,tarifa_turismo,codigo_turismo,activo')
      .eq('emisor_id', emisorId).maybeSingle();
    if (error) return reply.status(500).send({ error: error.message });
    const hoy = fechaIsoEcuador();
    const { data: turismoVigencia } = await supabase.from('catalogo_iva_sri')
      .select('id').eq('codigo_porcentaje', '8').eq('activo', true)
      .lte('fecha_desde', hoy).or(`fecha_hasta.is.null,fecha_hasta.gte.${hoy}`).limit(1);
    return reply.send({ ...(data ?? { tarifa_general:13, codigo_general:'10', tarifa_reducida:5, codigo_reducida:'5', tarifa_turismo:8, codigo_turismo:'8', activo:true }), turismo_vigente: Boolean(turismoVigencia?.length) });
  });
  /** Lista productos de un emisor, para el buscador del carrito. Por defecto solo los activos. */
  app.get<{ Querystring: { emisorId?: string; incluirInactivos?: string } }>('/productos', async (request, reply) => {
    const { emisorId, incluirInactivos } = request.query;
    if (!emisorId) {
      return reply.status(400).send({ error: 'Falta el parámetro emisorId.' });
    }

    let consulta = supabase
      .from('productos')
      .select('id, codigo_principal, codigo_auxiliar, descripcion, unidad_medida, precio_venta, costo_promedio, tarifa_iva, stock_actual, stock_critico, stock_minimo, stock_maximo, activo')
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
      tarifaIva: '0' | '5' | '8' | '15' | 'exento' | 'no_objeto';
      stockActual?: number;
      stockCritico?: number;
      stockMinimo?: number;
      stockMaximo?: number;
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
        stock_critico: b.stockCritico ?? 0,
        stock_minimo: b.stockMinimo ?? 0,
        stock_maximo: b.stockMaximo ?? null,
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
      tarifaIva: '0' | '5' | '8' | '15' | 'exento' | 'no_objeto';
      stockActual: number;
      stockCritico: number;
      stockMinimo: number;
      stockMaximo?: number | null;
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
    if (b.stockCritico !== undefined) cambios.stock_critico = b.stockCritico;
    if (b.stockMinimo !== undefined) cambios.stock_minimo = b.stockMinimo;
    if (b.stockMaximo !== undefined) cambios.stock_maximo = b.stockMaximo;
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
  /** Puntos de emisión activos disponibles para el cajero. */
  app.get<{ Querystring: { emisorId?: string } }>('/pos/puntos-emision', async (request, reply) => {
    const emisorId = request.query.emisorId;
    if (!emisorId) return reply.status(400).send({ error: 'Falta emisorId.' });
    const { data, error } = await supabase
      .from('puntos_emision')
      .select('id,establecimiento,punto_emision,direccion,activo')
      .eq('emisor_id', emisorId)
      .eq('activo', true)
      .order('establecimiento')
      .order('punto_emision');
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({ items: data ?? [] });
  });

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

    const consumo = await comprobarLimiteDocumentos(body.emisorId);
    if (!consumo.ok) return reply.status(402).send({ error: consumo.mensaje, consumo: consumo.usados, limite: consumo.limite, plan: consumo.plan });

    let puntoEmision;
    try {
      puntoEmision = await obtenerPuntoEmisionActivo(body.emisorId, body.puntoEmisionId);
    } catch (err) {
      return reply.status(404).send({ error: err instanceof Error ? err.message : String(err) });
    }

    const { data: cfgIvaRow } = await supabase.from('configuracion_iva').select('tarifa_general,codigo_general,tarifa_reducida,codigo_reducida,tarifa_turismo,codigo_turismo,activo').eq('emisor_id', body.emisorId).maybeSingle();
    const cfgIva = cfgIvaRow ? {
      general: Number(cfgIvaRow.tarifa_general ?? 13), codigoGeneral: String(cfgIvaRow.codigo_general ?? '10'),
      reducida: Number(cfgIvaRow.tarifa_reducida ?? 5), codigoReducida: String(cfgIvaRow.codigo_reducida ?? '5'),
      turismo: Number(cfgIvaRow.tarifa_turismo ?? 8), codigoTurismo: String(cfgIvaRow.codigo_turismo ?? '8'),
    } : DEFAULT_IVA;

    // --- 1) Resolver cada línea del carrito contra `productos` (precio/IVA/stock reales) ---
    const idsProductos = body.items.map((i) => i.productoId).filter((id): id is string => !!id);

    const productosPorId = new Map<
      string,
      { id: string; codigo_principal: string; descripcion: string; precio_venta: number; tarifa_iva: string; costo_promedio: number; stock_actual: number }
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
    let subtotal8 = 0;
    let subtotal15 = 0;
    let totalDescuento = 0;
    let totalIva = 0;

    for (const item of body.items) {
      if (!item.cantidad || item.cantidad <= 0) {
        return reply.status(400).send({ error: 'Cada línea del carrito necesita una cantidad mayor a 0.' });
      }

      const descuento = redondear(item.descuento ?? 0);
      if (!Number.isFinite(descuento) || descuento < 0) return reply.status(400).send({ error: 'El descuento debe ser un valor no negativo.' });
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
        const precioCatalogo = Number(producto.precio_venta);
        precioUnitario = item.precioUnitario !== undefined ? Number(item.precioUnitario) : precioCatalogo;
        if (!Number.isFinite(precioUnitario) || precioUnitario < 0) {
          return reply.status(400).send({ error: `Precio unitario inválido para ${producto.descripcion}.` });
        }
        if (item.precioUnitario !== undefined && Math.abs(precioUnitario - precioCatalogo) > 0.001) {
          request.log.info({ productoId: producto.id, precioCatalogo, precioAplicado: precioUnitario }, 'Venta con precio manual autorizado desde POS');
        }
        tarifaIva = normalizarTarifaIva(item.tarifaIva ?? producto.tarifa_iva, cfgIva).tarifa;
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
        tarifaIva = normalizarTarifaIva(item.tarifaIvaLibre ?? String(cfgIva.general), cfgIva).tarifa;
        costoUnitario = 0;
      }

      const brutoLinea = redondear(item.cantidad * precioUnitario);
      if (descuento > brutoLinea + 0.01) return reply.status(400).send({ error: `El descuento no puede superar el valor bruto de la línea: $${brutoLinea.toFixed(2)}.` });
      const precioTotalSinImpuesto = redondear(brutoLinea - descuento);
      const tax = normalizarTarifaIva(tarifaIva, cfgIva);

      // La tarifa turística del 8% no es permanente. Solo puede aplicarse
      // cuando existe una vigencia activa en el catálogo SRI interno para
      // la fecha de emisión. Esto evita que un cajero aplique 8% fuera de
      // un Decreto Ejecutivo vigente.
      if (tax.codigo === '8') {
        const { data: vigencia8, error: errorVigencia8 } = await supabase
          .from('catalogo_iva_sri')
          .select('id')
          .eq('codigo_porcentaje', '8')
          .eq('activo', true)
          .lte('fecha_desde', fechaIsoEcuador())
          .or(`fecha_hasta.is.null,fecha_hasta.gte.${fechaIsoEcuador()}`)
          .limit(1);
        if (errorVigencia8) return reply.status(500).send({ error: `No se pudo validar la vigencia del IVA turismo 8%: ${errorVigencia8.message}` });
        if (!vigencia8?.length) {
          return reply.status(400).send({
            error: 'La tarifa IVA 8% turismo no está vigente para la fecha de emisión. Solo puede utilizarse durante las fechas establecidas por el Decreto Ejecutivo correspondiente y si el emisor cumple los requisitos del sector turístico.'
          });
        }
      }

      const codigoPorcentaje = tax.codigo;
      const porcentajeIva = tax.tasa;
      const valorIva = redondear(precioTotalSinImpuesto * porcentajeIva);

      if (tax.grupo === 'general') subtotal15 = redondear(subtotal15 + precioTotalSinImpuesto); // bucket legacy de tarifa general
      else if (tax.grupo === '8') subtotal8 = redondear(subtotal8 + precioTotalSinImpuesto);
      else if (tax.grupo === '5') subtotal5 = redondear(subtotal5 + precioTotalSinImpuesto);
      else if (tax.grupo === '0') subtotal0 = redondear(subtotal0 + precioTotalSinImpuesto);
      else subtotal15 = redondear(subtotal15 + precioTotalSinImpuesto); // compatibilidad del encabezado; detalle SRI conserva tarifa real
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
    const totalSinImpuestos = redondear(subtotal0 + subtotal5 + subtotal8 + subtotal15);
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
          email: body.cliente.email?.trim().toLowerCase() ?? '',
          telefono: body.cliente.telefono ?? null,
          direccion: body.cliente.direccion ?? null,
        }
      : {
          tipoIdentificacion: CONSUMIDOR_FINAL.tipo_identificacion,
          identificacion: CONSUMIDOR_FINAL.identificacion,
          razonSocial: CONSUMIDOR_FINAL.razon_social,
          email: '',
          telefono: null as string | null,
          direccion: null as string | null,
        };

    if (!datosCliente.email || !emailValido(datosCliente.email)) {
      return reply.status(400).send({ error: 'El correo electrónico del cliente es obligatorio y debe ser válido para generar la factura.' });
    }

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
      p_subtotal_8: subtotal8,
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

    await supabase.rpc('registrar_impuestos_dinamicos_comprobante', { p_comprobante_id: comprobanteId, p_emisor_id: body.emisorId });

    // --- 4) Armar el FacturaData y emitir, reusando el motor ya probado ---
    // Construir los impuestos por tarifa a partir de las líneas realmente
    // emitidas. Esto es lo que evita inconsistencias entre 13%, 8%, 5%, 0%,
    // exento y no objeto. El código electrónico es el del catálogo SRI.
    const gruposImpuesto = new Map<string, { base: number; valor: number }>();
    for (const item of itemsParaGuardar) {
      const key = String(item.tarifa_iva).toLowerCase();
      const actual = gruposImpuesto.get(key) ?? { base: 0, valor: 0 };
      actual.base = redondear(actual.base + Number(item.precio_total_sin_impuesto || 0));
      actual.valor = redondear(actual.valor + Number(item.valor_iva || 0));
      gruposImpuesto.set(key, actual);
    }
    const totalConImpuestos: TotalTax[] = [];
    for (const [tarifa, valores] of gruposImpuesto) {
      if (valores.base <= 0 && valores.valor <= 0) continue;
      const tax = normalizarTarifaIva(tarifa, cfgIva);
      totalConImpuestos.push({
        codigo: '2',
        codigoPorcentaje: tax.codigo,
        baseImponible: valores.base,
        valor: valores.valor,
      });
    }

    // IMPORTANTE: Railway usa UTC. La fecha tributaria debe ser la fecha
    // oficial de Ecuador (America/Guayaquil), no la fecha UTC del servidor.
    // Evita generar, por ejemplo, 08/09 cuando en Ecuador todavía es 07/09,
    // lo que provoca el rechazo SRI 65 (fecha de emisión extemporánea).
    const fechaEmision = fechaEmisionEcuador();

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

      let emailStatus: 'enviado' | 'no_configurado' | 'error' = 'no_configurado';
      let emailDetalle: string | undefined;
      if (resultado.estado === 'AUTORIZADO') {
        // Contabilidad automática: una factura autorizada queda registrada
        // en el libro contable de forma idempotente. Si falla, no se revierte
        // la autorización SRI; queda disponible para sincronización/reintento.
        try { await contabilizarVenta(comprobante.id, request.usuarioSesion?.userId); } catch (contErr) { request.log.error(contErr, 'No se pudo contabilizar automáticamente la venta autorizada'); }
        try {
          const ride = await generarRidePdf(comprobante.id);
          const xml = (resultado as any).xmlFirmado ?? '';
          const numero = resultado.secuencial ?? comprobante.id;
          await enviarComprobantePorCorreo({
            to: datosCliente.email,
            subject: `Comprobante electrónico autorizado ${numero}`,
            html: `<p>Estimado/a ${datosCliente.razonSocial},</p><p>Adjuntamos su comprobante electrónico autorizado por el SRI.</p><p>Clave de acceso: <strong>${resultado.claveAcceso ?? ''}</strong></p><p>Gracias por su compra.</p>`,
            attachments: [
              { filename: `${resultado.claveAcceso ?? numero}.xml`, content: Buffer.from(xml, 'utf8').toString('base64'), type: 'application/xml' },
              { filename: `RIDE-${numero}.pdf`, content: ride.toString('base64'), type: 'application/pdf' },
            ],
          });
          emailStatus = 'enviado';
          await supabase.from('email_envios').insert({ comprobante_id: comprobante.id, destinatario: datosCliente.email, estado: 'enviado' });
        } catch (emailError) {
          emailStatus = 'error';
          emailDetalle = emailError instanceof Error ? emailError.message : String(emailError);
          await supabase.from('email_envios').insert({ comprobante_id: comprobante.id, destinatario: datosCliente.email, estado: 'error', detalle: emailDetalle });
        }
      }

      const lineasConPrecioManual = body.items.filter((item) => item.productoId && item.precioUnitario !== undefined && Math.abs(Number(item.precioUnitario) - Number(productosPorId.get(item.productoId)?.precio_venta ?? item.precioUnitario)) > 0.001).length;
      if (lineasConPrecioManual > 0 || body.items.some((item) => Number(item.descuento ?? 0) > 0)) {
        await supabase.from('auditoria_sri').insert({
          emisor_id: body.emisorId,
          comprobante_id: comprobante.id,
          tipo_documento: 'FACTURA',
          evento: 'PRECIO_DESCUENTO_POS',
          estado: resultado.estado,
          clave_acceso: resultado.claveAcceso,
          secuencial: resultado.secuencial,
          detalle: {
            lineasPrecioManual: lineasConPrecioManual,
            descuentosAplicados: body.items.filter((item) => Number(item.descuento ?? 0) > 0).map((item) => ({ productoId:item.productoId ?? null, descuento:Number(item.descuento ?? 0), precioUnitario:item.precioUnitario ?? null })),
          },
        });
      }

      const { data: confProveedor } = await supabase.from('configuracion_sistema').select('ruc_proveedor_facturacion').eq('emisor_id', body.emisorId).maybeSingle();
      const rucProveedor = process.env.RUC_PROVEEDOR_FACTURACION?.trim() || String(confProveedor?.ruc_proveedor_facturacion ?? '').trim() || null;
      return reply.status(201).send({
        comprobanteId: comprobante.id,
        estado: resultado.estado,
        claveAcceso: resultado.claveAcceso,
        secuencial: resultado.secuencial,
        numeroAutorizacion: resultado.numeroAutorizacion,
        mensaje: resultado.mensaje ?? null,
        ambiente: (resultado as any).ambiente ?? null,
        importeTotal,
        emailStatus,
        emailDetalle,
        rucProveedor,
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
