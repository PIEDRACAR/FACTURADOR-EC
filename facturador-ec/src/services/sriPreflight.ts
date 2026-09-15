/**
 * CONTSERTRIB — Preflight técnico SRI
 *
 * Capa defensiva previa a firma/transmisión. No sustituye al SRI ni al XSD
 * oficial: evita enviar XML obviamente inválido y convierte errores opacos en
 * mensajes accionables.
 */
export type SriPreflightOptions = {
  rootTag?: string;
  requireDirEstablecimiento?: boolean;
};

const MAX_INFO_ADICIONAL = 15;
const RUC_PROVIDER_NAME = 'RUC Proveedor';

function textoTag(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i');
  const m = xml.match(re);
  if (!m) return null;
  return String(m[1] ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
}

function contarTags(xml: string, tag: string): number {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>`, 'gi');
  return (xml.match(re) ?? []).length;
}

function obtenerCampoAdicional(xml: string): Array<{ nombre: string; valor: string }> {
  const info = xml.match(/<infoAdicional>([\s\S]*?)<\/infoAdicional>/i)?.[1] ?? '';
  const campos: Array<{ nombre: string; valor: string }> = [];
  const re = /<campoAdicional\s+[^>]*nombre=["']([^"']*)["'][^>]*>([\s\S]*?)<\/campoAdicional>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(info))) {
    const valor = String(m[2] ?? '').replace(/<[^>]+>/g, '').trim();
    campos.push({ nombre: String(m[1] ?? '').trim(), valor });
  }
  return campos;
}

export function validarRucProveedor(ruc: unknown): string {
  const v = String(ruc ?? '').trim();
  if (!/^\d{13}$/.test(v)) {
    throw new Error('RUC Proveedor inválido: debe contener exactamente 13 dígitos. Configure RUC_PROVEEDOR_FACTURACION en Railway.');
  }
  return v;
}

export function validarContextoEmisorSRI(args: {
  ruc: unknown;
  razonSocial: unknown;
  dirMatriz: unknown;
  establecimiento: unknown;
  puntoEmision: unknown;
  direccionEstablecimiento: unknown;
  ambiente: unknown;
}): void {
  const ruc = String(args.ruc ?? '').trim();
  const razon = String(args.razonSocial ?? '').trim();
  const matriz = String(args.dirMatriz ?? '').trim();
  const est = String(args.establecimiento ?? '').trim();
  const punto = String(args.puntoEmision ?? '').trim();
  const dirEst = String(args.direccionEstablecimiento ?? '').trim();
  const ambiente = String(args.ambiente ?? '').trim();

  if (!/^\d{13}$/.test(ruc)) throw new Error('RUC del emisor inválido: debe contener 13 dígitos.');
  if (!razon || razon.length > 300) throw new Error('Razón social del emisor obligatoria y con máximo 300 caracteres.');
  if (!matriz || matriz.length > 300) throw new Error('Dirección de matriz obligatoria y con máximo 300 caracteres.');
  if (!/^\d{3}$/.test(est)) throw new Error('Código de establecimiento inválido: debe tener 3 dígitos.');
  if (!/^\d{3}$/.test(punto)) throw new Error('Punto de emisión inválido: debe tener 3 dígitos.');
  if (!dirEst || dirEst.length > 300) throw new Error(`Dirección del establecimiento ${est} obligatoria y con máximo 300 caracteres.`);
  if (!['1', '2'].includes(ambiente)) throw new Error('Ambiente SRI inválido: debe ser 1 (pruebas) o 2 (producción).');
}

/**
 * Verificaciones estructurales independientes del XSD empaquetado.
 * Se ejecutan sobre el XML final SIN FIRMAR, después de inyectar RUC Proveedor.
 */

export function validarFacturaDataSRI(data: Record<string, unknown>): void {
  const errores: string[] = [];
  const fecha = String(data.fechaEmision ?? '').trim();
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(fecha)) errores.push('fechaEmision debe tener formato dd/mm/yyyy.');
  const identificacion = String(data.identificacionComprador ?? '').trim();
  if (!/^(?:\d{10}|\d{13})$/.test(identificacion) && identificacion !== '9999999999999') errores.push('identificacionComprador debe tener 10 o 13 dígitos, o ser consumidor final.');
  const razon = String(data.razonSocialComprador ?? '').trim();
  if (!razon || razon.length > 300) errores.push('razonSocialComprador obligatoria y máximo 300 caracteres.');
  const total = Number(data.importeTotal);
  if (!Number.isFinite(total) || total < 0) errores.push('importeTotal inválido.');
  const subtotal = Number(data.totalSinImpuestos);
  if (!Number.isFinite(subtotal) || subtotal < 0) errores.push('totalSinImpuestos inválido.');
  const descuento = Number(data.totalDescuento ?? 0);
  if (!Number.isFinite(descuento) || descuento < 0) errores.push('totalDescuento inválido.');
  if (Array.isArray(data.detalles)) {
    data.detalles.forEach((d: any, i) => {
      const codigo = String(d?.codigoPrincipal ?? '').trim();
      const descripcion = String(d?.descripcion ?? '').trim();
      const cantidad = Number(d?.cantidad);
      const precio = Number(d?.precioUnitario);
      const totalLinea = Number(d?.precioTotalSinImpuesto);
      if (!codigo || codigo.length > 25) errores.push(`detalle ${i + 1}: codigoPrincipal obligatorio y máximo 25 caracteres.`);
      if (!descripcion || descripcion.length > 300) errores.push(`detalle ${i + 1}: descripcion obligatoria y máximo 300 caracteres.`);
      if (!Number.isFinite(cantidad) || cantidad <= 0) errores.push(`detalle ${i + 1}: cantidad debe ser mayor a 0.`);
      if (!Number.isFinite(precio) || precio < 0) errores.push(`detalle ${i + 1}: precioUnitario inválido.`);
      if (!Number.isFinite(totalLinea) || totalLinea < 0) errores.push(`detalle ${i + 1}: precioTotalSinImpuesto inválido.`);
    });
  } else errores.push('detalles es obligatorio.');
  if (!Array.isArray(data.pagos) || data.pagos.length === 0) errores.push('Debe existir al menos una forma de pago.');
  if (errores.length) throw new Error(`Preflight SRI de factura: ${[...new Set(errores)].join(' | ')}`);
}

export function validarXmlSRI(xml: string, options: SriPreflightOptions = {}): void {
  const errores: string[] = [];
  const root = options.rootTag;

  if (!String(xml ?? '').trim()) errores.push('XML vacío.');
  if (!/^\s*<\?xml\s+version=["']1\.0["'][^>]*>/.test(xml)) errores.push('Falta la declaración XML 1.0.');
  if (root && contarTags(xml, root) !== 1) errores.push(`Debe existir exactamente un elemento raíz <${root}>.`);

  const clave = textoTag(xml, 'claveAcceso');
  if (clave !== null && !/^\d{49}$/.test(clave)) errores.push('claveAcceso debe contener 49 dígitos.');

  const ruc = textoTag(xml, 'ruc');
  if (ruc !== null && !/^\d{13}$/.test(ruc)) errores.push('RUC del emisor debe contener 13 dígitos.');

  const razon = textoTag(xml, 'razonSocial');
  if (razon !== null && (!razon || razon.length > 300)) errores.push('razonSocial vacía o supera 300 caracteres.');

  const matriz = textoTag(xml, 'dirMatriz');
  if (matriz !== null && (!matriz || matriz.length > 300)) errores.push('dirMatriz vacía o supera 300 caracteres.');

  const dirEst = textoTag(xml, 'dirEstablecimiento');
  if (options.requireDirEstablecimiento && (dirEst === null || !dirEst)) {
    errores.push('dirEstablecimiento es obligatorio y no puede estar vacío.');
  } else if (dirEst !== null && dirEst.length > 300) {
    errores.push('dirEstablecimiento supera 300 caracteres.');
  }

  const codigoTags = [...xml.matchAll(/<codigoPrincipal>([\s\S]*?)<\/codigoPrincipal>/gi)].map(m => String(m[1] ?? '').trim());
  for (const codigo of codigoTags) if (!codigo || codigo.length > 25) errores.push(`codigoPrincipal inválido: máximo 25 caracteres (recibido ${codigo.length}).`);

  const descripciones = [...xml.matchAll(/<descripcion>([\s\S]*?)<\/descripcion>/gi)].map(m => String(m[1] ?? '').replace(/<[^>]+>/g, '').trim());
  for (const descripcion of descripciones) if (!descripcion || descripcion.length > 300) errores.push('descripcion vacía o supera 300 caracteres.');

  const campos = obtenerCampoAdicional(xml);
  if (campos.length > MAX_INFO_ADICIONAL) errores.push(`infoAdicional no puede superar ${MAX_INFO_ADICIONAL} camposAdicionales.`);
  const proveedores = campos.filter(c => c.nombre.replace(/\s+/g, ' ').trim().toLowerCase() === RUC_PROVIDER_NAME.toLowerCase());
  if (proveedores.length !== 1) errores.push(`Debe existir exactamente un campoAdicional "${RUC_PROVIDER_NAME}".`);
  else if (!/^\d{13}$/.test(proveedores[0].valor)) errores.push(`El valor de "${RUC_PROVIDER_NAME}" debe ser un RUC de 13 dígitos.`);
  for (const campo of campos) {
    if (!campo.nombre) errores.push('Existe un campoAdicional sin atributo nombre.');
    if (campo.nombre.length > 300) errores.push('El nombre de un campoAdicional supera 300 caracteres.');
    if (campo.valor.length > 300) errores.push(`El campoAdicional "${campo.nombre}" supera 300 caracteres.`);
  }

  if (errores.length) {
    throw new Error(`Preflight SRI rechazó el XML antes de firmar: ${[...new Set(errores)].join(' | ')}`);
  }
}
