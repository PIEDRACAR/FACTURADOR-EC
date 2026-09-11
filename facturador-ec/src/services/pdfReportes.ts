import PDFDocument from 'pdfkit';

/**
 * Dibuja un PDF de tabla simple (título, columnas, filas, total opcional al
 * pie) — reutilizado por todos los reportes exportables.
 */
export async function generarPdfTabla(opciones: {
  titulo: string;
  subtitulo?: string;
  columnas: Array<{ clave: string; etiqueta: string; ancho: number; alinearDerecha?: boolean }>;
  filas: Array<Record<string, unknown>>;
  filaTotales?: Record<string, unknown>;
}): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 36, layout: 'landscape' });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  const listo = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const anchoUtil = doc.page.width - 72;

  doc.fontSize(14).font('Helvetica-Bold').text(opciones.titulo, 36, 36);
  if (opciones.subtitulo) {
    doc.fontSize(9).font('Helvetica').fillColor('#64748b').text(opciones.subtitulo, 36, 56);
    doc.fillColor('black');
  }

  let y = opciones.subtitulo ? 76 : 62;

  doc.rect(36, y, anchoUtil, 18).fill('#1e3a8a');
  doc.fillColor('white').fontSize(8).font('Helvetica-Bold');
  let x = 40;
  for (const col of opciones.columnas) {
    doc.text(col.etiqueta, x, y + 5, { width: col.ancho - 4, align: col.alinearDerecha ? 'right' : 'left' });
    x += col.ancho;
  }
  doc.fillColor('black');
  y += 18;

  doc.font('Helvetica').fontSize(8);
  if (!opciones.filas.length) { doc.fillColor('#64748b').font('Helvetica').fontSize(9).text('No existen registros para los filtros seleccionados.',40,y+8,{width:anchoUtil,align:'center'}); doc.fillColor('black'); y+=30; }
  for (const fila of opciones.filas) {
    if (y > doc.page.height - 60) {
      doc.addPage({ size: 'A4', margin: 36, layout: 'landscape' });
      y = 36;
    }
    x = 40;
    for (const col of opciones.columnas) {
      const valor = fila[col.clave];
      doc.text(valor === null || valor === undefined ? '' : String(valor), x, y + 4, {
        width: col.ancho - 4,
        align: col.alinearDerecha ? 'right' : 'left',
      });
      x += col.ancho;
    }
    y += 16;
    doc.moveTo(36, y).lineTo(36 + anchoUtil, y).strokeColor('#e2e8f0').stroke().strokeColor('black');
  }

  if (opciones.filaTotales) {
    y += 4;
    doc.rect(36, y, anchoUtil, 20).fill('#eff6ff');
    doc.fillColor('#1e3a8a').font('Helvetica-Bold').fontSize(8.5);
    x = 40;
    for (const col of opciones.columnas) {
      const valor = opciones.filaTotales[col.clave];
      doc.text(valor === null || valor === undefined ? '' : String(valor), x, y + 6, {
        width: col.ancho - 4,
        align: col.alinearDerecha ? 'right' : 'left',
      });
      x += col.ancho;
    }
    doc.fillColor('black');
  }

  doc.end();
  return listo;
}
