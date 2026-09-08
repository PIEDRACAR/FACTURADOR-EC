import { supabase } from '../db/supabase.js';
import { generarExcelDesdeFilas } from '../services/excel.js';
import { generarPdfTabla } from '../services/pdfReportes.js';
/**
 * Este módulo cierra el ciclo de inventario: hasta ahora el stock solo
 * podía DESCONTARSE (al vender, vía `crear_venta`). Aquí se agrega la
 * otra mitad — registrar compras/entradas con su costo (recalculando el
 * costo promedio ponderado correctamente) y ajustes por conteo físico —
 * más el kardex para ver el historial completo de cada producto.
 */
export async function registrarRutasInventario(app) {
    /** Registra una entrada de mercadería (compra) y recalcula el costo promedio ponderado. */
    app.post('/inventario/entrada', async (request, reply) => {
        const { productoId, cantidad, costoUnitario, nota, proveedorId, esCredito, fechaVencimiento, numeroDocumento } = request.body ?? {};
        if (!productoId)
            return reply.status(400).send({ error: 'Falta productoId.' });
        if (!cantidad || cantidad <= 0)
            return reply.status(400).send({ error: 'La cantidad debe ser mayor a 0.' });
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
        let cuentaPorPagarId;
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
            if (!errorCuenta && cuenta)
                cuentaPorPagarId = cuenta.id;
        }
        return reply.status(201).send({
            stockResultante: resultado.stock_resultante,
            costoPromedioResultante: resultado.costo_promedio_resultante,
            cuentaPorPagarId,
        });
    });
    /** Ajusta el stock a un valor exacto (conteo físico), sin tocar el costo promedio. */
    app.post('/inventario/ajuste', async (request, reply) => {
        const { productoId, nuevoStock, motivo } = request.body ?? {};
        if (!productoId)
            return reply.status(400).send({ error: 'Falta productoId.' });
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
    app.get('/inventario/alertas', async (request, reply) => {
        const { emisorId, estado } = request.query;
        if (!emisorId)
            return reply.status(400).send({ error: 'Falta el parámetro emisorId.' });
        const { data, error } = await supabase
            .from('productos')
            .select('id, codigo_principal, descripcion, unidad_medida, stock_actual, stock_critico, stock_minimo, stock_maximo, precio_venta, costo_promedio, activo')
            .eq('emisor_id', emisorId)
            .eq('activo', true)
            .order('descripcion', { ascending: true });
        if (error)
            return reply.status(500).send({ error: error.message });
        const productos = (data ?? []).map((p) => {
            const stock = Number(p.stock_actual);
            const critico = Number(p.stock_critico ?? 0);
            const minimo = Number(p.stock_minimo ?? 0);
            const maximo = p.stock_maximo == null ? null : Number(p.stock_maximo);
            let estadoProducto;
            if (stock <= critico)
                estadoProducto = 'stop';
            else if (stock <= minimo)
                estadoProducto = 'bajo';
            else if (maximo !== null && stock > maximo)
                estadoProducto = 'sobrestock';
            else
                estadoProducto = 'normal';
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
    /** Exportaciones del módulo de inventario: semáforo, kardex/movimientos y valorizado. */
    app.get('/inventario/exportar', async (request, reply) => {
        const { emisorId, tipo = 'kardex', formato = 'excel', productoId } = request.query;
        if (!emisorId)
            return reply.status(400).send({ error: 'Falta emisorId.' });
        if (!['kardex', 'movimientos', 'semaforo', 'valorizado'].includes(tipo))
            return reply.status(400).send({ error: 'Tipo de exportación inválido.' });
        if (!['excel', 'pdf'].includes(formato))
            return reply.status(400).send({ error: 'formato debe ser excel o pdf.' });
        let titulo = '';
        let columnas = [];
        let filas = [];
        try {
            if (tipo === 'kardex' || tipo === 'movimientos') {
                let q = supabase
                    .from('movimientos_inventario')
                    .select('id, tipo, cantidad, costo_unitario, saldo_cantidad, saldo_costo_promedio, referencia_tipo, nota, created_at, productos(codigo_principal, descripcion)')
                    .eq('emisor_id', emisorId)
                    .order('created_at', { ascending: false })
                    .limit(2000);
                if (productoId)
                    q = q.eq('producto_id', productoId);
                const { data, error } = await q;
                if (error)
                    throw new Error(error.message);
                filas = (data ?? []).map((m) => {
                    const p = m.productos;
                    return {
                        fecha: String(m.created_at ?? '').replace('T', ' ').slice(0, 19),
                        codigo: p?.codigo_principal ?? '—',
                        producto: p?.descripcion ?? '—',
                        movimiento: m.tipo,
                        cantidad: Number(m.cantidad),
                        costoUnitario: Number(m.costo_unitario),
                        saldoCantidad: Number(m.saldo_cantidad),
                        saldoCosto: Number(m.saldo_costo_promedio),
                        referencia: m.referencia_tipo ?? '',
                        nota: m.nota ?? '',
                    };
                });
                titulo = tipo === 'kardex' ? 'Kardex de inventario' : 'Movimientos de inventario';
                columnas = [
                    { clave: 'fecha', etiqueta: 'Fecha', ancho: 125 }, { clave: 'codigo', etiqueta: 'Código', ancho: 90 }, { clave: 'producto', etiqueta: 'Producto', ancho: 190 },
                    { clave: 'movimiento', etiqueta: 'Movimiento', ancho: 90 }, { clave: 'cantidad', etiqueta: 'Cantidad', ancho: 75, alinearDerecha: true },
                    { clave: 'costoUnitario', etiqueta: 'Costo unit.', ancho: 80, alinearDerecha: true }, { clave: 'saldoCantidad', etiqueta: 'Saldo', ancho: 75, alinearDerecha: true },
                    { clave: 'saldoCosto', etiqueta: 'Costo prom.', ancho: 80, alinearDerecha: true }, { clave: 'referencia', etiqueta: 'Referencia', ancho: 100 }, { clave: 'nota', etiqueta: 'Nota', ancho: 170 },
                ];
            }
            else if (tipo === 'semaforo') {
                const { data, error } = await supabase.from('productos').select('codigo_principal, descripcion, unidad_medida, stock_actual, stock_critico, stock_minimo, stock_maximo, precio_venta, costo_promedio').eq('emisor_id', emisorId).eq('activo', true).order('descripcion', { ascending: true });
                if (error)
                    throw new Error(error.message);
                filas = (data ?? []).map((p) => {
                    const stock = Number(p.stock_actual), crit = Number(p.stock_critico ?? 0), min = Number(p.stock_minimo ?? 0), max = p.stock_maximo == null ? null : Number(p.stock_maximo);
                    const estado = stock <= crit ? 'STOP' : stock <= min ? 'STOCK BAJO' : (max !== null && stock > max) ? 'SOBRESTOCK' : 'NORMAL';
                    return { codigo: p.codigo_principal, producto: p.descripcion, unidad: p.unidad_medida, stock, critico: crit, minimo: min, maximo: max ?? '', estado, precio: Number(p.precio_venta), costo: Number(p.costo_promedio) };
                });
                titulo = 'Semáforo de inventario';
                columnas = [
                    { clave: 'codigo', etiqueta: 'Código', ancho: 90 }, { clave: 'producto', etiqueta: 'Producto', ancho: 200 }, { clave: 'unidad', etiqueta: 'Unidad', ancho: 70 },
                    { clave: 'stock', etiqueta: 'Stock', ancho: 70, alinearDerecha: true }, { clave: 'critico', etiqueta: 'STOP', ancho: 65, alinearDerecha: true }, { clave: 'minimo', etiqueta: 'Mínimo', ancho: 65, alinearDerecha: true },
                    { clave: 'maximo', etiqueta: 'Máximo', ancho: 65, alinearDerecha: true }, { clave: 'estado', etiqueta: 'Estado', ancho: 95 }, { clave: 'precio', etiqueta: 'PVP', ancho: 75, alinearDerecha: true }, { clave: 'costo', etiqueta: 'Costo', ancho: 75, alinearDerecha: true }
                ];
            }
            else {
                const { data, error } = await supabase.from('productos').select('codigo_principal, descripcion, stock_actual, costo_promedio').eq('emisor_id', emisorId).eq('activo', true).order('descripcion', { ascending: true });
                if (error)
                    throw new Error(error.message);
                filas = (data ?? []).map(p => ({ codigo: p.codigo_principal, producto: p.descripcion, stock: Number(p.stock_actual), costo: Number(p.costo_promedio), valor: Number(p.stock_actual) * Number(p.costo_promedio) }));
                titulo = 'Inventario valorizado';
                columnas = [{ clave: 'codigo', etiqueta: 'Código', ancho: 100 }, { clave: 'producto', etiqueta: 'Producto', ancho: 250 }, { clave: 'stock', etiqueta: 'Stock', ancho: 80, alinearDerecha: true }, { clave: 'costo', etiqueta: 'Costo promedio', ancho: 100, alinearDerecha: true }, { clave: 'valor', etiqueta: 'Valor total', ancho: 100, alinearDerecha: true }];
            }
        }
        catch (err) {
            return reply.status(500).send({ error: err instanceof Error ? err.message : String(err) });
        }
        const nombre = `${tipo}-inventario-${new Date().toISOString().slice(0, 10)}`;
        if (formato === 'excel') {
            const buffer = await generarExcelDesdeFilas(titulo, columnas.map(c => ({ clave: c.clave, etiqueta: c.etiqueta, ancho: Math.max(12, Math.round(c.ancho / 7)) })), filas);
            reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            reply.header('Content-Disposition', `attachment; filename="${nombre}.xlsx"`);
            return reply.send(buffer);
        }
        const buffer = await generarPdfTabla({ titulo, subtitulo: `Generado el ${new Date().toLocaleString('es-EC')}`, columnas, filas });
        reply.header('Content-Type', 'application/pdf');
        reply.header('Content-Disposition', `attachment; filename="${nombre}.pdf"`);
        return reply.send(buffer);
    });
    /** Kardex: historial de movimientos de inventario, opcionalmente filtrado por producto. */
    app.get('/inventario/kardex', async (request, reply) => {
        const { emisorId, productoId, limite } = request.query;
        if (!emisorId)
            return reply.status(400).send({ error: 'Falta el parámetro emisorId.' });
        let consulta = supabase
            .from('movimientos_inventario')
            .select('id, tipo, cantidad, costo_unitario, saldo_cantidad, saldo_costo_promedio, referencia_tipo, nota, created_at, productos(codigo_principal, descripcion)')
            .eq('emisor_id', emisorId)
            .order('created_at', { ascending: false })
            .limit(Math.min(Number(limite) || 100, 300));
        if (productoId)
            consulta = consulta.eq('producto_id', productoId);
        const { data, error } = await consulta;
        if (error)
            return reply.status(500).send({ error: error.message });
        return reply.send(data);
    });
}
//# sourceMappingURL=inventario.js.map