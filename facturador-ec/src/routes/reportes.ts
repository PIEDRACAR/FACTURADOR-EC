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
}
