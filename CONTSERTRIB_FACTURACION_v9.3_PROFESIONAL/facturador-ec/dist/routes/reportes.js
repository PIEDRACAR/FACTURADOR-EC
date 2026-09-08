import { supabase } from '../db/supabase.js';
import { generarExcelDesdeFilas } from '../services/excel.js';
import { generarPdfTabla } from '../services/pdfReportes.js';
/**
 * Toda la lógica de cada reporte vive en una función `obtener...` separada
 * del handler HTTP, para que tanto la ruta "ver en pantalla" (JSON) como la
 * ruta genérica de exportación (`/reportes/exportar`) usen exactamente la
 * misma consulta y el mismo cálculo — nunca se duplica la lógica entre las
 * dos formas de consumir un reporte.
 */
function rangoFechas(desde, hasta) {
    const hoy = new Date();
    const hace30Dias = new Date(hoy.getTime() - 30 * 24 * 60 * 60 * 1000);
    const fechaDesde = desde || hace30Dias.toISOString().slice(0, 10);
    const fechaHasta = hasta || hoy.toISOString().slice(0, 10);
    return { fechaDesde, fechaHasta, hastaFinDia: fechaHasta + 'T23:59:59' };
}
function redondear(v) {
    return Math.round(v * 100) / 100;
}
async function obtenerRentabilidad(emisorId, desde, hasta) {
    const { fechaDesde, fechaHasta, hastaFinDia } = rangoFechas(desde, hasta);
    const { data, error } = await supabase
        .from('comprobante_items')
        .select('producto_id, descripcion, cantidad, precio_total_sin_impuesto, costo_unitario_momento, utilidad_linea, comprobantes!inner(estado, created_at, emisor_id)')
        .eq('comprobantes.emisor_id', emisorId)
        .eq('comprobantes.estado', 'autorizado')
        .gte('comprobantes.created_at', fechaDesde)
        .lte('comprobantes.created_at', hastaFinDia);
    if (error)
        throw new Error(error.message);
    const filas = (data ?? []);
    const porProducto = new Map();
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
        cantidad: redondear(p.cantidad),
        ingresos: redondear(p.ingresos),
        costo: redondear(p.costo),
        utilidad: redondear(p.utilidad),
        margen: p.ingresos > 0 ? Math.round((p.utilidad / p.ingresos) * 1000) / 10 : 0,
    }))
        .sort((a, b) => b.utilidad - a.utilidad);
    const totales = productos.reduce((acc, p) => ({ ingresos: acc.ingresos + p.ingresos, costo: acc.costo + p.costo, utilidad: acc.utilidad + p.utilidad }), { ingresos: 0, costo: 0, utilidad: 0 });
    return {
        desde: fechaDesde,
        hasta: fechaHasta,
        productos,
        totales: {
            ingresos: redondear(totales.ingresos),
            costo: redondear(totales.costo),
            utilidad: redondear(totales.utilidad),
            margen: totales.ingresos > 0 ? Math.round((totales.utilidad / totales.ingresos) * 1000) / 10 : 0,
        },
    };
}
// ============================================================
// VENTAS POR PERÍODO (agregado día a día)
// ============================================================
async function obtenerVentasPeriodo(emisorId, desde, hasta) {
    const { fechaDesde, fechaHasta, hastaFinDia } = rangoFechas(desde, hasta);
    const { data, error } = await supabase
        .from('comprobantes')
        .select('importe_total, created_at')
        .eq('emisor_id', emisorId)
        .eq('estado', 'autorizado')
        .gte('created_at', fechaDesde)
        .lte('created_at', hastaFinDia);
    if (error)
        throw new Error(error.message);
    const porDia = new Map();
    for (const c of data ?? []) {
        const dia = String(c.created_at).slice(0, 10);
        const acc = porDia.get(dia) ?? { cantidad: 0, total: 0 };
        acc.cantidad += 1;
        acc.total = redondear(acc.total + Number(c.importe_total));
        porDia.set(dia, acc);
    }
    const dias = Array.from(porDia.entries())
        .map(([fecha, v]) => ({ fecha, ...v }))
        .sort((a, b) => a.fecha.localeCompare(b.fecha));
    const totalGeneral = redondear(dias.reduce((acc, d) => acc + d.total, 0));
    const cantidadFacturas = dias.reduce((acc, d) => acc + d.cantidad, 0);
    return {
        desde: fechaDesde,
        hasta: fechaHasta,
        dias,
        totales: {
            totalVentas: totalGeneral,
            cantidadFacturas,
            promedioFactura: cantidadFacturas > 0 ? redondear(totalGeneral / cantidadFacturas) : 0,
        },
    };
}
// ============================================================
// LISTADO DE VENTAS (detalle, una fila por factura)
// ============================================================
async function obtenerListadoVentas(emisorId, desde, hasta) {
    const { fechaDesde, fechaHasta, hastaFinDia } = rangoFechas(desde, hasta);
    const { data, error } = await supabase
        .from('comprobantes')
        .select('id, secuencial, created_at, importe_total, total_iva, estado, clientes(razon_social, email)')
        .eq('emisor_id', emisorId)
        .gte('created_at', fechaDesde)
        .lte('created_at', hastaFinDia)
        .order('created_at', { ascending: false });
    if (error)
        throw new Error(error.message);
    const ventas = (data ?? []).map((v) => ({
        id: v.id,
        fecha: String(v.created_at).slice(0, 10),
        secuencial: v.secuencial ?? '—',
        cliente: v.clientes?.razon_social ?? 'Consumidor Final',
        email: v.clientes?.email ?? '',
        iva: redondear(Number(v.total_iva)),
        total: redondear(Number(v.importe_total)),
        estado: v.estado,
    }));
    const totalGeneral = redondear(ventas.filter((v) => v.estado === 'autorizado').reduce((acc, v) => acc + v.total, 0));
    return { desde: fechaDesde, hasta: fechaHasta, ventas, totalGeneral };
}
// ============================================================
// LISTADO DE COMPRAS (entradas de inventario, detalle)
// ============================================================
async function obtenerListadoCompras(emisorId, desde, hasta) {
    const { fechaDesde, fechaHasta, hastaFinDia } = rangoFechas(desde, hasta);
    const { data, error } = await supabase
        .from('movimientos_inventario')
        .select('created_at, cantidad, costo_unitario, nota, productos(descripcion), proveedores(razon_social)')
        .eq('emisor_id', emisorId)
        .eq('tipo', 'entrada')
        .gte('created_at', fechaDesde)
        .lte('created_at', hastaFinDia)
        .order('created_at', { ascending: false });
    if (error)
        throw new Error(error.message);
    const compras = (data ?? []).map((c) => ({
        fecha: String(c.created_at).slice(0, 10),
        producto: c.productos?.descripcion ?? '—',
        proveedor: c.proveedores?.razon_social ?? (c.nota || '—'),
        cantidad: Number(c.cantidad),
        costoUnitario: redondear(Number(c.costo_unitario)),
        total: redondear(Number(c.cantidad) * Number(c.costo_unitario)),
    }));
    const totalGeneral = redondear(compras.reduce((acc, c) => acc + c.total, 0));
    return { desde: fechaDesde, hasta: fechaHasta, compras, totalGeneral };
}
// ============================================================
// REPORTE DE CLIENTES (cuánto ha comprado cada uno)
// ============================================================
async function obtenerReporteClientes(emisorId, desde, hasta) {
    const { fechaDesde, hastaFinDia } = rangoFechas(desde, hasta);
    const { data, error } = await supabase
        .from('comprobantes')
        .select('importe_total, cliente_id, clientes(razon_social, identificacion)')
        .eq('emisor_id', emisorId)
        .eq('estado', 'autorizado')
        .gte('created_at', fechaDesde)
        .lte('created_at', hastaFinDia);
    if (error)
        throw new Error(error.message);
    const porCliente = new Map();
    for (const v of data ?? []) {
        const cli = v.clientes;
        if (!cli)
            continue;
        const clave = v.cliente_id;
        const acc = porCliente.get(clave) ?? { cliente: cli.razon_social, identificacion: cli.identificacion, cantidadCompras: 0, totalComprado: 0 };
        acc.cantidadCompras += 1;
        acc.totalComprado = redondear(acc.totalComprado + Number(v.importe_total));
        porCliente.set(clave, acc);
    }
    const clientes = Array.from(porCliente.values()).sort((a, b) => b.totalComprado - a.totalComprado);
    return { clientes, totalGeneral: redondear(clientes.reduce((acc, c) => acc + c.totalComprado, 0)) };
}
// ============================================================
// REPORTE DE PROVEEDORES (cuánto se les ha comprado)
// ============================================================
async function obtenerReporteProveedores(emisorId, desde, hasta) {
    const { fechaDesde, hastaFinDia } = rangoFechas(desde, hasta);
    const { data, error } = await supabase
        .from('movimientos_inventario')
        .select('cantidad, costo_unitario, proveedor_id, proveedores(razon_social, identificacion)')
        .eq('emisor_id', emisorId)
        .eq('tipo', 'entrada')
        .not('proveedor_id', 'is', null)
        .gte('created_at', fechaDesde)
        .lte('created_at', hastaFinDia);
    if (error)
        throw new Error(error.message);
    const porProveedor = new Map();
    for (const m of data ?? []) {
        const prov = m.proveedores;
        if (!prov)
            continue;
        const clave = m.proveedor_id;
        const acc = porProveedor.get(clave) ?? { proveedor: prov.razon_social, identificacion: prov.identificacion, cantidadCompras: 0, totalComprado: 0 };
        acc.cantidadCompras += 1;
        acc.totalComprado = redondear(acc.totalComprado + Number(m.cantidad) * Number(m.costo_unitario));
        porProveedor.set(clave, acc);
    }
    const proveedores = Array.from(porProveedor.values()).sort((a, b) => b.totalComprado - a.totalComprado);
    return { proveedores, totalGeneral: redondear(proveedores.reduce((acc, p) => acc + p.totalComprado, 0)) };
}
// ============================================================
// CUENTAS POR COBRAR / PAGAR — resumen + listado detallado
// ============================================================
async function obtenerResumenCxC(emisorId) {
    const { data, error } = await supabase
        .from('cuentas_por_cobrar')
        .select('monto_total, monto_cobrado, fecha_vencimiento, estado')
        .eq('emisor_id', emisorId)
        .eq('estado', 'pendiente');
    if (error)
        throw new Error(error.message);
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
    return {
        totalPendiente: redondear(totalPendiente),
        totalVencido: redondear(totalVencido),
        cantidadCuentasPendientes: (data ?? []).length,
        cantidadVencidas,
    };
}
async function obtenerResumenCxP(emisorId) {
    const { data, error } = await supabase
        .from('cuentas_por_pagar')
        .select('monto_total, monto_pagado, fecha_vencimiento, estado')
        .eq('emisor_id', emisorId)
        .eq('estado', 'pendiente');
    if (error)
        throw new Error(error.message);
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
    return {
        totalPendiente: redondear(totalPendiente),
        totalVencido: redondear(totalVencido),
        cantidadCuentasPendientes: (data ?? []).length,
        cantidadVencidas,
    };
}
async function obtenerListadoCxC(emisorId) {
    const hoy = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase
        .from('cuentas_por_cobrar')
        .select('concepto, fecha_vencimiento, monto_total, monto_cobrado, estado, clientes(razon_social)')
        .eq('emisor_id', emisorId)
        .order('fecha_vencimiento', { ascending: true });
    if (error)
        throw new Error(error.message);
    return (data ?? []).map((c) => ({
        cliente: c.clientes?.razon_social ?? '—',
        concepto: c.concepto,
        vencimiento: c.fecha_vencimiento,
        montoTotal: redondear(Number(c.monto_total)),
        saldo: redondear(Number(c.monto_total) - Number(c.monto_cobrado)),
        estado: c.estado === 'pendiente' && c.fecha_vencimiento < hoy ? 'vencida' : c.estado,
    }));
}
async function obtenerListadoCxP(emisorId) {
    const hoy = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase
        .from('cuentas_por_pagar')
        .select('concepto, fecha_vencimiento, monto_total, monto_pagado, estado, proveedores(razon_social)')
        .eq('emisor_id', emisorId)
        .order('fecha_vencimiento', { ascending: true });
    if (error)
        throw new Error(error.message);
    return (data ?? []).map((c) => ({
        proveedor: c.proveedores?.razon_social ?? '—',
        concepto: c.concepto,
        vencimiento: c.fecha_vencimiento,
        montoTotal: redondear(Number(c.monto_total)),
        saldo: redondear(Number(c.monto_total) - Number(c.monto_pagado)),
        estado: c.estado === 'pendiente' && c.fecha_vencimiento < hoy ? 'vencida' : c.estado,
    }));
}
// ============================================================
// INVENTARIO VALORIZADO
// ============================================================
async function obtenerInventarioValorizado(emisorId) {
    const { data, error } = await supabase
        .from('productos')
        .select('descripcion, codigo_principal, stock_actual, costo_promedio')
        .eq('emisor_id', emisorId)
        .eq('activo', true)
        .gt('stock_actual', 0)
        .order('descripcion', { ascending: true });
    if (error)
        throw new Error(error.message);
    const productos = (data ?? []).map((p) => ({
        descripcion: p.descripcion,
        codigoPrincipal: p.codigo_principal,
        stock: Number(p.stock_actual),
        costoPromedio: Number(p.costo_promedio),
        valorTotal: redondear(Number(p.stock_actual) * Number(p.costo_promedio)),
    }));
    return { productos, valorTotalInventario: redondear(productos.reduce((acc, p) => acc + p.valorTotal, 0)) };
}
// ============================================================
// RUTAS
// ============================================================
export async function registrarRutasReportes(app) {
    app.get('/reportes/caja', async (request, reply) => {
        const { emisorId, desde, hasta } = request.query;
        if (!emisorId)
            return reply.status(400).send({ error: 'Falta emisorId.' });
        let q = supabase.from('cajas').select('id, fecha_apertura, fecha_cierre, monto_inicial, efectivo_declarado, diferencia, estado, nota').eq('emisor_id', emisorId).order('fecha_apertura', { ascending: false });
        if (desde)
            q = q.gte('fecha_apertura', desde);
        if (hasta)
            q = q.lte('fecha_apertura', hasta + 'T23:59:59');
        const { data, error } = await q.limit(500);
        if (error)
            return reply.status(500).send({ error: error.message });
        return reply.send(data ?? []);
    });
    app.get('/reportes/rentabilidad', async (request, reply) => {
        const { emisorId, desde, hasta } = request.query;
        if (!emisorId)
            return reply.status(400).send({ error: 'Falta el parámetro emisorId.' });
        try {
            return reply.send(await obtenerRentabilidad(emisorId, desde, hasta));
        }
        catch (err) {
            return reply.status(500).send({ error: err instanceof Error ? err.message : String(err) });
        }
    });
    app.get('/reportes/ventas-periodo', async (request, reply) => {
        const { emisorId, desde, hasta } = request.query;
        if (!emisorId)
            return reply.status(400).send({ error: 'Falta el parámetro emisorId.' });
        try {
            return reply.send(await obtenerVentasPeriodo(emisorId, desde, hasta));
        }
        catch (err) {
            return reply.status(500).send({ error: err instanceof Error ? err.message : String(err) });
        }
    });
    app.get('/reportes/ventas', async (request, reply) => {
        const { emisorId, desde, hasta } = request.query;
        if (!emisorId)
            return reply.status(400).send({ error: 'Falta el parámetro emisorId.' });
        try {
            return reply.send(await obtenerListadoVentas(emisorId, desde, hasta));
        }
        catch (err) {
            return reply.status(500).send({ error: err instanceof Error ? err.message : String(err) });
        }
    });
    app.get('/reportes/proformas', async (request, reply) => {
        const { emisorId } = request.query;
        if (!emisorId)
            return reply.status(400).send({ error: 'Falta el parámetro emisorId.' });
        const { data, error } = await supabase.from('proformas').select('numero_proforma, fecha_emision, fecha_validez, estado, total, clientes(razon_social)').eq('emisor_id', emisorId).order('created_at', { ascending: false });
        if (error)
            return reply.status(500).send({ error: error.message });
        return reply.send((data ?? []).map((p) => ({ numero: p.numero_proforma, fechaEmision: p.fecha_emision, fechaValidez: p.fecha_validez, cliente: p.clientes?.razon_social ?? '—', estado: p.estado, total: Number(p.total) })));
    });
    app.get('/reportes/compras', async (request, reply) => {
        const { emisorId, desde, hasta } = request.query;
        if (!emisorId)
            return reply.status(400).send({ error: 'Falta el parámetro emisorId.' });
        try {
            return reply.send(await obtenerListadoCompras(emisorId, desde, hasta));
        }
        catch (err) {
            return reply.status(500).send({ error: err instanceof Error ? err.message : String(err) });
        }
    });
    app.get('/reportes/clientes', async (request, reply) => {
        const { emisorId, desde, hasta } = request.query;
        if (!emisorId)
            return reply.status(400).send({ error: 'Falta el parámetro emisorId.' });
        try {
            return reply.send(await obtenerReporteClientes(emisorId, desde, hasta));
        }
        catch (err) {
            return reply.status(500).send({ error: err instanceof Error ? err.message : String(err) });
        }
    });
    app.get('/reportes/proveedores', async (request, reply) => {
        const { emisorId, desde, hasta } = request.query;
        if (!emisorId)
            return reply.status(400).send({ error: 'Falta el parámetro emisorId.' });
        try {
            return reply.send(await obtenerReporteProveedores(emisorId, desde, hasta));
        }
        catch (err) {
            return reply.status(500).send({ error: err instanceof Error ? err.message : String(err) });
        }
    });
    app.get('/reportes/cuentas-por-cobrar', async (request, reply) => {
        const { emisorId } = request.query;
        if (!emisorId)
            return reply.status(400).send({ error: 'Falta el parámetro emisorId.' });
        try {
            return reply.send(await obtenerResumenCxC(emisorId));
        }
        catch (err) {
            return reply.status(500).send({ error: err instanceof Error ? err.message : String(err) });
        }
    });
    app.get('/reportes/cuentas-por-pagar', async (request, reply) => {
        const { emisorId } = request.query;
        if (!emisorId)
            return reply.status(400).send({ error: 'Falta el parámetro emisorId.' });
        try {
            return reply.send(await obtenerResumenCxP(emisorId));
        }
        catch (err) {
            return reply.status(500).send({ error: err instanceof Error ? err.message : String(err) });
        }
    });
    app.get('/reportes/inventario-valorizado', async (request, reply) => {
        const { emisorId } = request.query;
        if (!emisorId)
            return reply.status(400).send({ error: 'Falta el parámetro emisorId.' });
        try {
            return reply.send(await obtenerInventarioValorizado(emisorId));
        }
        catch (err) {
            return reply.status(500).send({ error: err instanceof Error ? err.message : String(err) });
        }
    });
    // --------------------------------------------
    // EXPORTACIÓN GENÉRICA (Excel / PDF) — un solo endpoint para todos los
    // tipos de reporte, para no duplicar el mecanismo de exportar 9 veces.
    // --------------------------------------------
    app.get('/reportes/exportar', async (request, reply) => {
        const { emisorId, tipo, formato, desde, hasta } = request.query;
        if (!emisorId)
            return reply.status(400).send({ error: 'Falta el parámetro emisorId.' });
        if (!tipo)
            return reply.status(400).send({ error: 'Falta el parámetro tipo.' });
        if (formato !== 'excel' && formato !== 'pdf')
            return reply.status(400).send({ error: 'formato debe ser excel o pdf.' });
        let config;
        try {
            switch (tipo) {
                case 'rentabilidad': {
                    const r = await obtenerRentabilidad(emisorId, desde, hasta);
                    config = {
                        titulo: 'Rentabilidad por producto',
                        columnas: [
                            { clave: 'descripcion', etiqueta: 'Producto', ancho: 200 },
                            { clave: 'cantidad', etiqueta: 'Cantidad', ancho: 90, alinearDerecha: true },
                            { clave: 'ingresos', etiqueta: 'Ingresos', ancho: 90, alinearDerecha: true },
                            { clave: 'costo', etiqueta: 'Costo', ancho: 90, alinearDerecha: true },
                            { clave: 'utilidad', etiqueta: 'Utilidad', ancho: 90, alinearDerecha: true },
                            { clave: 'margen', etiqueta: 'Margen %', ancho: 90, alinearDerecha: true },
                        ],
                        filas: r.productos,
                        filaTotales: { descripcion: 'TOTAL', ingresos: r.totales.ingresos, costo: r.totales.costo, utilidad: r.totales.utilidad, margen: r.totales.margen },
                    };
                    break;
                }
                case 'ventas-periodo': {
                    const r = await obtenerVentasPeriodo(emisorId, desde, hasta);
                    config = {
                        titulo: 'Ventas por período',
                        columnas: [
                            { clave: 'fecha', etiqueta: 'Fecha', ancho: 150 },
                            { clave: 'cantidad', etiqueta: 'N.° facturas', ancho: 150, alinearDerecha: true },
                            { clave: 'total', etiqueta: 'Total vendido', ancho: 150, alinearDerecha: true },
                        ],
                        filas: r.dias,
                        filaTotales: { fecha: 'TOTAL', cantidad: r.totales.cantidadFacturas, total: r.totales.totalVentas },
                    };
                    break;
                }
                case 'ventas': {
                    const r = await obtenerListadoVentas(emisorId, desde, hasta);
                    config = {
                        titulo: 'Listado de ventas',
                        columnas: [
                            { clave: 'fecha', etiqueta: 'Fecha', ancho: 110 },
                            { clave: 'secuencial', etiqueta: 'N.° comprobante', ancho: 150 },
                            { clave: 'cliente', etiqueta: 'Cliente', ancho: 220 },
                            { clave: 'iva', etiqueta: 'IVA', ancho: 90, alinearDerecha: true },
                            { clave: 'total', etiqueta: 'Total', ancho: 90, alinearDerecha: true },
                            { clave: 'estado', etiqueta: 'Estado', ancho: 110 },
                        ],
                        filas: r.ventas,
                        filaTotales: { fecha: 'TOTAL', total: r.totalGeneral },
                    };
                    break;
                }
                case 'compras': {
                    const r = await obtenerListadoCompras(emisorId, desde, hasta);
                    config = {
                        titulo: 'Listado de compras',
                        columnas: [
                            { clave: 'fecha', etiqueta: 'Fecha', ancho: 110 },
                            { clave: 'producto', etiqueta: 'Producto', ancho: 200 },
                            { clave: 'proveedor', etiqueta: 'Proveedor', ancho: 200 },
                            { clave: 'cantidad', etiqueta: 'Cantidad', ancho: 90, alinearDerecha: true },
                            { clave: 'costoUnitario', etiqueta: 'Costo unit.', ancho: 90, alinearDerecha: true },
                            { clave: 'total', etiqueta: 'Total', ancho: 90, alinearDerecha: true },
                        ],
                        filas: r.compras,
                        filaTotales: { fecha: 'TOTAL', total: r.totalGeneral },
                    };
                    break;
                }
                case 'clientes': {
                    const r = await obtenerReporteClientes(emisorId, desde, hasta);
                    config = {
                        titulo: 'Reporte de clientes',
                        columnas: [
                            { clave: 'cliente', etiqueta: 'Cliente', ancho: 250 },
                            { clave: 'identificacion', etiqueta: 'Identificación', ancho: 150 },
                            { clave: 'cantidadCompras', etiqueta: 'N.° compras', ancho: 120, alinearDerecha: true },
                            { clave: 'totalComprado', etiqueta: 'Total comprado', ancho: 150, alinearDerecha: true },
                        ],
                        filas: r.clientes,
                        filaTotales: { cliente: 'TOTAL', totalComprado: r.totalGeneral },
                    };
                    break;
                }
                case 'proveedores': {
                    const r = await obtenerReporteProveedores(emisorId, desde, hasta);
                    config = {
                        titulo: 'Reporte de proveedores',
                        columnas: [
                            { clave: 'proveedor', etiqueta: 'Proveedor', ancho: 250 },
                            { clave: 'identificacion', etiqueta: 'Identificación', ancho: 150 },
                            { clave: 'cantidadCompras', etiqueta: 'N.° compras', ancho: 120, alinearDerecha: true },
                            { clave: 'totalComprado', etiqueta: 'Total comprado', ancho: 150, alinearDerecha: true },
                        ],
                        filas: r.proveedores,
                        filaTotales: { proveedor: 'TOTAL', totalComprado: r.totalGeneral },
                    };
                    break;
                }
                case 'cuentas-por-cobrar': {
                    const filas = await obtenerListadoCxC(emisorId);
                    config = {
                        titulo: 'Cuentas por cobrar',
                        columnas: [
                            { clave: 'cliente', etiqueta: 'Cliente', ancho: 200 },
                            { clave: 'concepto', etiqueta: 'Concepto', ancho: 220 },
                            { clave: 'vencimiento', etiqueta: 'Vencimiento', ancho: 110 },
                            { clave: 'saldo', etiqueta: 'Saldo', ancho: 90, alinearDerecha: true },
                            { clave: 'estado', etiqueta: 'Estado', ancho: 110 },
                        ],
                        filas,
                    };
                    break;
                }
                case 'cuentas-por-pagar': {
                    const filas = await obtenerListadoCxP(emisorId);
                    config = {
                        titulo: 'Cuentas por pagar',
                        columnas: [
                            { clave: 'proveedor', etiqueta: 'Proveedor', ancho: 200 },
                            { clave: 'concepto', etiqueta: 'Concepto', ancho: 220 },
                            { clave: 'vencimiento', etiqueta: 'Vencimiento', ancho: 110 },
                            { clave: 'saldo', etiqueta: 'Saldo', ancho: 90, alinearDerecha: true },
                            { clave: 'estado', etiqueta: 'Estado', ancho: 110 },
                        ],
                        filas,
                    };
                    break;
                }
                case 'caja': {
                    const q = await supabase.from('cajas').select('id, fecha_apertura, fecha_cierre, monto_inicial, efectivo_declarado, diferencia, estado, nota').eq('emisor_id', emisorId).order('fecha_apertura', { ascending: false });
                    if (q.error)
                        throw new Error(q.error.message);
                    const filas = (q.data ?? []).map((x) => ({ ...x, montoInicial: Number(x.monto_inicial), efectivoDeclarado: x.efectivo_declarado == null ? null : Number(x.efectivo_declarado), diferencia: x.diferencia == null ? null : Number(x.diferencia) }));
                    config = { titulo: 'Caja / arqueos', columnas: [
                            { clave: 'fecha_apertura', etiqueta: 'Apertura', ancho: 150 }, { clave: 'fecha_cierre', etiqueta: 'Cierre', ancho: 150 },
                            { clave: 'montoInicial', etiqueta: 'Inicial', ancho: 90, alinearDerecha: true }, { clave: 'efectivoDeclarado', etiqueta: 'Contado', ancho: 90, alinearDerecha: true },
                            { clave: 'diferencia', etiqueta: 'Diferencia', ancho: 90, alinearDerecha: true }, { clave: 'estado', etiqueta: 'Estado', ancho: 90 }
                        ], filas };
                    break;
                }
                case 'proformas': {
                    const q = await supabase.from('proformas').select('numero_proforma, fecha_emision, fecha_validez, estado, total, clientes(razon_social)').eq('emisor_id', emisorId).order('created_at', { ascending: false });
                    if (q.error)
                        throw new Error(q.error.message);
                    const filas = (q.data ?? []).map((p) => ({
                        numero: p.numero_proforma,
                        fechaEmision: p.fecha_emision,
                        fechaValidez: p.fecha_validez,
                        cliente: p.clientes?.razon_social ?? '—',
                        estado: p.estado,
                        total: Number(p.total),
                    }));
                    config = { titulo: 'Proformas', columnas: [
                            { clave: 'numero', etiqueta: 'Número', ancho: 100 }, { clave: 'fechaEmision', etiqueta: 'Emisión', ancho: 100 }, { clave: 'fechaValidez', etiqueta: 'Validez', ancho: 100 },
                            { clave: 'cliente', etiqueta: 'Cliente', ancho: 220 }, { clave: 'estado', etiqueta: 'Estado', ancho: 100 }, { clave: 'total', etiqueta: 'Total', ancho: 90, alinearDerecha: true }
                        ], filas };
                    break;
                }
                case 'inventario-valorizado': {
                    const r = await obtenerInventarioValorizado(emisorId);
                    config = {
                        titulo: 'Inventario valorizado',
                        columnas: [
                            { clave: 'descripcion', etiqueta: 'Producto', ancho: 220 },
                            { clave: 'codigoPrincipal', etiqueta: 'Código', ancho: 120 },
                            { clave: 'stock', etiqueta: 'Stock', ancho: 90, alinearDerecha: true },
                            { clave: 'costoPromedio', etiqueta: 'Costo prom.', ancho: 100, alinearDerecha: true },
                            { clave: 'valorTotal', etiqueta: 'Valor total', ancho: 100, alinearDerecha: true },
                        ],
                        filas: r.productos,
                        filaTotales: { descripcion: 'TOTAL', valorTotal: r.valorTotalInventario },
                    };
                    break;
                }
                default:
                    return reply.status(400).send({ error: `Tipo de reporte desconocido: ${tipo}` });
            }
        }
        catch (err) {
            return reply.status(500).send({ error: err instanceof Error ? err.message : String(err) });
        }
        const nombreArchivo = `${tipo}-${new Date().toISOString().slice(0, 10)}`;
        if (formato === 'excel') {
            const buffer = await generarExcelDesdeFilas(config.titulo, config.columnas.map((c) => ({ clave: c.clave, etiqueta: c.etiqueta })), config.filas);
            reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            reply.header('Content-Disposition', `attachment; filename="${nombreArchivo}.xlsx"`);
            return reply.send(buffer);
        }
        else {
            const buffer = await generarPdfTabla({
                titulo: config.titulo,
                subtitulo: desde && hasta ? `Del ${desde} al ${hasta}` : undefined,
                columnas: config.columnas,
                filas: config.filas,
                filaTotales: config.filaTotales,
            });
            reply.header('Content-Type', 'application/pdf');
            reply.header('Content-Disposition', `attachment; filename="${nombreArchivo}.pdf"`);
            return reply.send(buffer);
        }
    });
}
//# sourceMappingURL=reportes.js.map