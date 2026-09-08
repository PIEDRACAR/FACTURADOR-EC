import { supabase } from '../db/supabase.js';
import { generarExcelDesdeFilas, parsearExcel } from '../services/excel.js';
const TARIFAS_VALIDAS = new Set(['0', '5', '8', '15', 'exento', 'no_objeto']);
const COLUMNAS_PLANTILLA = [
    { clave: 'codigo', etiqueta: 'Código' },
    { clave: 'codigoBarras', etiqueta: 'Código de barras (opcional)' },
    { clave: 'descripcion', etiqueta: 'Descripción' },
    { clave: 'unidadMedida', etiqueta: 'Unidad de medida' },
    { clave: 'precioVenta', etiqueta: 'Precio de venta' },
    { clave: 'costo', etiqueta: 'Costo (opcional)' },
    { clave: 'tarifaIva', etiqueta: 'IVA (0, 5, 8, 15, exento o no_objeto)' },
    { clave: 'stockActual', etiqueta: 'Stock actual' },
    { clave: 'stockCritico', etiqueta: 'Stock crítico / STOP' },
    { clave: 'stockMinimo', etiqueta: 'Stock mínimo' },
    { clave: 'stockMaximo', etiqueta: 'Stock máximo (opcional)' },
];
export async function registrarRutasImportacionProductos(app) {
    app.get('/productos/plantilla', async (_request, reply) => {
        const buffer = await generarExcelDesdeFilas('Productos', COLUMNAS_PLANTILLA, [
            {
                codigo: 'PROD001',
                codigoBarras: '7501234567890',
                descripcion: 'Producto de ejemplo',
                unidadMedida: 'UNIDAD',
                precioVenta: 10.5,
                costo: 6.0,
                tarifaIva: '15',
                stockActual: 50,
                stockMinimo: 5,
            },
        ]);
        reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        reply.header('Content-Disposition', 'attachment; filename="plantilla-productos.xlsx"');
        return reply.send(buffer);
    });
    app.post('/productos/importar', async (request, reply) => {
        const { emisorId, archivoBase64 } = request.body ?? {};
        if (!emisorId)
            return reply.status(400).send({ error: 'Falta emisorId.' });
        if (!archivoBase64)
            return reply.status(400).send({ error: 'Falta el archivo.' });
        let filas;
        try {
            filas = await parsearExcel(Buffer.from(archivoBase64, 'base64'));
        }
        catch (err) {
            return reply.status(400).send({ error: 'No se pudo leer el archivo. ¿Es un .xlsx válido?', detalle: err instanceof Error ? err.message : String(err) });
        }
        if (filas.length === 0) {
            return reply.status(400).send({ error: 'El archivo no tiene filas de datos.' });
        }
        if (filas.length > 2000) {
            return reply.status(400).send({ error: `El archivo tiene ${filas.length} filas — el máximo por carga es 2000. Divídelo en partes más pequeñas.` });
        }
        const errores = [];
        const productosValidos = [];
        filas.forEach((fila, indice) => {
            const numeroFila = indice + 2;
            const codigo = (fila.codigo || fila['Código'] || '').trim();
            const descripcion = (fila.descripcion || fila['Descripción'] || '').trim();
            const precioTexto = fila.precioVenta || fila['Precio de venta'] || '';
            const precio = parseFloat(precioTexto);
            const tarifaIva = (fila.tarifaIva || fila['IVA (0, 5, 8, 15, exento o no_objeto)'] || '15').trim();
            const costoTexto = fila.costo || fila['Costo (opcional)'] || '0';
            const costo = parseFloat(costoTexto) || 0;
            const stockTexto = fila.stockActual || fila['Stock actual'] || '0';
            const stock = parseFloat(stockTexto) || 0;
            const stockCriticoTexto = fila.stockCritico || fila['Stock crítico / STOP'] || '0';
            const stockCritico = parseFloat(stockCriticoTexto) || 0;
            const stockMinimoTexto = fila.stockMinimo || fila['Stock mínimo'] || '0';
            const stockMinimo = parseFloat(stockMinimoTexto) || 0;
            const stockMaximoTexto = fila.stockMaximo || fila['Stock máximo (opcional)'] || '';
            const stockMaximo = stockMaximoTexto.trim() === '' ? null : parseFloat(stockMaximoTexto);
            const unidad = (fila.unidadMedida || fila['Unidad de medida'] || 'UNIDAD').trim() || 'UNIDAD';
            const codigoBarras = (fila.codigoBarras || fila['Código de barras (opcional)'] || '').trim();
            if (!codigo) {
                errores.push(`Fila ${numeroFila}: falta el código.`);
                return;
            }
            if (!descripcion) {
                errores.push(`Fila ${numeroFila}: falta la descripción.`);
                return;
            }
            if (isNaN(stockCritico) || stockCritico < 0) {
                errores.push(`Fila ${numeroFila}: stock crítico / STOP inválido.`);
                return;
            }
            if (isNaN(stockMinimo) || stockMinimo < stockCritico) {
                errores.push(`Fila ${numeroFila}: el stock mínimo no puede ser menor que el stock crítico.`);
                return;
            }
            if (stockMaximo !== null && (isNaN(stockMaximo) || stockMaximo < stockMinimo)) {
                errores.push(`Fila ${numeroFila}: el stock máximo debe ser mayor o igual al mínimo.`);
                return;
            }
            if (isNaN(precio) || precio < 0) {
                errores.push(`Fila ${numeroFila}: precio de venta inválido ("${precioTexto}").`);
                return;
            }
            if (!TARIFAS_VALIDAS.has(tarifaIva)) {
                errores.push(`Fila ${numeroFila}: tarifa de IVA "${tarifaIva}" no es válida (usa 0, 5, 8, 15, exento o no_objeto).`);
                return;
            }
            productosValidos.push({
                emisor_id: emisorId,
                codigo_principal: codigo,
                codigo_auxiliar: codigoBarras || null,
                descripcion,
                unidad_medida: unidad,
                precio_venta: precio,
                costo_promedio: costo,
                tarifa_iva: tarifaIva,
                stock_actual: stock,
                stock_critico: stockCritico,
                stock_minimo: stockMinimo,
                stock_maximo: stockMaximo,
            });
        });
        if (productosValidos.length === 0) {
            return reply.status(400).send({ error: 'Ninguna fila pasó la validación.', errores });
        }
        const { data, error } = await supabase
            .from('productos')
            .upsert(productosValidos, { onConflict: 'emisor_id,codigo_principal' })
            .select('id');
        if (error) {
            return reply.status(500).send({ error: 'Se validaron las filas pero falló al guardarlas.', detalle: error.message, errores });
        }
        return reply.send({
            importados: data?.length ?? 0,
            filasConError: errores.length,
            errores: errores.slice(0, 50),
        });
    });
}
//# sourceMappingURL=productos-importar.js.map