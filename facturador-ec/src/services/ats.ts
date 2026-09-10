import { supabase } from '../db/supabase.js';
import { comprobarCaracteristica } from './saas.js';

type AnyRow = Record<string, any>;

const esc = (v: unknown) => String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&apos;','"':'&quot;'}[c] as string));
const money = (v: unknown) => Number(v ?? 0).toFixed(2);
const fechaDdmmyyyy = (v: string) => { const [y,m,d] = v.slice(0,10).split('-'); return `${d}/${m}/${y}`; };

function tipoId(id: string | null | undefined): string {
  const x = String(id ?? '');
  if (x === '9999999999999') return '07';
  if (x.length === 13) return '04';
  if (x.length === 10) return '05';
  return '06';
}

function bloqueVenta(v: AnyRow) {
  const cliente = v.clientes ?? {};
  const tipo = v.tipo === 'nota_credito' ? '04' : v.tipo === 'nota_debito' ? '05' : '18';
  const base0 = Number(v.subtotal_0 ?? 0);
  const baseGrav = Number(v.subtotal_5 ?? 0) + Number(v.subtotal_8 ?? 0) + Number(v.subtotal_15 ?? 0);
  const iva = Number(v.total_iva ?? 0);
  const pagos = Array.isArray(v.comprobante_formas_pago) ? v.comprobante_formas_pago : [];
  const formas = [...new Set(pagos.map((p: AnyRow) => String(p.forma_pago_codigo || '')).filter(Boolean))];
  return {
    tpIdCliente: tipoId(cliente.identificacion), idCliente: String(cliente.identificacion || '9999999999999'), razon: cliente.razon_social || 'CONSUMIDOR FINAL',
    tipoComprobante: tipo, numero: 1, baseNo: 0, base0, baseGrav, iva, ice: 0, retIva: 0, retRenta: 0,
    formas: formas.length ? formas : ['01'], establecimiento: v.puntos_emision?.establecimiento || '001', totalBase: base0 + baseGrav,
  };
}

