/** Validaciones de formato que deben ejecutarse ANTES de tocar inventario o generar el comprobante. */
export function validarFacturaAntesDeGuardar(data: {
  identificacionComprador: string;
  razonSocialComprador: string;
  direccionComprador?: string;
  detalles: Array<{
    codigoPrincipal: string;
    descripcion: string;
    cantidad: number;
    precioUnitario: number;
    descuento: number;
    precioTotalSinImpuesto: number;
  }>;
  pagos: Array<{ formaPago: string; total: number }>;
  importeTotal: number;
}) {
  const errores: string[] = [];
  const id = String(data.identificacionComprador ?? '').trim();
  if (!/^\d{10}$|^\d{13}$/.test(id) && id !== '9999999999999') errores.push('La identificación del comprador debe tener 10 o 13 dígitos.');
  if (String(data.razonSocialComprador ?? '').trim().length < 1 || String(data.razonSocialComprador ?? '').length > 300) errores.push('La razón social del comprador debe tener entre 1 y 300 caracteres.');
  if (data.direccionComprador && String(data.direccionComprador).length > 300) errores.push('La dirección del comprador no puede superar 300 caracteres.');
  if (!Array.isArray(data.detalles) || data.detalles.length === 0) errores.push('La factura debe contener al menos un detalle.');
  for (const [i, d] of (data.detalles ?? []).entries()) {
    if (!String(d.codigoPrincipal ?? '').trim() || String(d.codigoPrincipal).length > 25) errores.push(`Detalle ${i + 1}: el código principal es obligatorio y no puede superar 25 caracteres.`);
    if (!String(d.descripcion ?? '').trim() || String(d.descripcion).length > 300) errores.push(`Detalle ${i + 1}: la descripción debe tener entre 1 y 300 caracteres.`);
    if (!Number.isFinite(Number(d.cantidad)) || Number(d.cantidad) <= 0) errores.push(`Detalle ${i + 1}: cantidad inválida.`);
    if (!Number.isFinite(Number(d.precioUnitario)) || Number(d.precioUnitario) < 0) errores.push(`Detalle ${i + 1}: precio unitario inválido.`);
    if (!Number.isFinite(Number(d.descuento)) || Number(d.descuento) < 0) errores.push(`Detalle ${i + 1}: descuento inválido.`);
    if (Number(d.descuento) > Number(d.cantidad) * Number(d.precioUnitario) + 0.01) errores.push(`Detalle ${i + 1}: el descuento supera el valor bruto de la línea.`);
    if (!Number.isFinite(Number(d.precioTotalSinImpuesto)) || Number(d.precioTotalSinImpuesto) < 0) errores.push(`Detalle ${i + 1}: total sin impuesto inválido.`);
  }
  const total = Number(data.importeTotal);
  if (!Number.isFinite(total) || total < 0) errores.push('El importe total no es válido.');
  const pagos = (data.pagos ?? []).filter(p => Number(p.total) > 0);
  const totalPagos = pagos.reduce((s, p) => s + Number(p.total), 0);
  if (Math.abs(totalPagos - total) > 0.01) errores.push(`Las formas de pago (${totalPagos.toFixed(2)}) deben coincidir con el total (${total.toFixed(2)}).`);
  if (errores.length) throw new Error(`Validación tributaria previa: ${errores.join(' ')}`);
}
