import type { FastifyInstance } from 'fastify';
import { supabase } from '../db/supabase.js';
import { fechaIsoEcuador } from '../utils/fechaEcuador.js';

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
      .select('stock_actual, stock_critico, stock_minimo, stock_maximo')
      .eq('emisor_id', emisorId)
      .eq('activo', true);

    const inventarioEstados = (productosParaStock ?? []).map((p) => {
      const stock = Number(p.stock_actual);
      const critico = Number(p.stock_critico ?? 0);
      const minimo = Number(p.stock_minimo ?? 0);
      const maximo = p.stock_maximo == null ? null : Number(p.stock_maximo);
      if (stock <= critico) return 'stop';
      if (stock <= minimo) return 'bajo';
      if (maximo !== null && stock > maximo) return 'sobrestock';
      return 'normal';
    });
    const productosStop = inventarioEstados.filter((e) => e === 'stop').length;
    const productosStockBajo = inventarioEstados.filter((e) => e === 'bajo').length;
    const productosSobrestock = inventarioEstados.filter((e) => e === 'sobrestock').length;

    const inicioMes = new Date();
    inicioMes.setDate(1);
    inicioMes.setHours(0, 0, 0, 0);

    const { data: ventasMesData } = await supabase
      .from('comprobantes')
      .select('id, secuencial, importe_total, created_at, clientes(razon_social, email)')
      .eq('emisor_id', emisorId)
      .eq('estado', 'autorizado')
      .gte('created_at', inicioMes.toISOString())
      .order('created_at', { ascending: false });

    const ventasMes = (ventasMesData ?? []).reduce((a, v) => a + Number(v.importe_total || 0), 0);
    const facturasMes = ventasMesData?.length ?? 0;

    const hoyEc=fechaIsoEcuador(new Date());
    const inicio7Key=new Date(`${hoyEc}T12:00:00-05:00`); inicio7Key.setDate(inicio7Key.getDate()-6);
    const inicio7Utc=new Date(`${inicio7Key.toISOString().slice(0,10)}T00:00:00-05:00`).toISOString();
    const { data: ventas7Data } = await supabase.from('comprobantes').select('importe_total, created_at').eq('emisor_id', emisorId).eq('estado', 'autorizado').gte('created_at', inicio7Utc);
    const ventasUltimos7Dias = Array.from({ length: 7 }, (_, i) => {
      const fecha=new Date(inicio7Key); fecha.setDate(inicio7Key.getDate()+i); const key=fecha.toISOString().slice(0,10);
      const total=(ventas7Data??[]).filter(v=>fechaIsoEcuador(new Date(v.created_at))===key).reduce((a,v)=>a+Number(v.importe_total||0),0);
      return { key, label: new Intl.DateTimeFormat('es-EC',{timeZone:'America/Guayaquil',weekday:'short',day:'2-digit'}).format(new Date(`${key}T12:00:00-05:00`)), total:Math.round(total*100)/100 };
    });

    const { count: productosTotal } = await supabase
      .from('productos')
      .select('id', { count: 'exact', head: true })
      .eq('emisor_id', emisorId)
      .eq('activo', true);

    const { data: cajaAbierta } = await supabase
      .from('cajas')
      .select('id, monto_inicial, fecha_apertura')
      .eq('emisor_id', emisorId)
      .eq('estado', 'abierta')
      .maybeSingle();

    let cajaActual = Number(cajaAbierta?.monto_inicial ?? 0);
    if (cajaAbierta?.id) {
      const { data: pagosCaja } = await supabase
        .from('comprobantes')
        .select('importe_total, comprobante_formas_pago(forma_pago_codigo, valor)')
        .eq('emisor_id', emisorId)
        .eq('estado', 'autorizado')
        .gte('created_at', cajaAbierta.fecha_apertura);
      for (const venta of pagosCaja ?? []) {
        for (const pago of ((venta.comprobante_formas_pago ?? []) as Array<{ forma_pago_codigo?: string; valor?: number }>)) {
          if (pago.forma_pago_codigo === '01') cajaActual += Number(pago.valor || 0);
        }
      }
      const { data: movimientos } = await supabase.from('movimientos_caja').select('tipo, monto, forma_pago').eq('caja_id', cajaAbierta.id);
      for (const m of movimientos ?? []) if (m.forma_pago === '01') cajaActual += m.tipo === 'ingreso' ? Number(m.monto || 0) : -Number(m.monto || 0);
    }

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
      ventasMes: Math.round(ventasMes * 100) / 100,
      facturasMes,
      productosTotal: productosTotal ?? 0,
      cajaActual: Math.round(cajaActual * 100) / 100,
      ventasUltimos7Dias,
      ventasRecientes: (ventasMesData ?? []).slice(0, 6).map(v => ({
        id: v.id, secuencial: v.secuencial, importe_total: v.importe_total, created_at: v.created_at,
        cliente: Array.isArray(v.clientes) ? (v.clientes[0]?.razon_social ?? 'Consumidor Final') : ((v.clientes as any)?.razon_social ?? 'Consumidor Final'),
        email: Array.isArray(v.clientes) ? (v.clientes[0]?.email ?? '') : ((v.clientes as any)?.email ?? ''),
      })),
      productosStockBajo,
      productosStop,
      productosSobrestock,
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
