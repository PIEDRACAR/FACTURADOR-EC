import type { FastifyInstance } from 'fastify';
import { supabase } from '../db/supabase.js';
import { generarExcelDesdeFilas } from '../services/excel.js';
import { generarPdfTabla } from '../services/pdfReportes.js';
import { fechaIsoEcuador } from '../utils/fechaEcuador.js';

/**
 * Toda la lógica de cada reporte vive en una función `obtener...` separada
 * del handler HTTP, para que tanto la ruta "ver en pantalla" (JSON) como la
 * ruta genérica de exportación (`/reportes/exportar`) usen exactamente la
 * misma consulta y el mismo cálculo — nunca se duplica la lógica entre las
 * dos formas de consumir un reporte.
 */

function desplazarFechaEcuador(fecha:string,dias:number){const d=new Date(`${fecha}T12:00:00-05:00`);d.setDate(d.getDate()+dias);return d.toISOString().slice(0,10);}
function rangoFechas(desde?: string, hasta?: string) {
  const hoy = fechaIsoEcuador(new Date());
  const fechaDesde = desde || desplazarFechaEcuador(hoy,-30);
  const fechaHasta = hasta || hoy;
  // America/Guayaquil = UTC-05:00. Convertimos los límites locales a UTC para no clasificar una venta nocturna como del día siguiente.
  const inicioUtc = new Date(`${fechaDesde}T00:00:00-05:00`).toISOString();
  const finUtc = new Date(`${desplazarFechaEcuador(fechaHasta,1)}T00:00:00-05:00`).toISOString();
  return { fechaDesde, fechaHasta, inicioUtc, finUtc };
}

function redondear(v: number): number {
  return Math.round(v * 100) / 100;
}

// ============================================================
// RENTABILIDAD POR PRODUCTO
// ============================================================
interface FilaItemRentabilidad {
  producto_id: string | null;
  descripcion: string;
  cantidad: number;
  precio_total_sin_impuesto: number;
  costo_unitario_momento: number;
  utilidad_linea: number;
}

