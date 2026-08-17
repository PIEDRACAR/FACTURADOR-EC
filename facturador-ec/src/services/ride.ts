import PDFDocument from 'pdfkit';
import bwipjs from 'bwip-js';
import { supabase } from '../db/supabase.js';

/**
 * Genera el RIDE (Representación Impresa del Documento Electrónico) de un
 * comprobante ya emitido, como PDF, a partir de lo que quedó guardado en
 * Supabase — no vuelve a tocar el SRI ni relee el XML: todos los datos que
 * exige un RIDE (emisor, cliente, detalle, totales, clave de acceso,
 * autorización) ya viven en las tablas `comprobantes` / `comprobante_items`
 * / `comprobante_formas_pago`.
 *
 * Esto reemplaza la dependencia de entrar al portal del SRI para conseguir
 * el PDF — ahora el propio sistema lo entrega al instante.
 */

const NOMBRES_FORMA_PAGO: Record<string, string> = {
  '01': 'Efectivo',
  '15': 'Compensación de deudas',
  '16': 'Tarjeta de débito',
  '17': 'Dinero electrónico',
  '18': 'Tarjeta prepago',
  '19': 'Tarjeta de crédito',
  '20': 'Otros con sistema financiero',
  '21': 'Endoso de títulos',
};

const NOMBRES_TIPO_IDENTIFICACION: Record<string, string> = {
  '04': 'RUC',
  '05': 'Cédula',
  '06': 'Pasaporte',
  '07': 'Consumidor Final',
  '08': 'Identificación del exterior',
};

interface DatosRide {
  comprobante: {
    id: string;
    secuencial: string | null;
    clave_acceso: string | null;
    numero_autorizacion: string | null;
    fecha_autorizacion: string | null;
    estado: string;
    subtotal_0: number;
    subtotal_15: number;
    total_descuento: number;
    total_iva: number;
    propina: number;
    importe_total: number;
    created_at: string;
    emisores: {
      ruc: string;
      razon_social: string;
      nombre_comercial: string | null;
      direccion_matriz: string;
      obligado_contabilidad: boolean;
      ambiente: string;
      contribuyente_especial: string | null;
    };
    puntos_emision: { establecimiento: string; punto_emision: string; direccion: string };
    clientes: { tipo_identificacion: string; identificacion: string; razon_social: string; direccion: string | null } | null;
    comprobante_items: Array<{
      descripcion: string;
      cantidad: number;
      precio_unitario: number;
      descuento: number;
      precio_total_sin_impuesto: number;
      tarifa_iva: string;
      valor_iva: number;
    }>;
    comprobante_formas_pago: Array<{ forma_pago_codigo: string; valor: number }>;
  };
}

async function obtenerDatosRide(comprobanteId: string): Promise<DatosRide['comprobante']> {
  const { data, error } = await supabase
    .from('comprobantes')
    .select(
      `*, emisores(*), puntos_emision(*), clientes(*),
       comprobante_items(*), comprobante_formas_pago(*)`
    )
    .eq('id', comprobanteId)
    .single();

  if (error || !data) {
    throw new Error(`No se encontró el comprobante ${comprobanteId}: ${error?.message ?? 'sin datos'}`);
  }
  return data as unknown as DatosRide['comprobante'];
}

function dinero(valor: number): string {
  return '$' + Number(valor).toFixed(2);
}

async function generarCodigoBarras(claveAcceso: string): Promise<Buffer> {
  return bwipjs.toBuffer({
    bcid: 'code128',
    text: claveAcceso,
    scale: 2,
    height: 12,
    includetext: false,
    backgroundcolor: 'FFFFFF',
  });
}

export async function generarRidePdf(comprobanteId: string): Promise<Buffer> {
  const datos = await obtenerDatosRide(comprobanteId);
  return renderizarRidePdf(datos);
}

