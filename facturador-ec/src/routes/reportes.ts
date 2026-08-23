import type { FastifyInstance } from 'fastify';
import { supabase } from '../db/supabase.js';

/**
 * Reporte de rentabilidad por producto. Se apoya en `comprobante_items`,
 * que ya guarda `costo_unitario_momento` (el costo real al momento exacto
 * de la venta, no el costo actual) y tiene una columna calculada
 * (`utilidad_linea`) — así que la utilidad por línea no hay que
 * recalcularla aquí, solo sumarla.
 *
 * Se agrega en memoria (JavaScript) en vez de con una función SQL: para el
 * volumen de datos típico de un negocio pequeño/mediano (miles de líneas,
 * no millones) es más simple de mantener y suficientemente rápido, sin
 * sacrificar la exactitud de la utilidad ya calculada en cada línea.
 */

interface FilaItem {
  producto_id: string | null;
  descripcion: string;
  cantidad: number;
  precio_total_sin_impuesto: number;
  costo_unitario_momento: number;
  utilidad_linea: number;
}

export async function registrarRutasReportes(app: FastifyInstance) {
  app.get<{ Querystring: { emisorId?: string; desde?: string; hasta?: string } }>(
    '/reportes/rentabilidad',
    async (request, reply) => {
      const { emisorId, desde, hasta } = request.query;
      if (!emisorId) return reply.status(400).send({ error: 'Falta el parámetro emisorId.' });

      const hoy = new Date();
      const hace30Dias = new Date(hoy.getTime() - 30 * 24 * 60 * 60 * 1000);
      const fechaDesde = desde || hace30Dias.toISOString().slice(0, 10);
      const fechaHasta = hasta || hoy.toISOString().slice(0, 10);
      // Incluye el día completo de "hasta".
      const hastaFinDia = fechaHasta + 'T23:59:59';

      const { data, error } = await supabase
        .from('comprobante_items')
        .select(
          'producto_id, descripcion, cantidad, precio_total_sin_impuesto, costo_unitario_momento, utilidad_linea, comprobantes!inner(estado, created_at, emisor_id)'
        )
        .eq('comprobantes.emisor_id', emisorId)
        .eq('comprobantes.estado', 'autorizado')
        .gte('comprobantes.created_at', fechaDesde)
        .lte('comprobantes.created_at', hastaFinDia);

      if (error) {
        return reply.status(500).send({ error: error.message });
      }

      const filas = (data ?? []) as unknown as FilaItem[];

      const porProducto = new Map<
        string,
        { descripcion: string; cantidad: number; ingresos: number; costo: number; utilidad: number }
      >();

      for (const f of filas) {
        const clave = f.producto_id ?? 'libre:' + f.descripcion;
        const acumulado = porProducto.get(clave) ?? { descripcion: f.descripcion, cantidad: 0, ingresos: 0, costo: 0, utilidad: 0 };
        acumulado.cantidad += Number(f.cantidad);
        acumulado.ingresos += Number(f.precio_total_sin_impuesto);
        acumulado.costo += Number(f.cantidad) * Number(f.costo_unitario_momento);
        acumulado.utilidad += Number(f.utilidad_linea);
        porProducto.set(clave, acumulado);
      }

      const productos = Array.from(porProducto.values())
        .map((p) => ({
          descripcion: p.descripcion,
          cantidad: Math.round(p.cantidad * 1000) / 1000,
          ingresos: Math.round(p.ingresos * 100) / 100,
          costo: Math.round(p.costo * 100) / 100,
          utilidad: Math.round(p.utilidad * 100) / 100,
          margen: p.ingresos > 0 ? Math.round((p.utilidad / p.ingresos) * 1000) / 10 : 0,
        }))
        .sort((a, b) => b.utilidad - a.utilidad);

      const totales = productos.reduce(
        (acc, p) => ({
          ingresos: acc.ingresos + p.ingresos,
          costo: acc.costo + p.costo,
          utilidad: acc.utilidad + p.utilidad,
        }),
        { ingresos: 0, costo: 0, utilidad: 0 }
      );

      return reply.send({
        desde: fechaDesde,
        hasta: fechaHasta,
        productos,
        totales: {
          ingresos: Math.round(totales.ingresos * 100) / 100,
          costo: Math.round(totales.costo * 100) / 100,
          utilidad: Math.round(totales.utilidad * 100) / 100,
          margen: totales.ingresos > 0 ? Math.round((totales.utilidad / totales.ingresos) * 1000) / 10 : 0,
        },
      });
    }
  );

  /** Ventas por período: totales agregados día a día, para ver la tendencia. */
  app.get<{ Querystring: { emisorId?: string; desde?: string; hasta?: string } }>(
    '/reportes/ventas-periodo',
    async (request, reply) => {
      const { emisorId, desde, hasta } = request.query;
      if (!emisorId) return reply.status(400).send({ error: 'Falta el parámetro emisorId.' });

      const hoy = new Date();
      const hace30Dias = new Date(hoy.getTime() - 30 * 24 * 60 * 60 * 1000);
      const fechaDesde = desde || hace30Dias.toISOString().slice(0, 10);
      const fechaHasta = hasta || hoy.toISOString().slice(0, 10);

      const { data, error } = await supabase
        .from('comprobantes')
        .select('importe_total, created_at')
        .eq('emisor_id', emisorId)
        .eq('estado', 'autorizado')
        .gte('created_at', fechaDesde)
        .lte('created_at', fechaHasta + 'T23:59:59');

      if (error) return reply.status(500).send({ error: error.message });

      const porDia = new Map<string, { cantidad: number; total: number }>();
      for (const c of data ?? []) {
        const dia = String(c.created_at).slice(0, 10);
        const acc = porDia.get(dia) ?? { cantidad: 0, total: 0 };
        acc.cantidad += 1;
        acc.total = Math.round((acc.total + Number(c.importe_total)) * 100) / 100;
        porDia.set(dia, acc);
      }

      const dias = Array.from(porDia.entries())
        .map(([fecha, v]) => ({ fecha, ...v }))
        .sort((a, b) => a.fecha.localeCompare(b.fecha));

      const totalGeneral = Math.round(dias.reduce((acc, d) => acc + d.total, 0) * 100) / 100;
      const cantidadFacturas = dias.reduce((acc, d) => acc + d.cantidad, 0);

      return reply.send({
        desde: fechaDesde,
        hasta: fechaHasta,
        dias,
        totales: {
          totalVentas: totalGeneral,
          cantidadFacturas,
          promedioFactura: cantidadFacturas > 0 ? Math.round((totalGeneral / cantidadFacturas) * 100) / 100 : 0,
        },
      });
    }
  );

  /** Resumen de cuentas por cobrar: pendiente, vencido, por vencer pronto. */
  app.get<{ Querystring: { emisorId?: string } }>('/reportes/cuentas-por-cobrar', async (request, reply) => {
    const { emisorId } = request.query;
    if (!emisorId) return reply.status(400).send({ error: 'Falta el parámetro emisorId.' });

    const { data, error } = await supabase
      .from('cuentas_por_cobrar')
      .select('monto_total, monto_cobrado, fecha_vencimiento, estado')
      .eq('emisor_id', emisorId)
      .eq('estado', 'pendiente');

    if (error) return reply.status(500).send({ error: error.message });

    const hoy = new Date().toISOString().slice(0, 10);
    let totalPendiente = 0;
    let totalVencido = 0;
    let cantidadVencidas = 0;

    for (const c of data ?? []) {
      const saldo = Number(c.monto_total) - Number(c.monto_cobrado);
      totalPendiente += saldo;
      if (c.fecha_vencimiento < hoy) {
        totalVencido += saldo;
        cantidadVencidas += 1;
      }
    }

    return reply.send({
      totalPendiente: Math.round(totalPendiente * 100) / 100,
      totalVencido: Math.round(totalVencido * 100) / 100,
      cantidadCuentasPendientes: (data ?? []).length,
      cantidadVencidas,
    });
  });

  /** Resumen de cuentas por pagar: pendiente, vencido. */
  app.get<{ Querystring: { emisorId?: string } }>('/reportes/cuentas-por-pagar', async (request, reply) => {
    const { emisorId } = request.query;
    if (!emisorId) return reply.status(400).send({ error: 'Falta el parámetro emisorId.' });

    const { data, error } = await supabase
      .from('cuentas_por_pagar')
      .select('monto_total, monto_pagado, fecha_vencimiento, estado')
      .eq('emisor_id', emisorId)
      .eq('estado', 'pendiente');

    if (error) return reply.status(500).send({ error: error.message });

    const hoy = new Date().toISOString().slice(0, 10);
    let totalPendiente = 0;
    let totalVencido = 0;
    let cantidadVencidas = 0;

    for (const c of data ?? []) {
      const saldo = Number(c.monto_total) - Number(c.monto_pagado);
      totalPendiente += saldo;
      if (c.fecha_vencimiento < hoy) {
        totalVencido += saldo;
        cantidadVencidas += 1;
      }
    }

    return reply.send({
      totalPendiente: Math.round(totalPendiente * 100) / 100,
      totalVencido: Math.round(totalVencido * 100) / 100,
      cantidadCuentasPendientes: (data ?? []).length,
      cantidadVencidas,
    });
  });

  /** Inventario valorizado: cuánto vale el stock actual, al costo promedio de cada producto. */
  app.get<{ Querystring: { emisorId?: string } }>('/reportes/inventario-valorizado', async (request, reply) => {
    const { emisorId } = request.query;
    if (!emisorId) return reply.status(400).send({ error: 'Falta el parámetro emisorId.' });

    const { data, error } = await supabase
      .from('productos')
      .select('descripcion, codigo_principal, stock_actual, costo_promedio')
      .eq('emisor_id', emisorId)
      .eq('activo', true)
      .gt('stock_actual', 0)
      .order('descripcion', { ascending: true });

    if (error) return reply.status(500).send({ error: error.message });

    const productos = (data ?? []).map((p) => ({
      descripcion: p.descripcion,
      codigoPrincipal: p.codigo_principal,
      stock: Number(p.stock_actual),
      costoPromedio: Number(p.costo_promedio),
      valorTotal: Math.round(Number(p.stock_actual) * Number(p.costo_promedio) * 100) / 100,
    }));

    const valorTotalInventario = Math.round(productos.reduce((acc, p) => acc + p.valorTotal, 0) * 100) / 100;

    return reply.send({ productos, valorTotalInventario });
  });
}