export async function generarAts(emisorId: string, anio: number, mes: number) {
  const feature = await comprobarCaracteristica(emisorId, 'ats');
  if (!feature.ok) throw new Error(feature.mensaje);
  if (!Number.isInteger(anio) || anio < 2002 || anio > 2100 || !Number.isInteger(mes) || mes < 1 || mes > 12) throw new Error('Período ATS no válido.');

  const desde = `${anio}-${String(mes).padStart(2,'0')}-01T00:00:00-05:00`;
  const siguiente = mes === 12 ? `${anio + 1}-01-01T00:00:00-05:00` : `${anio}-${String(mes + 1).padStart(2,'0')}-01T00:00:00-05:00`;
  const hasta = `${siguiente}`;

  const [{ data: emisor, error: eErr }, { data: ests }, { data: ventas, error: vErr }, { data: compras }, { data: retenciones }] = await Promise.all([
    supabase.from('emisores').select('ruc,razon_social').eq('id',emisorId).single(),
    supabase.from('establecimientos_emisor').select('codigo,activo').eq('emisor_id',emisorId).eq('activo',true).order('codigo'),
    supabase.from('comprobantes').select('id,tipo,secuencial,clave_acceso,numero_autorizacion,created_at,fecha_autorizacion,subtotal_0,subtotal_5,subtotal_8,subtotal_15,total_iva,importe_total,clientes(identificacion,razon_social),puntos_emision(establecimiento,punto_emision),comprobante_formas_pago(forma_pago_codigo,valor)').eq('emisor_id',emisorId).eq('estado','autorizado').gte('created_at',desde).lt('created_at',hasta).order('created_at'),
    supabase.from('ats_compras').select('*').eq('emisor_id',emisorId).gte('fecha_emision',`${anio}-${String(mes).padStart(2,'0')}-01`).lt('fecha_emision',siguiente.slice(0,10)).order('fecha_emision'),
    supabase.from('ats_retenciones').select('*').eq('emisor_id',emisorId).gte('fecha_emision',`${anio}-${String(mes).padStart(2,'0')}-01`).lt('fecha_emision',siguiente.slice(0,10)).order('fecha_emision'),
  ]);
  if (eErr || !emisor) throw new Error(eErr?.message || 'No se encontró el contribuyente.');
  if (vErr) throw new Error(vErr.message);

  const warnings: string[] = [];
  const ventaRows = (ventas ?? []).map(bloqueVenta);
  const agrupadas = new Map<string, AnyRow>();
  for (const v of ventaRows) {
    const key = `${v.tpIdCliente}|${v.idCliente}|${v.tipoComprobante}|${v.formas.join(',')}`;
    const a = agrupadas.get(key) ?? {...v, numero:0, baseNo:0, base0:0, baseGrav:0, iva:0, ice:0, retIva:0, retRenta:0};
    a.numero += 1; a.baseNo += v.baseNo; a.base0 += v.base0; a.baseGrav += v.baseGrav; a.iva += v.iva; a.ice += v.ice;
    agrupadas.set(key,a);
  }
  const ventasAgrupadas = [...agrupadas.values()];
  const totalVentas = ventasAgrupadas.reduce((s,v)=>s+v.baseNo+v.base0+v.baseGrav,0);
  const totalCompras = (compras ?? []).reduce((s,c)=>s+Number(c.base_no_objeto)+Number(c.base_iva_0)+Number(c.base_iva_diferente_0)+Number(c.base_exenta),0);
  if (!compras?.length) warnings.push('No existen compras ATS registradas para este período. El sistema no inventa compras a partir de movimientos de inventario porque estos no contienen necesariamente comprobante, autorización y sustento tributario.');
  if (!retenciones?.length) warnings.push('No existen retenciones ATS posteriores a la emisión registradas para este período.');
  if (!(ests ?? []).length) warnings.push('No existen establecimientos activos configurados. El ATS exige al menos un establecimiento activo inscrito en el RUC.');

  const ventasXml = ventasAgrupadas.map(v => `<detalleVentas><tpIdCliente>${esc(v.tpIdCliente)}</tpIdCliente><idCliente>${esc(v.idCliente)}</idCliente><parteRelVtas>NO</parteRelVtas><tipoComprobante>${esc(v.tipoComprobante)}</tipoComprobante><tipoEmision>E</tipoEmision><numeroComprobantes>${v.numero}</numeroComprobantes><baseNoGraIva>${money(v.baseNo)}</baseNoGraIva><baseImponible>${money(v.base0)}</baseImponible><baseImpGrav>${money(v.baseGrav)}</baseImpGrav><montoIva>${money(v.iva)}</montoIva><montoIce>${money(v.ice)}</montoIce><valorRetIva>${money(v.retIva)}</valorRetIva><valorRetRenta>${money(v.retRenta)}</valorRetRenta><formasDePago>${v.formas.map((f:string)=>`<formaPago>${esc(f)}</formaPago>`).join('')}</formasDePago></detalleVentas>`).join('');
  const comprasXml = (compras ?? []).map(c => `<detalleCompras><codSustento>${esc(c.cod_sustento)}</codSustento><tpIdProv>${esc(c.tipo_id_prov)}</tpIdProv><idProv>${esc(c.id_prov)}</idProv><tipoComprobante>${esc(c.tipo_comprobante)}</tipoComprobante><parteRel>${esc(c.parte_rel)}</parteRel><fechaRegistro>${fechaDdmmyyyy(String(c.fecha_emision))}</fechaRegistro><establecimiento>${esc(c.establecimiento)}</establecimiento><puntoEmision>${esc(c.punto_emision)}</puntoEmision><secuencial>${esc(c.secuencial)}</secuencial><fechaEmision>${fechaDdmmyyyy(String(c.fecha_emision))}</fechaEmision><autorizacion>${esc(c.autorizacion || '9999999999')}</autorizacion><baseNoGraIva>${money(c.base_no_objeto)}</baseNoGraIva><baseImponible>${money(c.base_iva_0)}</baseImponible><baseImpGrav>${money(c.base_iva_diferente_0)}</baseImpGrav><baseImpExe>${money(c.base_exenta)}</baseImpExe><montoIce>${money(c.monto_ice)}</montoIce><montoIva>${money(c.monto_iva)}</montoIva><valRetBien10>0.00</valRetBien10><valRetServ20>0.00</valRetServ20><valorRetBienes>0.00</valorRetBienes><valRetServ50>0.00</valRetServ50><valorRetServicios>0.00</valorRetServicios><valRetServ100>0.00</valRetServ100><pagoLocExt>01</pagoLocExt>${c.forma_pago ? `<formaPago>${esc(c.forma_pago)}</formaPago>` : ''}${Number(c.valor_ret_renta)>0 ? `<air><codRetAir>9999</codRetAir><baseImpAir>${money(c.base_iva_diferente_0)}</baseImpAir><porcentajeAir>0</porcentajeAir><valRetAir>${money(c.valor_ret_renta)}</valRetAir></air>` : ''}</detalleCompras>`).join('');
  const ventasEst = (ests ?? []).map(e => { const total = ventaRows.filter(v=>v.establecimiento===e.codigo).reduce((s,v)=>s+v.totalBase,0); return `<ventaEst><codEstab>${esc(e.codigo)}</codEstab><ventasEstab>${money(total)}</ventasEstab><ivaComp>0.00</ivaComp></ventaEst>`; }).join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<iva><TipoIDInformante>R</TipoIDInformante><IdInformante>${esc(emisor.ruc)}</IdInformante><razonSocial>${esc(emisor.razon_social)}</razonSocial><Anio>${anio}</Anio><Mes>${String(mes).padStart(2,'0')}</Mes><numEstabRuc>${String((ests ?? []).length).padStart(3,'0')}</numEstabRuc><totalVentas>${money(totalVentas)}</totalVentas><codigoOperativo>IVA</codigoOperativo><compras>${comprasXml}</compras><ventas>${ventasXml}</ventas><ventasEstablecimiento>${ventasEst}</ventasEstablecimiento><anulados></anulados></iva>`;

  const advertencias = [...warnings];
  const { data: saved, error: saveError } = await supabase.from('ats_generaciones').upsert({ emisor_id: emisorId, anio, mes, estado: advertencias.length ? 'observado' : 'generado', total_ventas: totalVentas, total_compras: totalCompras, xml, advertencias }, { onConflict: 'emisor_id,anio,mes' }).select('id,estado,total_ventas,total_compras,advertencias,created_at').single();
  if (saveError) throw new Error(`No se pudo guardar la generación ATS: ${saveError.message}`);
  return { ...saved, xml, resumen: { ventas: ventaRows.length, ventasAgrupadas: ventasAgrupadas.length, compras: compras?.length ?? 0, retenciones: retenciones?.length ?? 0, establecimientos: ests?.length ?? 0 }, advertencias };
}