/** Dibuja el PDF a partir de los datos ya resueltos — separado de la consulta a Supabase para poder probarlo con datos de ejemplo. */
export async function renderizarRidePdf(c: DatosRide['comprobante']): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 36 });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  const listo = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const anchoUtil = doc.page.width - 72;
  const esPruebas = c.emisores.ambiente === 'pruebas';

  // --- Encabezado: datos del emisor (izquierda) y recuadro de factura (derecha) ---
  doc.fontSize(13).font('Helvetica-Bold').text(c.emisores.razon_social, 36, 40, { width: 330 });
  if (c.emisores.nombre_comercial) {
    doc.fontSize(9).font('Helvetica').text(c.emisores.nombre_comercial, { width: 330 });
  }
  doc
    .fontSize(9)
    .font('Helvetica')
    .text(c.emisores.direccion_matriz, { width: 330 })
    .text(`Punto de emisión: ${c.puntos_emision.establecimiento}-${c.puntos_emision.punto_emision} — ${c.puntos_emision.direccion}`, { width: 330 })
    .text(`Obligado a llevar contabilidad: ${c.emisores.obligado_contabilidad ? 'SÍ' : 'NO'}`, { width: 330 });
  if (c.emisores.contribuyente_especial) {
    doc.text(`Contribuyente especial: ${c.emisores.contribuyente_especial}`, { width: 330 });
  }

  const cajaX = 400;
  doc.rect(cajaX, 40, anchoUtil - (cajaX - 36), 88).stroke();
  doc
    .fontSize(11)
    .font('Helvetica-Bold')
    .text('R.U.C.: ' + c.emisores.ruc, cajaX + 8, 48, { width: anchoUtil - (cajaX - 36) - 16 });
  doc
    .fontSize(10)
    .text('FACTURA', cajaX + 8, 64, { width: anchoUtil - (cajaX - 36) - 16 })
    .fontSize(11)
    .text(`No. ${c.puntos_emision.establecimiento}-${c.puntos_emision.punto_emision}-${c.secuencial ?? '—'}`, cajaX + 8, 78, {
      width: anchoUtil - (cajaX - 36) - 16,
    });
  doc
    .fontSize(8)
    .font('Helvetica')
    .text(`NÚMERO DE AUTORIZACIÓN:`, cajaX + 8, 96, { width: anchoUtil - (cajaX - 36) - 16 })
    .fontSize(7)
    .text(c.numero_autorizacion ?? '(pendiente)', cajaX + 8, 106, { width: anchoUtil - (cajaX - 36) - 16 });

  if (esPruebas) {
    doc
      .fillColor('#b91c1c')
      .fontSize(9)
      .font('Helvetica-Bold')
      .text('AMBIENTE: PRUEBAS — este comprobante no tiene validez tributaria', 36, 132, { width: anchoUtil, align: 'center' })
      .fillColor('black');
  }

  let y = esPruebas ? 150 : 136;
  doc.moveTo(36, y).lineTo(36 + anchoUtil, y).stroke();
  y += 10;

  // --- Datos del comprador ---
  const cliente = c.clientes;
  doc.fontSize(9).font('Helvetica-Bold').text('Razón social / Nombres:', 36, y, { continued: true, width: anchoUtil });
  doc.font('Helvetica').text(' ' + (cliente?.razon_social ?? 'CONSUMIDOR FINAL'));
  y += 13;
  doc.font('Helvetica-Bold').text('Identificación:', 36, y, { continued: true });
  doc
    .font('Helvetica')
    .text(` ${NOMBRES_TIPO_IDENTIFICACION[cliente?.tipo_identificacion ?? '07'] ?? ''} ${cliente?.identificacion ?? '9999999999999'}`);
  y += 13;
  doc.font('Helvetica-Bold').text('Fecha de emisión:', 36, y, { continued: true });
  doc.font('Helvetica').text(' ' + new Date(c.created_at).toLocaleDateString('es-EC'));
  y += 18;

  // --- Tabla de detalle ---
  const colX = { desc: 36, cant: 300, precio: 340, desc2: 400, subt: 460 };
  doc.rect(36, y, anchoUtil, 16).fill('#1e3a8a');
  doc
    .fillColor('white')
    .fontSize(8)
    .font('Helvetica-Bold')
    .text('DESCRIPCIÓN', colX.desc + 4, y + 4)
    .text('CANT.', colX.cant, y + 4, { width: 36, align: 'right' })
    .text('P. UNIT.', colX.precio, y + 4, { width: 56, align: 'right' })
    .text('DESC.', colX.desc2, y + 4, { width: 56, align: 'right' })
    .text('SUBTOTAL', colX.subt, y + 4, { width: 71, align: 'right' });
  doc.fillColor('black');
  y += 16;

  doc.font('Helvetica').fontSize(8.5);
  for (const item of c.comprobante_items) {
    const alturaFila = 14;
    doc
      .text(item.descripcion, colX.desc + 4, y + 3, { width: 260 })
      .text(Number(item.cantidad).toFixed(2), colX.cant, y + 3, { width: 36, align: 'right' })
      .text(dinero(item.precio_unitario), colX.precio, y + 3, { width: 56, align: 'right' })
      .text(dinero(item.descuento), colX.desc2, y + 3, { width: 56, align: 'right' })
      .text(dinero(item.precio_total_sin_impuesto), colX.subt, y + 3, { width: 71, align: 'right' });
    y += alturaFila;
    doc.moveTo(36, y).lineTo(36 + anchoUtil, y).strokeColor('#e2e8f0').stroke().strokeColor('black');
  }
  y += 10;

  // --- Formas de pago (izquierda) y totales (derecha) ---
  const yFormasPago = y;
  doc.fontSize(8.5).font('Helvetica-Bold').text('Forma(s) de pago', 36, y);
  y += 13;
  doc.font('Helvetica');
  for (const pago of c.comprobante_formas_pago) {
    doc.text(`${NOMBRES_FORMA_PAGO[pago.forma_pago_codigo] ?? pago.forma_pago_codigo}: ${dinero(pago.valor)}`, 36, y, { width: 260 });
    y += 12;
  }

  const filasTotales: Array<[string, number]> = [
    ['Subtotal 15%', c.subtotal_15],
    ['Subtotal 0%', c.subtotal_0],
    ['Descuento', c.total_descuento],
    ['IVA 15%', c.total_iva],
  ];
  if (c.propina > 0) filasTotales.push(['Propina', c.propina]);

  let yTotales = yFormasPago;
  const xTotalesLabel = 360;
  const xTotalesValor = 460;
  doc.fontSize(8.5).font('Helvetica');
  for (const [etiqueta, valor] of filasTotales) {
    doc.text(etiqueta, xTotalesLabel, yTotales, { width: 90 });
    doc.text(dinero(valor), xTotalesValor, yTotales, { width: 71, align: 'right' });
    yTotales += 13;
  }
  doc.rect(xTotalesLabel, yTotales, anchoUtil - (xTotalesLabel - 36), 18).fill('#1e3a8a');
  doc
    .fillColor('white')
    .font('Helvetica-Bold')
    .fontSize(9.5)
    .text('VALOR TOTAL', xTotalesLabel + 4, yTotales + 5, { width: 86 })
    .text(dinero(c.importe_total), xTotalesValor, yTotales + 5, { width: 71 - 4, align: 'right' });
  doc.fillColor('black');
  yTotales += 26;

  y = Math.max(y, yTotales) + 16;

  // --- Clave de acceso + código de barras ---
  if (c.clave_acceso) {
    try {
      const barras = await generarCodigoBarras(c.clave_acceso);
      doc.image(barras, 36, y, { width: 260, height: 40 });
    } catch {
      // Si el código de barras falla por cualquier motivo, el RIDE sigue
      // siendo válido con la clave de acceso en texto — nunca bloquear la
      // generación del PDF por esto.
    }
    doc
      .fontSize(7)
      .font('Helvetica')
      .text(c.clave_acceso, 36, y + 42, { width: 300 });
  }

  doc.fontSize(7).fillColor('#64748b').text(
    'Documento generado electrónicamente. Consulta de validez: https://srienlinea.sri.gob.ec',
    36,
    doc.page.height - 50,
    { width: anchoUtil, align: 'center' }
  );

  doc.end();
  return listo;
}
