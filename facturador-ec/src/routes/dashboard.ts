import type { FastifyInstance } from 'fastify';
import { supabase } from '../db/supabase.js';

/**
 * Todo lo que necesita el panel principal (`/`) para mostrarse en una sola
 * llamada: datos del negocio, cuánto se ha vendido hoy, y si hay productos
 * con stock por debajo del mínimo — para que la primera pantalla que ve el
 * dueño del negocio sea un vistazo útil, no una página en blanco.
 */
export async function registrarRutasDashboard(app: FastifyInstance) {
  app.get<{ Querystring: { emisorId?: string } }>('/dashboard/resumen', async (request, reply) => {
    const { emisorId } = request.query;
    if (!emisorId) return reply.status(400).send({ error: 'Falta el parámetro emisorId.' });

    const { data: emisor, error: errorEmisor } = await supabase
      .from('emisores')
      .select('ruc, razon_social, nombre_comercial, ambiente')
      .eq('id', emisorId)
      .single();

    if (errorEmisor || !emisor) {
      return reply.status(404).send({ error: 'No se encontró un negocio con ese emisorId.' });
    }

    const inicioHoy = new Date();
    inicioHoy.setHours(0, 0, 0, 0);

    const { data: ventasHoy, error: errorVentas } = await supabase
      .from('comprobantes')
      .select('importe_total, estado')
      .eq('emisor_id', emisorId)
      .eq('estado', 'autorizado')
      .gte('created_at', inicioHoy.toISOString());

    const cantidadVentasHoy = ventasHoy?.length ?? 0;
    const totalVentasHoy = (ventasHoy ?? []).reduce((acc, v) => acc + Number(v.importe_total), 0);

    const { data: productosParaStock } = await supabase
      .from('productos')
      .select('stock_actual, stock_minimo')
      .eq('emisor_id', emisorId)
      .eq('activo', true);

    const productosStockBajo = (productosParaStock ?? []).filter(
      (p) => Number(p.stock_actual) <= Number(p.stock_minimo)
    ).length;

    const { count: proformasVigentes } = await supabase
      .from('proformas')
      .select('id', { count: 'exact', head: true })
      .eq('emisor_id', emisorId)
      .eq('estado', 'vigente');

    return reply.send({
      emisor: {
        ruc: emisor.ruc,
        razonSocial: emisor.razon_social,
        nombreComercial: emisor.nombre_comercial,
        ambiente: emisor.ambiente,
      },
      ventasHoy: { cantidad: cantidadVentasHoy, total: Math.round(totalVentasHoy * 100) / 100 },
      productosStockBajo,
      proformasVigentes: proformasVigentes ?? 0,
      errorVentas: errorVentas?.message,
    });
  });

  /**
   * Recupera el emisorId a partir del RUC — útil cuando el dueño del
   * negocio perdió el link con su emisorId (no hay sistema de login, así
   * que el link ES la llave de acceso).
   */
  app.get<{ Querystring: { ruc?: string } }>('/emisores/buscar', async (request, reply) => {
    const { ruc } = request.query;
    if (!ruc || !/^\d{13}$/.test(ruc)) {
      return reply.status(400).send({ error: 'Indica un RUC válido de 13 dígitos.' });
    }

    const { data, error } = await supabase.from('emisores').select('id, razon_social').eq('ruc', ruc).maybeSingle();
    if (error) return reply.status(500).send({ error: error.message });
    if (!data) return reply.status(404).send({ error: 'No se encontró ningún negocio registrado con ese RUC.' });

    return reply.send({ emisorId: data.id, razonSocial: data.razon_social });
  });
}
