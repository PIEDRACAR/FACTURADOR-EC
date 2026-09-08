import ExcelJS from 'exceljs';
/**
 * Genera un .xlsx a partir de columnas (clave técnica + etiqueta visible) y
 * filas de datos (objetos planos). Un solo generador reutilizado por todos
 * los reportes exportables — así el estilo (encabezado en negrita, ancho de
 * columnas) queda consistente en todo el sistema sin repetir código.
 */
export async function generarExcelDesdeFilas(nombreHoja, columnas, filas) {
    const libro = new ExcelJS.Workbook();
    const hoja = libro.addWorksheet(nombreHoja.slice(0, 31)); // Excel limita el nombre de hoja a 31 caracteres
    hoja.columns = columnas.map((c) => ({ header: c.etiqueta, key: c.clave, width: c.ancho ?? 20 }));
    hoja.getRow(1).font = { bold: true };
    hoja.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FF' } };
    for (const fila of filas) {
        hoja.addRow(fila);
    }
    const buffer = await libro.xlsx.writeBuffer();
    return Buffer.from(buffer);
}
/**
 * Parsea un archivo .xlsx subido (buffer) y devuelve las filas como arreglo
 * de objetos, usando la primera fila como encabezados. Se usa para la
 * carga masiva de productos.
 */
export async function parsearExcel(buffer) {
    const libro = new ExcelJS.Workbook();
    // Los tipos de ExcelJS declaran su propio `Buffer` (desactualizado) que
    // choca en modo estricto con el `Buffer` real de Node — el cast es solo
    // para conformar el tipo, el valor en tiempo de ejecución es idéntico.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await libro.xlsx.load(buffer);
    const hoja = libro.worksheets[0];
    if (!hoja)
        return [];
    const encabezados = [];
    hoja.getRow(1).eachCell((celda, columna) => {
        encabezados[columna] = String(celda.value ?? '').trim();
    });
    const filas = [];
    hoja.eachRow((fila, numeroFila) => {
        if (numeroFila === 1)
            return; // encabezado
        const objeto = {};
        let tieneAlgunValor = false;
        fila.eachCell({ includeEmpty: true }, (celda, columna) => {
            const clave = encabezados[columna];
            if (!clave)
                return;
            const valor = celda.value;
            const texto = valor === null || valor === undefined ? '' : String(valor).trim();
            if (texto)
                tieneAlgunValor = true;
            objeto[clave] = texto;
        });
        if (tieneAlgunValor)
            filas.push(objeto);
    });
    return filas;
}
//# sourceMappingURL=excel.js.map