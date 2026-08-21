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
    Body: { productoId: string; cantidad: number; costoUnitario: number; nota?: string };
  }>('/inventario/entrada', async (request, reply) => {
    const { productoId, cantidad, costoUnitario, nota } = request.body ?? {};

    if (!productoId) return reply.status(400).send({ error: 'Falta productoId.' });
    if (!cantidad || cantidad <= 0) return reply.status(400).send({ error: 'La cantidad debe ser mayor a 0.' });
    if (costoUnitario === undefined || costoUnitario < 0) {
      return reply.status(400).send({ error: 'Falta o es inválido el costo unitario.' });
    }

    const { data, error } = await supabase.rpc('registrar_entrada_inventario', {
      p_producto_id: productoId,
      p_cantidad: cantidad,
      p_costo_unitario: costoUnitario,
      p_nota: nota ?? null,
    });

    if (error || !data?.[0]) {
      const mensaje = error?.message ?? '';
      if (mensaje.includes('producto_no_encontrado')) {
        return reply.status(404).send({ error: 'Producto no encontrado.' });
      }
      return reply.status(500).send({ error: mensaje || 'No se pudo registrar la entrada.' });
    }

    return reply.status(201).send({
      stockResultante: data[0].stock_resultante,
      costoPromedioResultante: data[0].costo_promedio_resultante,
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
