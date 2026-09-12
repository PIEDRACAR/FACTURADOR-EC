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
    subtotal_5: number;
    subtotal_8: number;
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
    ruc_proveedor_facturacion?: string | null;
    logo_ride_base64?: string | null;
    logo_ride_mime?: 'image/png' | 'image/jpeg' | null;
  };
}


interface LogoRide { base64: string; mime: 'image/png' | 'image/jpeg'; }

async function obtenerLogoRide(emisorId: string): Promise<LogoRide | null> {
  const { data } = await supabase.from('configuracion_sistema').select('logo_ride_base64,logo_ride_mime').eq('emisor_id', emisorId).maybeSingle();
  const base64 = String(data?.logo_ride_base64 ?? '').trim();
  const mime = String(data?.logo_ride_mime ?? '').toLowerCase();
  if (!base64 || !['image/png','image/jpeg'].includes(mime)) return null;
  try {
    const buffer = Buffer.from(base64, 'base64');
    if (!buffer.length || buffer.length > 1024 * 1024) return null;
    return { base64, mime: mime as LogoRide['mime'] };
  } catch { return null; }
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
  const { data: conf } = await supabase.from('configuracion_sistema').select('ruc_proveedor_facturacion').eq('emisor_id', (data as any).emisor_id).maybeSingle();
  const rucProveedor = (process.env.RUC_PROVEEDOR_FACTURACION?.trim() || String(conf?.ruc_proveedor_facturacion ?? '').trim() || null);
  const logo = await obtenerLogoRide(String((data as any).emisor_id));
  return { ...(data as unknown as DatosRide['comprobante']), ruc_proveedor_facturacion: rucProveedor, logo_ride_base64: logo?.base64 ?? null, logo_ride_mime: logo?.mime ?? null };
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
  const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true });
  const UI = { navy:'#123B63', blue:'#1E5A8A', blueSoft:'#EAF3FA', ink:'#1F2937', muted:'#5F6F82', line:'#B8C7D6', soft:'#F7FAFC', white:'#FFFFFF' };
  const L=38, R=38, top=28, bottom=40, W=doc.page.width, right=W-R, util=right-L;
  const chunks: Buffer[]=[];
  doc.on('data',(chunk:Buffer)=>chunks.push(chunk));
  const listo=new Promise<Buffer>((resolve,reject)=>{doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);});
  const autorizado=String(c.estado).toLowerCase()==='autorizado';
  const ambiente=String(c.emisores.ambiente||'pruebas').toLowerCase()==='produccion'?'PRODUCCIÓN':'PRUEBAS';
  const hasLogo=!!(c.logo_ride_base64&&c.logo_ride_mime&&['image/png','image/jpeg'].includes(c.logo_ride_mime));
  const tipo='FACTURA';

  doc.rect(0,0,W,9).fill(UI.navy);
  const leftW=270, boxX=318, boxW=right-boxX;
  if(hasLogo){ try{doc.image(Buffer.from(c.logo_ride_base64!,'base64'),L+10,22,{fit:[250,58],valign:'center'});}catch{} }
  else{doc.roundedRect(L+10,22,250,58,4).fill(UI.blueSoft).strokeColor(UI.line).stroke();doc.fillColor(UI.blue).font('Helvetica-Bold').fontSize(11).text('CONTSERTRIB',L+20,43,{width:230,align:'center'});doc.font('Helvetica').fontSize(7).fillColor(UI.muted).text('FACTURACIÓN ELECTRÓNICA',L+20,59,{width:230,align:'center'});}

  // Bloque del emisor, debajo de la marca, como en el RIDE de referencia.
  doc.roundedRect(L,86,leftW,122,4).lineWidth(.8).strokeColor(UI.line).stroke();
  doc.font('Helvetica-Bold').fontSize(10.2).fillColor(UI.navy).text(c.emisores.razon_social,L+10,96,{width:leftW-20,height:25});
  if(c.emisores.nombre_comercial) doc.font('Helvetica').fontSize(7.5).fillColor(UI.ink).text(c.emisores.nombre_comercial,L+10,116,{width:leftW-20});
  doc.font('Helvetica-Bold').fontSize(7.2).fillColor(UI.ink).text(`R.U.C.: ${c.emisores.ruc}`,L+10,132,{width:leftW-20});
  doc.font('Helvetica').fontSize(6.8).fillColor(UI.muted).text(c.emisores.direccion_matriz,L+10,145,{width:leftW-20,height:25});
  doc.font('Helvetica').fontSize(6.8).fillColor(UI.muted).text(`Punto de emisión: ${c.puntos_emision.establecimiento}-${c.puntos_emision.punto_emision}`,L+10,171,{width:leftW-20});
  doc.font('Helvetica-Bold').fontSize(6.7).fillColor(UI.navy).text(autorizado?'DOCUMENTO ELECTRÓNICO':'BORRADOR PARA REVISIÓN',L+10,187,{width:leftW-20,align:'center'});

  // Caja principal del documento/autorización.
  const boxH=186;
  doc.roundedRect(boxX,22,boxW,boxH,5).lineWidth(1).strokeColor(UI.blue).stroke();
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(UI.navy).text(tipo,boxX+10,32,{width:boxW-20,align:'center'});
  doc.font('Helvetica-Bold').fontSize(11).fillColor(UI.ink).text(`No. ${c.puntos_emision.establecimiento}-${c.puntos_emision.punto_emision}-${c.secuencial??'—'}`,boxX+10,51,{width:boxW-20,align:'center'});
  doc.font('Helvetica-Bold').fontSize(6.6).fillColor(UI.muted).text('NÚMERO DE AUTORIZACIÓN',boxX+10,72,{width:boxW-20,align:'center'});
  const auth=String(autorizado?(c.numero_autorizacion||c.clave_acceso||'—'):'Pendiente de autorización');
  const a1=auth.length>26?auth.slice(0,25):auth, a2=auth.length>26?auth.slice(25):'';
  doc.font('Helvetica').fontSize(6.2).fillColor(UI.ink).text(a1,boxX+10,83,{width:boxW-20,align:'center',lineBreak:false}); if(a2)doc.text(a2,boxX+10,92,{width:boxW-20,align:'center',lineBreak:false});
  const fy=a2?106:98;
  doc.font('Helvetica-Bold').fontSize(6.3).fillColor(UI.muted).text('FECHA Y HORA DE AUTORIZACIÓN',boxX+10,fy,{width:boxW-20,align:'center'});
  doc.font('Helvetica').fontSize(6.5).fillColor(UI.ink).text(c.fecha_autorizacion?new Intl.DateTimeFormat('es-EC',{timeZone:'America/Guayaquil',dateStyle:'short',timeStyle:'medium'}).format(new Date(c.fecha_autorizacion)):'—',boxX+10,fy+10,{width:boxW-20,align:'center'});
  doc.font('Helvetica-Bold').fontSize(6.4).fillColor(UI.muted).text(`AMBIENTE: ${ambiente}   ·   EMISIÓN: NORMAL`,boxX+8,fy+29,{width:boxW-16,align:'center'});
  if(c.clave_acceso){try{const barras=await generarCodigoBarras(c.clave_acceso);doc.image(barras,boxX+14,fy+45,{width:boxW-28,height:31});}catch{}}
  doc.font('Helvetica-Bold').fontSize(6.1).fillColor(UI.muted).text('CLAVE DE ACCESO',boxX+10,fy+78,{width:boxW-20,align:'center'});
  doc.font('Helvetica').fontSize(5.7).fillColor(UI.ink).text(c.clave_acceso||'—',boxX+8,fy+88,{width:boxW-16,align:'center',characterSpacing:.12});
  if(!autorizado){doc.roundedRect(L+8,195,leftW-16,11,2).fill('#FEF3C7');doc.fillColor('#A16207').font('Helvetica-Bold').fontSize(6.1).text('BORRADOR · SIN VALIDEZ TRIBUTARIA',L+10,198,{width:leftW-20,align:'center'});}

  let y=220;
  // Receptor / adquirente.
  doc.roundedRect(L,y,util,58,3).lineWidth(.6).strokeColor(UI.line).stroke();
  const cliente=c.clientes;
  const lv=(label:string,val:any,x:number,yy:number,w:number)=>{doc.font('Helvetica-Bold').fontSize(6.7).fillColor(UI.muted).text(label.toUpperCase(),x,yy,{width:w});doc.font('Helvetica').fontSize(8).fillColor(UI.ink).text(String(val??'—'),x,yy+10,{width:w,height:24,ellipsis:true});};
  lv('Razón social / nombres',cliente?.razon_social||'CONSUMIDOR FINAL',L+8,y+6,168);
  lv('Identificación',`${NOMBRES_TIPO_IDENTIFICACION[cliente?.tipo_identificacion??'07']??''} ${cliente?.identificacion??'9999999999999'}`,L+185,y+6,168);
  lv('Fecha de emisión',new Intl.DateTimeFormat('es-EC',{timeZone:'America/Guayaquil',dateStyle:'short'}).format(new Date(c.created_at)),L+362,y+6,157);
  lv('Dirección / domicilio',cliente?.direccion||'—',L+8,y+31,345);
  lv('Punto de emisión',`${c.puntos_emision.establecimiento}-${c.puntos_emision.punto_emision}`,L+362,y+31,157);
  y+=67;

  // Detalle.
  doc.roundedRect(L,y,util,20,3).fill(UI.navy);doc.fillColor(UI.white).font('Helvetica-Bold').fontSize(7.2);
  doc.text('DESCRIPCIÓN',L+5,y+6,{width:260});doc.text('CANT.',L+300,y+6,{width:36,align:'right'});doc.text('P. UNIT.',L+340,y+6,{width:56,align:'right'});doc.text('DESC.',L+400,y+6,{width:56,align:'right'});doc.text('PRECIO TOTAL',L+460,y+6,{width:71,align:'right'});y+=20;
  doc.font('Helvetica').fontSize(7.6).fillColor(UI.ink);
  for(const item of c.comprobante_items){const h=18;doc.rect(L,y,util,h).fill(y%2?UI.white:UI.soft);doc.fillColor(UI.ink).font('Helvetica').fontSize(7.6).text(item.descripcion,L+5,y+5,{width:260,height:h-7,ellipsis:true}).text(Number(item.cantidad).toFixed(2),L+300,y+5,{width:36,align:'right'}).text(dinero(item.precio_unitario),L+340,y+5,{width:56,align:'right'}).text(dinero(item.descuento),L+400,y+5,{width:56,align:'right'}).text(dinero(item.precio_total_sin_impuesto),L+460,y+5,{width:71,align:'right'});y+=h;}
  if(!c.comprobante_items.length){doc.rect(L,y,util,20).fill(UI.soft);doc.fillColor(UI.muted).font('Helvetica').fontSize(8).text('Sin detalle registrado',L+5,y+6,{width:util});y+=20;}
  y+=10;

  // Información adicional y forma de pago / totales.
  const leftBoxW=util*0.59, rightBoxX=L+leftBoxW+8, rightBoxW=util-leftBoxW-8;
  doc.roundedRect(L,y,leftBoxW,70,3).lineWidth(.6).strokeColor(UI.line).stroke();doc.fillColor(UI.navy).font('Helvetica-Bold').fontSize(7.5).text('INFORMACIÓN ADICIONAL',L+7,y+7,{width:leftBoxW-14,align:'center'});
  let iy=y+22;doc.fillColor(UI.ink).font('Helvetica').fontSize(7.5);
  if(c.ruc_proveedor_facturacion){doc.font('Helvetica-Bold').text('RUC Proveedor:',L+8,iy,{continued:true,width:90});doc.font('Helvetica').text(` ${c.ruc_proveedor_facturacion}`,{width:leftBoxW-105});iy+=14;}
  doc.font('Helvetica-Bold').text('Dirección:',L+8,iy,{continued:true,width:55});doc.font('Helvetica').text(` ${cliente?.direccion||'—'}`,{width:leftBoxW-70});
  doc.font('Helvetica-Bold').text('Correo:',L+8,iy+14,{continued:true,width:45});doc.font('Helvetica').text(` ${'—'}`,{width:leftBoxW-60});

  doc.roundedRect(L,y+78,leftBoxW,54,3).lineWidth(.6).strokeColor(UI.line).stroke();doc.fillColor(UI.navy).font('Helvetica-Bold').fontSize(7.5).text('FORMA DE PAGO',L+7,y+85,{width:leftBoxW-14,align:'center'});let py=y+102;doc.fillColor(UI.ink).font('Helvetica').fontSize(7.5);for(const p of c.comprobante_formas_pago){doc.text(`${NOMBRES_FORMA_PAGO[p.forma_pago_codigo]??p.forma_pago_codigo}`,L+8,py,{width:leftBoxW-95});doc.text(dinero(p.valor),L+leftBoxW-82,py,{width:74,align:'right'});py+=12;}

  const basesPorTarifa=new Map<string,number>();for(const item of c.comprobante_items){const tarifa=String(item.tarifa_iva??'0').toLowerCase();basesPorTarifa.set(tarifa,(basesPorTarifa.get(tarifa)||0)+Number(item.precio_total_sin_impuesto||0));}
  const filas:Array<[string,number]>=[];for(const [tarifa,base] of basesPorTarifa){if(base<=0)continue;const etiqueta=tarifa==='15'?'SUBTOTAL 15%':tarifa==='8'?'SUBTOTAL 8%':tarifa==='5'?'SUBTOTAL 5%':tarifa==='0'?'SUBTOTAL 0%':tarifa==='exento'?'SUBTOTAL EXENTO DE IVA':tarifa==='no_objeto'?'SUBTOTAL NO OBJETO DE IVA':`SUBTOTAL ${tarifa}%`;filas.push([etiqueta,base]);}filas.push(['TOTAL DESCUENTO',c.total_descuento],['IVA',c.total_iva]);
  let ty=y;doc.roundedRect(rightBoxX,ty,rightBoxW,18,3).fill(UI.blueSoft);doc.fillColor(UI.navy).font('Helvetica-Bold').fontSize(7.5).text('TOTALES',rightBoxX+7,ty+5,{width:rightBoxW-14,align:'center'});ty+=24;doc.fillColor(UI.muted).font('Helvetica').fontSize(7.5);for(const [lab,val] of filas){doc.text(lab,rightBoxX,ty,{width:rightBoxW-55});doc.fillColor(UI.ink).text(dinero(val),rightBoxX+rightBoxW-65,ty,{width:65,align:'right'});doc.fillColor(UI.muted);ty+=14;}doc.roundedRect(rightBoxX,ty,rightBoxW,25,4).fill(UI.navy);doc.fillColor(UI.white).font('Helvetica-Bold').fontSize(9).text('VALOR TOTAL',rightBoxX+7,ty+8,{width:rightBoxW-80});doc.text(dinero(c.importe_total),rightBoxX+rightBoxW-72,ty+8,{width:65,align:'right'});
  y=Math.max(y+140,ty+35)+12;

  if(c.clave_acceso){doc.font('Helvetica-Bold').fontSize(7).fillColor(UI.muted).text('CLAVE DE ACCESO',L,y,{width:util});y+=10;doc.font('Helvetica').fontSize(6.7).fillColor(UI.ink).text(c.clave_acceso,L,y,{width:util});y+=15;}

  for(let i=0;i<doc.bufferedPageRange().count;i++){doc.switchToPage(i);const fy=doc.page.height-30;doc.moveTo(L,fy-7).lineTo(right,fy-7).strokeColor(UI.line).stroke();doc.fontSize(6.7).font('Helvetica').fillColor(UI.muted).text(autorizado?'REPRESENTACIÓN IMPRESA DEL COMPROBANTE ELECTRÓNICO · El XML firmado es el documento autorizado por el SRI.':'BORRADOR PARA REVISIÓN — SIN VALIDEZ TRIBUTARIA.',L,fy,{width:util-50});doc.text(`Página ${i+1}`,right-45,fy,{width:45,align:'right'});}
  doc.end();return listo;
}