async function obtenerRentabilidad(emisorId: string, desde?: string, hasta?: string) {
  const { fechaDesde, fechaHasta, inicioUtc, finUtc } = rangoFechas(desde, hasta);

  const { data, error } = await supabase
    .from('comprobante_items')
    .select(
      'producto_id, descripcion, cantidad, precio_total_sin_impuesto, costo_unitario_momento, utilidad_linea, comprobantes!inner(estado, created_at, emisor_id)'
    )
    .eq('comprobantes.emisor_id', emisorId)
    .eq('comprobantes.estado', 'autorizado')
    .gte('comprobantes.created_at', inicioUtc)
    .lt('comprobantes.created_at', finUtc);

  if (error) throw new Error(error.message);

  const filas = (data ?? []) as unknown as FilaItemRentabilidad[];
  const porProducto = new Map<
    string,
    { descripcion: string; cantidad: number; ingresos: number; costo: number; utilidad: number }
  >();

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

  const totales = productos.reduce(
    (acc, p) => ({ ingresos: acc.ingresos + p.ingresos, costo: acc.costo + p.costo, utilidad: acc.utilidad + p.utilidad }),
    { ingresos: 0, costo: 0, utilidad: 0 }
  );

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
async function obtenerVentasPeriodo(emisorId: string, desde?: string, hasta?: string) {
  const { fechaDesde, fechaHasta, inicioUtc, finUtc } = rangoFechas(desde, hasta);
  const { data, error } = await supabase.from('comprobantes')
    .select('tipo, importe_total, total_iva, subtotal_0, subtotal_5, subtotal_8, subtotal_15, created_at')
    .eq('emisor_id', emisorId).eq('estado', 'autorizado')
    .gte('created_at', inicioUtc).lt('created_at', finUtc);
  if (error) throw new Error(error.message);
  const porDia = new Map<string, any>();
  for (const c of data ?? []) {
    const dia = fechaIsoEcuador(new Date(c.created_at));
    const acc = porDia.get(dia) ?? { cantidad: 0, netoSinIva: 0, base0: 0, base5: 0, base8: 0, base15: 0, iva: 0, total: 0 };
    acc.cantidad += 1;
    acc.base0 = redondear(acc.base0 + Number((c as any).subtotal_0 || 0)); acc.base5 = redondear(acc.base5 + Number((c as any).subtotal_5 || 0));
    acc.base8 = redondear(acc.base8 + Number((c as any).subtotal_8 || 0)); acc.base15 = redondear(acc.base15 + Number((c as any).subtotal_15 || 0));
    acc.netoSinIva = redondear(acc.base0 + acc.base5 + acc.base8 + acc.base15);
    acc.iva = redondear(acc.iva + Number((c as any).total_iva || 0)); acc.total = redondear(acc.total + Number((c as any).importe_total || 0));
    porDia.set(dia, acc);
  }
  const dias = Array.from(porDia.entries()).map(([fecha, v]) => ({ fecha, ...v })).sort((a, b) => a.fecha.localeCompare(b.fecha));
  const totales = dias.reduce((a: any, d: any) => ({ cantidad: a.cantidad+d.cantidad, netoSinIva:redondear(a.netoSinIva+d.netoSinIva), base0:redondear(a.base0+d.base0), base5:redondear(a.base5+d.base5), base8:redondear(a.base8+d.base8), base15:redondear(a.base15+d.base15), iva:redondear(a.iva+d.iva), total:redondear(a.total+d.total) }), {cantidad:0,netoSinIva:0,base0:0,base5:0,base8:0,base15:0,iva:0,total:0});
  return { desde: fechaDesde, hasta: fechaHasta, dias, totales, cantidadFacturas:totales.cantidad, totalVentas:totales.total, promedioFactura:totales.cantidad?redondear(totales.total/totales.cantidad):0 };
}

// ============================================================
// LISTADO DE VENTAS (detalle, una fila por factura)
// ============================================================
async function obtenerListadoVentas(emisorId: string, desde?: string, hasta?: string, qTexto?: string, estadoFiltro?: string, tipoFiltro?: string) {
  const { fechaDesde, fechaHasta, inicioUtc, finUtc } = rangoFechas(desde, hasta);
  let consulta = supabase
    .from('comprobantes')
    .select('id, tipo, secuencial, created_at, importe_total, total_iva, subtotal_0, subtotal_5, subtotal_8, subtotal_15, estado, clave_acceso, numero_autorizacion, clientes(razon_social, email, identificacion)')
    .eq('emisor_id', emisorId)
    .gte('created_at', inicioUtc)
    .lt('created_at', finUtc)
    .order('created_at', { ascending: false });
  if (estadoFiltro) consulta = consulta.eq('estado', estadoFiltro);
  if (tipoFiltro) consulta = consulta.eq('tipo', tipoFiltro);
  const { data, error } = await consulta.limit(10000);
  if (error) throw new Error(error.message);

  const q = String(qTexto ?? '').trim().toLowerCase();
  const ventas = (data ?? []).map((v: any) => {
    const subtotalSinIva = redondear(Number(v.subtotal_0 || 0) + Number(v.subtotal_5 || 0) + Number(v.subtotal_8 || 0) + Number(v.subtotal_15 || 0));
    const cliente = (v.clientes as { razon_social?: string; email?: string; identificacion?: string } | null);
    return {
      id: v.id,
      fecha: fechaIsoEcuador(new Date(v.created_at)),
      fechaHora: new Date(v.created_at).toLocaleString('es-EC', { timeZone: 'America/Guayaquil' }),
      tipo: String(v.tipo || '—').toUpperCase(),
      secuencial: v.secuencial ?? '—',
      cliente: cliente?.razon_social ?? 'Consumidor Final',
      email: cliente?.email ?? '',
      identificacion: cliente?.identificacion ?? '',
      subtotal0: redondear(Number(v.subtotal_0 || 0)),
      subtotal5: redondear(Number(v.subtotal_5 || 0)),
      subtotal8: redondear(Number(v.subtotal_8 || 0)),
      subtotal15: redondear(Number(v.subtotal_15 || 0)),
      netoSinIva: subtotalSinIva,
      iva: redondear(Number(v.total_iva || 0)),
      total: redondear(Number(v.importe_total || 0)),
      estado: String(v.estado || '').toUpperCase(),
      claveAcceso: v.clave_acceso ?? '',
      numeroAutorizacion: v.numero_autorizacion ?? '',
    };
  }).filter((v: any) => !q || `${v.tipo} ${v.secuencial} ${v.cliente} ${v.identificacion} ${v.email} ${v.claveAcceso} ${v.numeroAutorizacion}`.toLowerCase().includes(q));

  const autorizadas = ventas.filter((v) => v.estado === 'AUTORIZADO');
  const totales = autorizadas.reduce((a, v) => ({
    netoSinIva: redondear(a.netoSinIva + v.netoSinIva),
    base0: redondear(a.base0 + v.subtotal0), base5: redondear(a.base5 + v.subtotal5), base8: redondear(a.base8 + v.subtotal8), base15: redondear(a.base15 + v.subtotal15),
    iva: redondear(a.iva + v.iva), total: redondear(a.total + v.total), cantidad: a.cantidad + 1,
  }), { netoSinIva: 0, base0: 0, base5: 0, base8: 0, base15: 0, iva: 0, total: 0, cantidad: 0 });

  return { desde: fechaDesde, hasta: fechaHasta, filtros: { q: qTexto ?? '', estado: estadoFiltro ?? '', tipo: tipoFiltro ?? '' }, ventas, totales, totalGeneral: totales.total };
}

// ============================================================
// LISTADO DE COMPRAS (entradas de inventario, detalle)
// ============================================================
async function obtenerListadoCompras(emisorId: string, desde?: string, hasta?: string) {
  const { fechaDesde, fechaHasta, inicioUtc, finUtc } = rangoFechas(desde, hasta);

  const { data, error } = await supabase
    .from('movimientos_inventario')
    .select('created_at, cantidad, costo_unitario, nota, productos(descripcion), proveedores(razon_social)')
    .eq('emisor_id', emisorId)
    .eq('tipo', 'entrada')
    .gte('created_at', inicioUtc)
    .lt('created_at', finUtc)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);

  const compras = (data ?? []).map((c) => ({
    fecha: fechaIsoEcuador(new Date(c.created_at)),
    producto: (c.productos as unknown as { descripcion: string } | null)?.descripcion ?? '—',
    proveedor: (c.proveedores as unknown as { razon_social: string } | null)?.razon_social ?? (c.nota || '—'),
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
async function obtenerReporteClientes(emisorId: string, desde?: string, hasta?: string) {
  const { fechaDesde, inicioUtc, finUtc } = rangoFechas(desde, hasta);

  const { data, error } = await supabase
    .from('comprobantes')
    .select('importe_total, cliente_id, clientes(razon_social, identificacion)')
    .eq('emisor_id', emisorId)
    .eq('estado', 'autorizado')
    .gte('created_at', inicioUtc)
    .lt('created_at', finUtc);

  if (error) throw new Error(error.message);

  const porCliente = new Map<string, { cliente: string; identificacion: string; cantidadCompras: number; totalComprado: number }>();
  for (const v of data ?? []) {
    const cli = v.clientes as unknown as { razon_social: string; identificacion: string } | null;
    if (!cli) continue;
    const clave = v.cliente_id as string;
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
async function obtenerReporteProveedores(emisorId: string, desde?: string, hasta?: string) {
  const { fechaDesde, inicioUtc, finUtc } = rangoFechas(desde, hasta);
  const {data:provs,error:pe}=await supabase.from('proveedores').select('id,razon_social,identificacion').eq('emisor_id',emisorId).eq('activo',true).order('razon_social');
  if(pe) throw new Error(pe.message);
  const { data, error } = await supabase.from('movimientos_inventario').select('cantidad,costo_unitario,proveedor_id').eq('emisor_id',emisorId).eq('tipo','entrada').not('proveedor_id','is',null).gte('created_at',inicioUtc).lt('created_at',finUtc);
  if(error) throw new Error(error.message);
  const mapa=new Map<string,any>((provs||[]).map(p=>[p.id,{proveedor:p.razon_social,identificacion:p.identificacion,cantidadCompras:0,totalComprado:0}]));
  for(const m of data||[]){const x=mapa.get(m.proveedor_id);if(!x)continue;x.cantidadCompras+=1;x.totalComprado=redondear(x.totalComprado+Number(m.cantidad||0)*Number(m.costo_unitario||0));}
  const proveedores=Array.from(mapa.values()).sort((a,b)=>b.totalComprado-a.totalComprado);
  return {proveedores,totalGeneral:redondear(proveedores.reduce((acc,p)=>acc+p.totalComprado,0))};
}

// ============================================================
// CUENTAS POR COBRAR / PAGAR — resumen + listado detallado
// ============================================================
async function obtenerResumenCxC(emisorId: string) {
  const { data, error } = await supabase
    .from('cuentas_por_cobrar')
    .select('monto_total, monto_cobrado, fecha_vencimiento, estado')
    .eq('emisor_id', emisorId)
    .eq('estado', 'pendiente');
  if (error) throw new Error(error.message);

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
  const detalle=await obtenerListadoCxC(emisorId);
  return {
    totalPendiente: redondear(totalPendiente),
    totalVencido: redondear(totalVencido),
    cantidadCuentasPendientes: (data ?? []).length,
    cantidadVencidas,
    detalle,
  };
}

async function obtenerResumenCxP(emisorId: string) {
  const { data, error } = await supabase
    .from('cuentas_por_pagar')
    .select('monto_total, monto_pagado, fecha_vencimiento, estado')
    .eq('emisor_id', emisorId)
    .eq('estado', 'pendiente');
  if (error) throw new Error(error.message);

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
  const detalle=await obtenerListadoCxP(emisorId);
  return {
    totalPendiente: redondear(totalPendiente),
    totalVencido: redondear(totalVencido),
    cantidadCuentasPendientes: (data ?? []).length,
    cantidadVencidas,
    detalle,
  };
}

async function obtenerListadoCxC(emisorId: string) {
  const hoy = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('cuentas_por_cobrar')
    .select('concepto, fecha_vencimiento, monto_total, monto_cobrado, estado, clientes(razon_social)')
    .eq('emisor_id', emisorId)
    .order('fecha_vencimiento', { ascending: true });
  if (error) throw new Error(error.message);

  return (data ?? []).map((c) => ({
    cliente: (c.clientes as unknown as { razon_social: string } | null)?.razon_social ?? '—',
    concepto: c.concepto,
    vencimiento: c.fecha_vencimiento,
    montoTotal: redondear(Number(c.monto_total)),
    saldo: redondear(Number(c.monto_total) - Number(c.monto_cobrado)),
    estado: c.estado === 'pendiente' && c.fecha_vencimiento < hoy ? 'vencida' : c.estado,
  }));
}

async function obtenerListadoCxP(emisorId: string) {
  const hoy = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('cuentas_por_pagar')
    .select('concepto, fecha_vencimiento, monto_total, monto_pagado, estado, proveedores(razon_social)')
    .eq('emisor_id', emisorId)
    .order('fecha_vencimiento', { ascending: true });
  if (error) throw new Error(error.message);

  return (data ?? []).map((c) => ({
    proveedor: (c.proveedores as unknown as { razon_social: string } | null)?.razon_social ?? '—',
    concepto: c.concepto,
    vencimiento: c.fecha_vencimiento,
    montoTotal: redondear(Number(c.monto_total)),
    saldo: redondear(Number(c.monto_total) - Number(c.monto_pagado)),
    estado: c.estado === 'pendiente' && c.fecha_vencimiento < hoy ? 'vencida' : c.estado,
  }));
}

// ============================================================
// MOVIMIENTOS DE CAJA — trazabilidad cronológica y descargable
// ============================================================
async function obtenerMovimientosCajaDetallados(emisorId: string, desde?: string, hasta?: string, qTexto?: string) {
  const { fechaDesde, fechaHasta, inicioUtc, finUtc } = rangoFechas(desde, hasta);
  const { data: cajas, error: ce } = await supabase.from('cajas').select('id,fecha_apertura,fecha_cierre,monto_inicial,estado').eq('emisor_id',emisorId).order('fecha_apertura',{ascending:false}).limit(500);
  if(ce) throw new Error(ce.message);
  const cajasRango=(cajas||[]).filter((c:any)=>new Date(c.fecha_apertura)<new Date(finUtc) && (!c.fecha_cierre || new Date(c.fecha_cierre)>=new Date(inicioUtc)));
  const ids=cajasRango.map((c:any)=>c.id);
  let movs:any[]=[]; let me:any=null; if(ids.length){const r=await supabase.from('movimientos_caja').select('id,caja_id,tipo,concepto,monto,forma_pago,created_at').in('caja_id',ids).gte('created_at',inicioUtc).lt('created_at',finUtc).order('created_at',{ascending:false}); movs=r.data||[]; me=r.error||null;} 
  if(me) throw new Error(me.message);
  const {data:pagos,error:pe}=await supabase.from('comprobantes').select('id,secuencial,tipo,created_at,importe_total,clientes(razon_social),comprobante_formas_pago(forma_pago_codigo,valor)').eq('emisor_id',emisorId).eq('estado','autorizado').gte('created_at',inicioUtc).lt('created_at',finUtc).order('created_at',{ascending:false});
  if(pe) throw new Error(pe.message);
  const cajaDe=(fecha:string)=>cajasRango.find((c:any)=>{const t=new Date(fecha).getTime();return t>=new Date(c.fecha_apertura).getTime() && (!c.fecha_cierre || t<=new Date(c.fecha_cierre).getTime())});
  const nombreForma=(c:string)=>({'01':'Efectivo','16':'Tarjeta débito','19':'Tarjeta crédito','20':'Sistema financiero','21':'Endoso','22':'Otros','23':'Otros'} as any)[c]||c||'—';
  const filas:any[]=[];
  for(const m of movs||[]){const c=cajasRango.find((x:any)=>x.id===m.caja_id);filas.push({fechaHora:new Date(m.created_at).toLocaleString('es-EC',{timeZone:'America/Guayaquil'}),caja:c?new Date(c.fecha_apertura).toLocaleDateString('es-EC',{timeZone:'America/Guayaquil'}):'—',tipo:String(m.tipo).toUpperCase(),concepto:m.concepto,formaPago:nombreForma(m.forma_pago),documento:'Movimiento manual',monto:(m.tipo==='egreso'?-1:1)*Number(m.monto||0),comprobanteId:null});}
  for(const v of pagos||[]){const c=cajaDe(v.created_at);if(!c)continue;for(const fp of (v as any).comprobante_formas_pago||[]){const valor=Number(fp.valor||0);filas.push({fechaHora:new Date(v.created_at).toLocaleString('es-EC',{timeZone:'America/Guayaquil'}),caja:new Date(c.fecha_apertura).toLocaleDateString('es-EC',{timeZone:'America/Guayaquil'}),tipo:'VENTA',concepto:`Venta ${(v as any).clientes?.razon_social||'Consumidor Final'}`,formaPago:nombreForma(fp.forma_pago_codigo),documento:`${String(v.tipo||'factura').toUpperCase()} ${v.secuencial||''}`,monto:valor,comprobanteId:v.id});}}
  const q=String(qTexto||'').trim().toLowerCase();const resultado=filas.filter(x=>!q||`${x.fechaHora} ${x.tipo} ${x.concepto} ${x.formaPago} ${x.documento}`.toLowerCase().includes(q)).sort((a,b)=>a.fechaHora.localeCompare(b.fechaHora));
  const ingresos=redondear(resultado.filter(x=>x.monto>0).reduce((a,x)=>a+x.monto,0));const egresos=redondear(resultado.filter(x=>x.monto<0).reduce((a,x)=>a+Math.abs(x.monto),0));
  return {desde:fechaDesde,hasta:fechaHasta,movimientos:resultado,totales:{ingresos,egresos,neto:redondear(ingresos-egresos)}};
}

// ============================================================
// INVENTARIO VALORIZADO
// ============================================================
async function obtenerInventarioValorizado(emisorId: string) {
  const { data, error } = await supabase
    .from('productos')
    .select('descripcion, codigo_principal, stock_actual, costo_promedio')
    .eq('emisor_id', emisorId)
    .eq('activo', true)
    .gt('stock_actual', 0)
    .order('descripcion', { ascending: true });
  if (error) throw new Error(error.message);

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
export async function registrarRutasReportes(app: FastifyInstance) {
  app.get<{ Querystring: { emisorId?: string; desde?: string; hasta?: string } }>('/reportes/caja', async (request, reply) => {
    const { emisorId, desde, hasta } = request.query;
    if (!emisorId) return reply.status(400).send({ error: 'Falta emisorId.' });
    try {
      let q = supabase.from('cajas').select('id, fecha_apertura, fecha_cierre, monto_inicial, efectivo_declarado, diferencia, estado, nota').eq('emisor_id', emisorId).order('fecha_apertura', { ascending: false });
      if (desde) q = q.gte('fecha_apertura', desde);
      if (hasta) q = q.lte('fecha_apertura', hasta + 'T23:59:59');
      const { data: cajas, error } = await q.limit(500);
      if (error) throw new Error(error.message);

      const ids = (cajas ?? []).map((c) => c.id);
      const movimientos = ids.length ? (await supabase.from('movimientos_caja').select('caja_id,tipo,monto,forma_pago,created_at').in('caja_id', ids)).data ?? [] : [];
      let pagosQ = supabase.from('comprobantes').select('id,created_at,importe_total,comprobante_formas_pago(forma_pago_codigo,valor)').eq('emisor_id', emisorId).eq('estado', 'autorizado');
      if (desde) pagosQ = pagosQ.gte('created_at', desde);
      if (hasta) pagosQ = pagosQ.lte('created_at', hasta + 'T23:59:59');
      const { data: pagos, error: pagosError } = await pagosQ;
      if (pagosError) throw new Error(pagosError.message);

      const resumen = { ventasEfectivo: 0, ventasOtros: 0, ingresosManuales: 0, egresosManuales: 0 };
      for (const c of pagos ?? []) for (const p of (c as any).comprobante_formas_pago ?? []) {
        const v = Number(p.valor) || 0;
        if (p.forma_pago_codigo === '01') resumen.ventasEfectivo += v; else resumen.ventasOtros += v;
      }
      for (const m of movimientos) {
        const v = Number(m.monto) || 0;
        if (m.tipo === 'ingreso') resumen.ingresosManuales += v; else resumen.egresosManuales += v;
      }

      const filas = (cajas ?? []).map((c) => {
        const apertura = new Date(c.fecha_apertura).getTime();
        const cierre = c.fecha_cierre ? new Date(c.fecha_cierre).getTime() : Date.now();
        const ventas = (pagos ?? []).filter((v) => {
          const t = new Date(v.created_at).getTime(); return t >= apertura && t <= cierre;
        });
        let ventasEfectivo = 0;
        for (const v of ventas) for (const p of (v as any).comprobante_formas_pago ?? []) if (p.forma_pago_codigo === '01') ventasEfectivo += Number(p.valor) || 0;
        const mov = movimientos.filter((m) => m.caja_id === c.id);
        const manualEfectivo = mov.reduce((a, m) => a + (m.forma_pago === '01' ? (m.tipo === 'ingreso' ? Number(m.monto) : -Number(m.monto)) : 0), 0);
        const efectivoEsperado = redondear(Number(c.monto_inicial) + ventasEfectivo + manualEfectivo);
        return {
          id: c.id,
          apertura: new Date(c.fecha_apertura).toLocaleString('es-EC', { timeZone: 'America/Guayaquil' }),
          cierre: c.fecha_cierre ? new Date(c.fecha_cierre).toLocaleString('es-EC', { timeZone: 'America/Guayaquil' }) : null,
          estado: c.estado,
          inicial: redondear(Number(c.monto_inicial)),
          efectivoEsperado,
          declarado: c.efectivo_declarado == null ? null : redondear(Number(c.efectivo_declarado)),
          diferencia: c.diferencia == null ? null : redondear(Number(c.diferencia)),
          nota: c.nota ?? '',
        };
      });
      return reply.send({ cajas: filas, resumen });
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get<{ Querystring: { emisorId?: string; desde?: string; hasta?: string } }>('/reportes/rentabilidad', async (request, reply) => {
    const { emisorId, desde, hasta } = request.query;
    if (!emisorId) return reply.status(400).send({ error: 'Falta el parámetro emisorId.' });
    try {
      return reply.send(await obtenerRentabilidad(emisorId, desde, hasta));
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get<{ Querystring: { emisorId?: string; desde?: string; hasta?: string } }>('/reportes/ventas-periodo', async (request, reply) => {
    const { emisorId, desde, hasta } = request.query;
    if (!emisorId) return reply.status(400).send({ error: 'Falta el parámetro emisorId.' });
    try {
      return reply.send(await obtenerVentasPeriodo(emisorId, desde, hasta));
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });


  app.get<{ Querystring: { emisorId?: string; desde?: string; hasta?: string } }>('/reportes/auditoria', async (request, reply) => {
    const { emisorId, desde, hasta } = request.query;
    if (!emisorId) return reply.status(400).send({ error: 'Falta el parámetro emisorId.' });
    try {
      const fechaDesde = desde || new Date(Date.now() - 30 * 86400000).toISOString();
      const fechaHasta = hasta ? `${hasta}T23:59:59.999Z` : new Date().toISOString();
      const { data: eventos, error } = await supabase.from('auditoria_sri')
        .select('id,created_at,user_id,usuario_email,tipo_documento,evento,estado,clave_acceso,secuencial,comprobante_id,detalle')
        .eq('emisor_id', emisorId).gte('created_at', fechaDesde).lte('created_at', fechaHasta)
        .order('created_at', { ascending: false }).limit(500);
      if (error) throw new Error(error.message);

      const { data: conf } = await supabase.from('configuracion_sistema').select('ruc_proveedor_facturacion,incluir_ruc_proveedor').eq('emisor_id', emisorId).maybeSingle();
      const rucProveedor = process.env.RUC_PROVEEDOR_FACTURACION?.trim() || String(conf?.ruc_proveedor_facturacion ?? '').trim();
      const { count: autorizados } = await supabase.from('comprobantes').select('id', { count: 'exact', head: true }).eq('emisor_id', emisorId).eq('estado','autorizado');
      const { count: archivados } = await supabase.from('comprobante_archivos').select('id', { count: 'exact', head: true }).eq('emisor_id', emisorId);
      const { count: rechazados } = await supabase.from('comprobantes').select('id', { count: 'exact', head: true }).eq('emisor_id', emisorId).in('estado',['rechazado','devuelto']);
      const { data: muestras } = await supabase.from('comprobantes').select('id,clave_acceso,xml_firmado').eq('emisor_id',emisorId).eq('estado','autorizado').order('created_at',{ascending:false}).limit(50);
      const muestrasConRuc = (muestras ?? []).filter((x:any) => /RUC Proveedor/i.test(String(x.xml_firmado||'')) && rucProveedor && String(x.xml_firmado).includes(rucProveedor)).length;

      const coberturaArchivo = autorizados ? Math.round(((archivados ?? 0) / autorizados) * 1000) / 10 : 100;
      const coberturaRuc = (muestras?.length ?? 0) ? Math.round((muestrasConRuc / (muestras?.length ?? 1)) * 100) : 100;
      const checklist = [
        { clave:'proveedor_ruc', titulo:'RUC del proveedor del sistema', estado:/^\d{13}$/.test(rucProveedor) ? 'CUMPLE' : 'NO CUMPLE', detalle:rucProveedor ? `Configurado: ${rucProveedor}` : 'Falta RUC_PROVEEDOR_FACTURACION en Railway.' },
        { clave:'ruc_xml', titulo:'RUC del proveedor en XML', estado:coberturaRuc === 100 ? 'CUMPLE' : (coberturaRuc > 0 ? 'REVISAR' : 'NO CUMPLE'), detalle:`Muestra reciente: ${muestrasConRuc}/${muestras?.length ?? 0} XML contienen el RUC configurado.` },
        { clave:'archivo_7_anios', titulo:'Conservación documental', estado:coberturaArchivo === 100 ? 'CUMPLE' : 'REVISAR', detalle:`Archivo permanente cubre aproximadamente ${coberturaArchivo}% de comprobantes autorizados. La conservación legal debe mantenerse durante 7 años.` },
        { clave:'transmision', titulo:'Transmisión inmediata', estado:'REVISAR', detalle:'El sistema envía el comprobante al SRI durante la emisión; la base actual no conserva un sello independiente de milisegundos para certificar el tiempo exacto de transmisión.' },
        { clave:'secuenciales', titulo:'Control de secuenciales', estado:'CUMPLE', detalle:'Los secuenciales se obtienen mediante actualización atómica del punto de emisión para evitar duplicados concurrentes.' },
        { clave:'trazabilidad', titulo:'Trazabilidad / auditoría', estado:(eventos?.length ?? 0) > 0 ? 'CUMPLE' : 'REVISAR', detalle:`${eventos?.length ?? 0} eventos auditados en el período.` },
        { clave:'rechazos', titulo:'Comprobantes rechazados/devueltos', estado:(rechazados ?? 0) === 0 ? 'CUMPLE' : 'REVISAR', detalle:`${rechazados ?? 0} comprobantes requieren revisión o corrección.` },
      ];
      return reply.send({ desde: fechaDesde, hasta: fechaHasta, resumen:{autorizados:autorizados??0,archivados:archivados??0,rechazados:rechazados??0,coberturaArchivo,coberturaRuc}, checklist, eventos:eventos ?? [] });
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get<{ Querystring: { emisorId?: string; desde?: string; hasta?: string; q?: string; estado?: string; tipo?: string } }>('/reportes/ventas', async (request, reply) => {
    const { emisorId, desde, hasta, q, estado, tipo } = request.query;
    if (!emisorId) return reply.status(400).send({ error: 'Falta el parámetro emisorId.' });
    try {
      return reply.send(await obtenerListadoVentas(emisorId, desde, hasta, q, estado, tipo));
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get<{ Querystring: { emisorId?: string } }>('/reportes/proformas', async (request, reply) => {
    const { emisorId } = request.query;
    if (!emisorId) return reply.status(400).send({ error: 'Falta el parámetro emisorId.' });
    const { data, error } = await supabase.from('proformas').select('numero_proforma, fecha_emision, fecha_validez, estado, total, clientes(razon_social)').eq('emisor_id', emisorId).order('created_at', { ascending: false });
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send((data ?? []).map((p) => ({ numero:p.numero_proforma, fechaEmision:p.fecha_emision, fechaValidez:p.fecha_validez, cliente:(p.clientes as unknown as { razon_social:string } | null)?.razon_social ?? '—', estado:p.estado, total:Number(p.total) })));
  });

  app.get<{ Querystring: { emisorId?: string; desde?: string; hasta?: string } }>('/reportes/compras', async (request, reply) => {
    const { emisorId, desde, hasta } = request.query;
    if (!emisorId) return reply.status(400).send({ error: 'Falta el parámetro emisorId.' });
    try {
      return reply.send(await obtenerListadoCompras(emisorId, desde, hasta));
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get<{ Querystring: { emisorId?: string; desde?: string; hasta?: string } }>('/reportes/clientes', async (request, reply) => {
    const { emisorId, desde, hasta } = request.query;
    if (!emisorId) return reply.status(400).send({ error: 'Falta el parámetro emisorId.' });
    try {
      return reply.send(await obtenerReporteClientes(emisorId, desde, hasta));
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get<{ Querystring: { emisorId?: string; desde?: string; hasta?: string } }>('/reportes/proveedores', async (request, reply) => {
    const { emisorId, desde, hasta } = request.query;
    if (!emisorId) return reply.status(400).send({ error: 'Falta el parámetro emisorId.' });
    try {
      return reply.send(await obtenerReporteProveedores(emisorId, desde, hasta));
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get<{ Querystring: { emisorId?: string } }>('/reportes/cuentas-por-cobrar', async (request, reply) => {
    const { emisorId } = request.query;
    if (!emisorId) return reply.status(400).send({ error: 'Falta el parámetro emisorId.' });
    try {
      return reply.send(await obtenerResumenCxC(emisorId));
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get<{ Querystring: { emisorId?: string } }>('/reportes/cuentas-por-pagar', async (request, reply) => {
    const { emisorId } = request.query;
    if (!emisorId) return reply.status(400).send({ error: 'Falta el parámetro emisorId.' });
    try {
      return reply.send(await obtenerResumenCxP(emisorId));
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get<{ Querystring: { emisorId?: string } }>('/reportes/inventario-valorizado', async (request, reply) => {
    const { emisorId } = request.query;
    if (!emisorId) return reply.status(400).send({ error: 'Falta el parámetro emisorId.' });
    try {
      return reply.send(await obtenerInventarioValorizado(emisorId));
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get<{ Querystring: { emisorId?: string; desde?: string; hasta?: string; q?: string } }>('/reportes/caja-movimientos', async (request, reply) => {
    const {emisorId,desde,hasta,q}=request.query; if(!emisorId)return reply.status(400).send({error:'Falta el parámetro emisorId.'});
    try{return reply.send(await obtenerMovimientosCajaDetallados(emisorId,desde,hasta,q));}catch(e){return reply.status(500).send({error:e instanceof Error?e.message:String(e)})}
  });

  // --------------------------------------------
  // EXPORTACIÓN GENÉRICA (Excel / PDF) — un solo endpoint para todos los
  // tipos de reporte, para no duplicar el mecanismo de exportar 9 veces.
  // --------------------------------------------
  app.get<{ Querystring: { emisorId?: string; tipo?: string; formato?: string; desde?: string; hasta?: string; q?: string; estado?: string; tipoDocumento?: string } }>(
    '/reportes/exportar',
    async (request, reply) => {
      const { emisorId, tipo, formato, desde, hasta, q, estado, tipoDocumento } = request.query;
      if (!emisorId) return reply.status(400).send({ error: 'Falta el parámetro emisorId.' });
      if (!tipo) return reply.status(400).send({ error: 'Falta el parámetro tipo.' });
      if (formato !== 'excel' && formato !== 'pdf') return reply.status(400).send({ error: 'formato debe ser excel o pdf.' });

      type Config = {
        titulo: string;
        columnas: Array<{ clave: string; etiqueta: string; ancho: number; alinearDerecha?: boolean }>;
        filas: Array<Record<string, unknown>>;
        filaTotales?: Record<string, unknown>;
      };

      let config: Config;

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
                { clave: 'fecha', etiqueta: 'Fecha', ancho: 90 },
                { clave: 'cantidad', etiqueta: 'Documentos', ancho: 70, alinearDerecha: true },
                { clave: 'netoSinIva', etiqueta: 'Neto s/IVA', ancho: 90, alinearDerecha: true },
                { clave: 'base0', etiqueta: 'Base 0%', ancho: 80, alinearDerecha: true },
                { clave: 'base5', etiqueta: 'Base 5%', ancho: 80, alinearDerecha: true },
                { clave: 'base8', etiqueta: 'Base 8%', ancho: 80, alinearDerecha: true },
                { clave: 'base15', etiqueta: 'Base 15%', ancho: 80, alinearDerecha: true },
                { clave: 'iva', etiqueta: 'IVA', ancho: 80, alinearDerecha: true },
                { clave: 'total', etiqueta: 'Total c/IVA', ancho: 90, alinearDerecha: true },
              ],
              filas: r.dias,
              filaTotales: { fecha: 'TOTAL', cantidad: r.totales.cantidad, netoSinIva:r.totales.netoSinIva, base0:r.totales.base0, base5:r.totales.base5, base8:r.totales.base8, base15:r.totales.base15, iva:r.totales.iva, total:r.totales.total },
            };
            break;
          }
          case 'ventas': {
            const r = await obtenerListadoVentas(emisorId, desde, hasta, q, estado, tipoDocumento);
            config = {
              titulo: 'Listado de ventas',
              columnas: [
                { clave: 'fechaHora', etiqueta: 'Fecha / hora', ancho: 88 },
                { clave: 'tipo', etiqueta: 'Tipo', ancho: 52 },
                { clave: 'secuencial', etiqueta: 'N.° comprobante', ancho: 76 },
                { clave: 'cliente', etiqueta: 'Cliente', ancho: 142 },
                { clave: 'identificacion', etiqueta: 'Identificación', ancho: 78 },
                { clave: 'netoSinIva', etiqueta: 'Neto s/IVA', ancho: 78, alinearDerecha: true },
                { clave: 'iva', etiqueta: 'IVA', ancho: 65, alinearDerecha: true },
                { clave: 'total', etiqueta: 'Total c/IVA', ancho: 78, alinearDerecha: true },
                { clave: 'estado', etiqueta: 'Estado', ancho: 75 },
              ],
              filas: r.ventas,
              filaTotales: { fechaHora: 'TOTAL', netoSinIva: r.totales.netoSinIva, iva: r.totales.iva, total: r.totales.total },
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
          case 'auditoria': {
            const { data: eventos, error: ae } = await supabase.from('auditoria_sri').select('created_at,usuario_email,evento,estado,secuencial,clave_acceso').eq('emisor_id',emisorId).order('created_at',{ascending:false}).limit(500);
            if (ae) throw new Error(ae.message);
            config = { titulo:'Auditoría SRI', columnas:[
              {clave:'created_at',etiqueta:'Fecha/Hora',ancho:145},{clave:'usuario_email',etiqueta:'Usuario',ancho:170},{clave:'evento',etiqueta:'Evento',ancho:150},{clave:'estado',etiqueta:'Estado',ancho:100},{clave:'secuencial',etiqueta:'Secuencial',ancho:100},{clave:'clave_acceso',etiqueta:'Clave de acceso',ancho:260}
            ], filas:eventos ?? [] };
            break;
          }
          case 'caja-movimientos': {
            const r=await obtenerMovimientosCajaDetallados(emisorId,desde,hasta,q);
            config={titulo:'Movimiento detallado de caja',columnas:[
              {clave:'fechaHora',etiqueta:'Fecha / hora',ancho:120},{clave:'caja',etiqueta:'Caja',ancho:75},{clave:'tipo',etiqueta:'Tipo',ancho:65},{clave:'concepto',etiqueta:'Concepto',ancho:220},{clave:'formaPago',etiqueta:'Forma de pago',ancho:95},{clave:'documento',etiqueta:'Documento',ancho:120},{clave:'monto',etiqueta:'Monto',ancho:85,alinearDerecha:true}
            ],filas:r.movimientos,filaTotales:{fechaHora:'TOTAL',ingresos:r.totales.ingresos,egresos:r.totales.egresos,monto:r.totales.neto}};
            break;
          }
          case 'caja': {
            const q = await supabase.from('cajas').select('id, fecha_apertura, fecha_cierre, monto_inicial, efectivo_declarado, diferencia, estado, nota').eq('emisor_id', emisorId).order('fecha_apertura', { ascending: false });
            if (q.error) throw new Error(q.error.message);
            const ids = (q.data ?? []).map((x) => x.id);
            const movimientos = ids.length ? (await supabase.from('movimientos_caja').select('caja_id,tipo,monto,forma_pago,created_at').in('caja_id', ids)).data ?? [] : [];
            const { data: pagos, error: pe } = await supabase.from('comprobantes').select('id,created_at,comprobante_formas_pago(forma_pago_codigo,valor)').eq('emisor_id',emisorId).eq('estado','autorizado');
            if (pe) throw new Error(pe.message);
            const filas = (q.data ?? []).map((x) => {
              const inicio = new Date(x.fecha_apertura).getTime();
              const fin = x.fecha_cierre ? new Date(x.fecha_cierre).getTime() : Date.now();
              const ventasEfectivo = (pagos ?? []).filter(v => { const t = new Date(v.created_at).getTime(); return t >= inicio && t <= fin; }).reduce((a,v) => a + ((v as any).comprobante_formas_pago ?? []).filter((p:any)=>p.forma_pago_codigo==='01').reduce((s:number,p:any)=>s+(Number(p.valor)||0),0),0);
              const manual = movimientos.filter(m=>m.caja_id===x.id && m.forma_pago==='01').reduce((a,m)=>a+(m.tipo==='ingreso'?1:-1)*(Number(m.monto)||0),0);
              return { apertura:new Date(x.fecha_apertura).toLocaleString('es-EC',{timeZone:'America/Guayaquil'}), cierre:x.fecha_cierre?new Date(x.fecha_cierre).toLocaleString('es-EC',{timeZone:'America/Guayaquil'}):'', estado:x.estado, inicial:Number(x.monto_inicial), efectivoEsperado:redondear(Number(x.monto_inicial)+ventasEfectivo+manual), declarado:x.efectivo_declarado==null?null:Number(x.efectivo_declarado), diferencia:x.diferencia==null?null:Number(x.diferencia) };
            });
            config = { titulo: 'Caja / arqueos', columnas: [
              { clave:'apertura', etiqueta:'Apertura', ancho:145 }, { clave:'cierre', etiqueta:'Cierre', ancho:145 }, { clave:'inicial', etiqueta:'Inicial', ancho:80, alinearDerecha:true },
              { clave:'efectivoEsperado', etiqueta:'Efectivo esperado', ancho:100, alinearDerecha:true }, { clave:'declarado', etiqueta:'Contado', ancho:80, alinearDerecha:true },
              { clave:'diferencia', etiqueta:'Diferencia', ancho:80, alinearDerecha:true }, { clave:'estado', etiqueta:'Estado', ancho:80 }
            ], filas };
            break;
          }
          case 'proformas': {
            const q = await supabase.from('proformas').select('numero_proforma, fecha_emision, fecha_validez, estado, total, clientes(razon_social)').eq('emisor_id', emisorId).order('created_at', { ascending: false });
            if (q.error) throw new Error(q.error.message);
            const filas = (q.data ?? []).map((p) => ({
              numero: p.numero_proforma,
              fechaEmision: p.fecha_emision,
              fechaValidez: p.fecha_validez,
              cliente: (p.clientes as unknown as { razon_social: string } | null)?.razon_social ?? '—',
              estado: p.estado,
              total: Number(p.total),
            }));
            config = { titulo:'Proformas', columnas:[
              {clave:'numero',etiqueta:'Número',ancho:100},{clave:'fechaEmision',etiqueta:'Emisión',ancho:100},{clave:'fechaValidez',etiqueta:'Validez',ancho:100},
              {clave:'cliente',etiqueta:'Cliente',ancho:220},{clave:'estado',etiqueta:'Estado',ancho:100},{clave:'total',etiqueta:'Total',ancho:90,alinearDerecha:true}
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
      } catch (err) {
        return reply.status(500).send({ error: err instanceof Error ? err.message : String(err) });
      }

      const nombreArchivo = `${tipo}-${new Date().toISOString().slice(0, 10)}`;

      const { data: emisorPdf } = await supabase.from('emisores').select('razon_social,nombre_comercial,ruc,direccion_matriz').eq('id', emisorId).maybeSingle();
      const empresaPdf = emisorPdf ? { razonSocial: emisorPdf.razon_social, nombreComercial: emisorPdf.nombre_comercial, ruc: emisorPdf.ruc, direccion: emisorPdf.direccion_matriz } : undefined;

      if (formato === 'excel') {
        const buffer = await generarExcelDesdeFilas(
          config.titulo,
          config.columnas.map((c) => ({ clave: c.clave, etiqueta: c.etiqueta })),
          config.filas
        );
        reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        reply.header('Content-Disposition', `attachment; filename="${nombreArchivo}.xlsx"`);
        return reply.send(buffer);
      } else {
        const buffer = await generarPdfTabla({
          titulo: config.titulo,
          subtitulo: (desde || hasta || q) ? `Período: ${desde || 'inicio'} al ${hasta || 'hoy'}${q ? ` · Filtro: ${q}` : ''}` : undefined,
          columnas: config.columnas,
          filas: config.filas,
          filaTotales: config.filaTotales,
          empresa: empresaPdf,
        });
        reply.header('Content-Type', 'application/pdf');
        reply.header('Content-Disposition', `attachment; filename="${nombreArchivo}.pdf"`);
        return reply.send(buffer);
      }
    }
  );
}
