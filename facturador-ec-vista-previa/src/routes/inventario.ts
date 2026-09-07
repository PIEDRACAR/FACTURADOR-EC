import type { FastifyInstance } from 'fastify';
import { supabase } from '../db/supabase.js';

/**
 * Este módulo cierra el ciclo de inventario: hasta ahora el stock solo
 * podía DESCONTARSE (al vender, vía `crear_venta`). Aquí se agrega la
 * otra mitad — registrar compras/entradas con su costo (recalculando el
 * costo promedio ponderado correctamente) y ajustes por conteo físico —
 * más el kardex para ver el historial completo de cada producto.
 */

export async function registrarRutasInventario(app: FastifyInstance) {
  /** Registra una entrada de mercadería (compra) y recalcula el costo promedio ponderado. */
  app.post<{
    Body: {
      productoId: string;
      cantidad: number;
      costoUnitario: number;
      nota?: string;
      proveedorId?: string;
      esCredito?: boolean;
      fechaVencimiento?: string;
      numeroDocumento?: string;
    };
  }>('/inventario/entrada', async (request, reply) => {
    const { productoId, cantidad, costoUnitario, nota, proveedorId, esCredito, fechaVencimiento, numeroDocumento } =
      request.body ?? {};

    if (!productoId) return reply.status(400).send({ error: 'Falta productoId.' });
    if (!cantidad || cantidad <= 0) return reply.status(400).send({ error: 'La cantidad debe ser mayor a 0.' });
    if (costoUnitario === undefined || costoUnitario < 0) {
      return reply.status(400).send({ error: 'Falta o es inválido el costo unitario.' });
    }
    if (esCredito && (!proveedorId || !fechaVencimiento)) {
      return reply.status(400).send({ error: 'Una compra a crédito necesita proveedor y fecha de vencimiento.' });
    }

    const { data, error } = await supabase.rpc('registrar_entrada_inventario', {
      p_producto_id: productoId,
      p_cantidad: cantidad,
      p_costo_unitario: costoUnitario,
      p_nota: nota ?? null,
      p_proveedor_id: proveedorId ?? null,
    });

    if (error || !data?.[0]) {
      const mensaje = error?.message ?? '';
      if (mensaje.includes('producto_no_encontrado')) {
        return reply.status(404).send({ error: 'Producto no encontrado.' });
      }
      return reply.status(500).send({ error: mensaje || 'No se pudo registrar la entrada.' });
    }

    const resultado = data[0];
    let cuentaPorPagarId: string | undefined;

    if (esCredito && proveedorId && fechaVencimiento) {
      const { data: producto } = await supabase
        .from('productos')
        .select('descripcion, emisor_id')
        .eq('id', productoId)
        .single();

      const { data: cuenta, error: errorCuenta } = await supabase
        .from('cuentas_por_pagar')
        .insert({
          emisor_id: producto?.emisor_id,
          proveedor_id: proveedorId,
          numero_documento: numeroDocumento ?? null,
          concepto: `Compra: ${producto?.descripcion ?? 'producto'} (${cantidad} unid.)`,
          fecha_vencimiento: fechaVencimiento,
          monto_total: Math.round(cantidad * costoUnitario * 100) / 100,
          movimiento_inventario_id: resultado.movimiento_id,
        })
        .select('id')
        .single();

      if (!errorCuenta && cuenta) cuentaPorPagarId = cuenta.id;
    }

    return reply.status(201).send({
      stockResultante: resultado.stock_resultante,
      costoPromedioResultante: resultado.costo_promedio_resultante,
      cuentaPorPagarId,
    });
  });

  /** Ajusta el stock a un valor exacto (conteo físico), sin tocar el costo promedio. */
  app.post<{
    Body: { productoId: string; nuevoStock: number; motivo?: string };
  }>('/inventario/ajuste', async (request, reply) => {
    const { productoId, nuevoStock, motivo } = request.body ?? {};

    if (!productoId) return reply.status(400).send({ error: 'Falta productoId.' });
    if (nuevoStock === undefined || nuevoStock < 0) {
      return reply.status(400).send({ error: 'El nuevo stock debe ser 0 o mayor.' });
    }
    if (!motivo || !motivo.trim()) {
      return reply.status(400).send({ error: 'Indica el motivo del ajuste (obligatorio, para el historial).' });
    }

    const { data, error } = await supabase.rpc('registrar_ajuste_inventario', {
      p_producto_id: productoId,
      p_nuevo_stock: nuevoStock,
      p_motivo: motivo,
    });

    if (error || !data?.[0]) {
      const mensaje = error?.message ?? '';
      if (mensaje.includes('producto_no_encontrado')) {
        return reply.status(404).send({ error: 'Producto no encontrado.' });
      }
      return reply.status(500).send({ error: mensaje || 'No se pudo registrar el ajuste.' });
    }

    return reply.status(201).send({ stockResultante: data[0].stock_resultante });
  });


  /** Semáforo de inventario: STOP, bajo, normal y sobrestock. */
  app.get<{ Querystring: { emisorId?: string; estado?: string } }>('/inventario/alertas', async (request, reply) => {
    const { emisorId, estado } = request.query;
    if (!emisorId) return reply.status(400).send({ error: 'Falta el parámetro emisorId.' });

    const { data, error } = await supabase
      .from('productos')
      .select('id, codigo_principal, descripcion, unidad_medida, stock_actual, stock_critico, stock_minimo, stock_maximo, precio_venta, costo_promedio, activo')
      .eq('emisor_id', emisorId)
      .eq('activo', true)
      .order('descripcion', { ascending: true });

    if (error) return reply.status(500).send({ error: error.message });

    const productos = (data ?? []).map((p) => {
      const stock = Number(p.stock_actual);
      const critico = Number(p.stock_critico ?? 0);
      const minimo = Number(p.stock_minimo ?? 0);
      const maximo = p.stock_maximo == null ? null : Number(p.stock_maximo);
      let estadoProducto: 'stop' | 'bajo' | 'normal' | 'sobrestock';
      if (stock <= critico) estadoProducto = 'stop';
      else if (stock <= minimo) estadoProducto = 'bajo';
      else if (maximo !== null && stock > maximo) estadoProducto = 'sobrestock';
      else estadoProducto = 'normal';

      return {
        id: p.id, codigo: p.codigo_principal, descripcion: p.descripcion, unidad: p.unidad_medida,
        stock, stockCritico: critico, stockMinimo: minimo, stockMaximo: maximo,
        precioVenta: Number(p.precio_venta), costoPromedio: Number(p.costo_promedio), estado: estadoProducto,
      };
    });

    const filtrados = estado && ['stop', 'bajo', 'normal', 'sobrestock'].includes(estado)
      ? productos.filter((p) => p.estado === estado)
      : productos;

    return reply.send({
      resumen: {
        stop: productos.filter((p) => p.estado === 'stop').length,
        bajo: productos.filter((p) => p.estado === 'bajo').length,
        normal: productos.filter((p) => p.estado === 'normal').length,
        sobrestock: productos.filter((p) => p.estado === 'sobrestock').length,
        total: productos.length,
      },
      productos: filtrados,
    });
  });

  /** Kardex: historial de movimientos de inventario, opcionalmente filtrado por producto. */
  app.get<{ Querystring: { emisorId?: string; productoId?: string; limite?: string } }>(
    '/inventario/kardex',
    async (request, reply) => {
      const { emisorId, productoId, limite } = request.query;
      if (!emisorId) return reply.status(400).send({ error: 'Falta el parámetro emisorId.' });

      let consulta = supabase
        .from('movimientos_inventario')
        .select('id, tipo, cantidad, costo_unitario, saldo_cantidad, saldo_costo_promedio, referencia_tipo, nota, created_at, productos(codigo_principal, descripcion)')
        .eq('emisor_id', emisorId)
        .order('created_at', { ascending: false })
        .limit(Math.min(Number(limite) || 100, 300));

      if (productoId) consulta = consulta.eq('producto_id', productoId);

      const { data, error } = await consulta;
      if (error) return reply.status(500).send({ error: error.message });
      return reply.send(data);
    }
  );
}
