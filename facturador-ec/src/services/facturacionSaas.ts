import type { FacturaData, FacturaDetail, TotalTax } from 'facturacion-electronica-ec';
import { supabase } from '../db/supabase.js';
import { emitirFactura } from './facturacion.js';
import { generarRidePdf } from './ride.js';
import { enviarComprobantePorCorreo } from './email.js';
import { fechaEmisionEcuador } from '../utils/fechaEcuador.js';

const red = (n:number) => Math.round(n * 100) / 100;

type ConfigIva = { tarifa_general:number; codigo_general:string; tarifa_reducida:number; codigo_reducida:string; tarifa_turismo:number; codigo_turismo:string };

async function obtenerConfigIva(emisorId:string):Promise<ConfigIva> {
  const {data} = await supabase.from('configuracion_iva').select('tarifa_general,codigo_general,tarifa_reducida,codigo_reducida,tarifa_turismo,codigo_turismo').eq('emisor_id',emisorId).maybeSingle();
  return {
    tarifa_general:Number(data?.tarifa_general ?? 15), codigo_general:String(data?.codigo_general ?? '4'),
    tarifa_reducida:Number(data?.tarifa_reducida ?? 5), codigo_reducida:String(data?.codigo_reducida ?? '5'),
    tarifa_turismo:Number(data?.tarifa_turismo ?? 8), codigo_turismo:String(data?.codigo_turismo ?? '8'),
  };
}

function calcularBaseDesdeTotal(total:number,tasa:number){
  if(tasa<=0) return {base:red(total), iva:0};
  const base=red(total/(1+tasa/100));
  return {base, iva:red(total-base)};
}

function codigoFormaPago(valor:string):string {
  const v=valor.trim().toLowerCase();
  if(/^\d{2}$/.test(v)) return v;
  if(v.includes('efect')) return '01';
  if(v.includes('tarjeta') && v.includes('cr')) return '19';
  if(v.includes('tarjeta') && v.includes('déb')) return '16';
  if(v.includes('transfer') || v.includes('depósito') || v.includes('deposito')) return '20';
  return '20';
}

/**
 * Emite la factura comercial del pago SaaS. El precio cobrado es el TOTAL
 * recibido; se descompone en base + IVA usando la configuración tributaria
 * vigente del proveedor. Esto evita que el pago registrado y la factura
 * queden descuadrados por el IVA.
 */
export async function facturarPagoSaas(pagoId:string):Promise<{ok:boolean; estado:string; comprobanteId?:string; secuencial?:string; claveAcceso?:string; numeroAutorizacion?:string|null; error?:string}> {
  const {data:pago,error:pErr}=await supabase.from('pagos_suscripcion').select('*,suscripciones(plan_id,planes_suscripcion(codigo,nombre,precio_mensual)),emisores(id,ruc,razon_social,nombre_comercial,direccion_matriz)').eq('id',pagoId).single();
  if(pErr||!pago) throw new Error(`Pago SaaS no encontrado: ${pErr?.message??pagoId}`);

  if(pago.comprobante_id && pago.estado_factura==='autorizada') {
    const {data:c}=await supabase.from('comprobantes').select('id,secuencial,clave_acceso,numero_autorizacion,estado').eq('id',pago.comprobante_id).maybeSingle();
    return {ok:true,estado:String(c?.estado??'AUTORIZADO'),comprobanteId:pago.comprobante_id,secuencial:c?.secuencial??undefined,claveAcceso:c?.clave_acceso??undefined,numeroAutorizacion:c?.numero_autorizacion??null};
  }

  const proveedorRuc=String(process.env.RUC_PROVEEDOR_FACTURACION??'').trim();
  if(!/^\d{13}$/.test(proveedorRuc)) throw new Error('Configura RUC_PROVEEDOR_FACTURACION con el RUC real del proveedor SaaS antes de facturar cobros.');
  const {data:proveedor,error:provErr}=await supabase.from('emisores').select('id').eq('ruc',proveedorRuc).maybeSingle();
  if(provErr||!proveedor) throw new Error('No existe en CONTSERTRIB el emisor del proveedor SaaS con RUC_PROVEEDOR_FACTURACION. Registra/configura primero su RUC, punto de emisión y certificado.');

  const clienteEmisor=pago.emisores as any;
  const {data:cliente,error:cErr}=await supabase.from('clientes').upsert({
    emisor_id:proveedor.id,
    tipo_identificacion: /^\d{13}$/.test(String(clienteEmisor.ruc)) ? '04' : '05',
    identificacion:String(clienteEmisor.ruc),
    razon_social:String(clienteEmisor.razon_social),
    email:null,
    direccion:clienteEmisor.direccion_matriz ?? null,
  },{onConflict:'emisor_id,tipo_identificacion,identificacion'}).select('id').single();
  if(cErr||!cliente) throw new Error(`No se pudo crear/obtener el cliente SaaS para facturación: ${cErr?.message??''}`);

  const cfg=await obtenerConfigIva(proveedor.id);
  const total=red(Number(pago.monto));
  const tasa=cfg.tarifa_general;
  const codigo=cfg.codigo_general;
  const {base,iva}=calcularBaseDesdeTotal(total,tasa);
  const plan=(pago.suscripciones as any)?.planes_suscripcion;
  const planNombre=String(plan?.nombre??'Servicio SaaS CONTSERTRIB');
  const periodo=`${pago.periodo_desde??pago.fecha_pago} al ${pago.periodo_hasta??pago.fecha_pago}`;
  const descripcion=`Suscripción ${planNombre} — servicio SaaS CONTSERTRIB — período ${periodo}`;

  let comprobanteId=String(pago.comprobante_id??'');
  if(!comprobanteId){
    const {data:comp,error:compErr}=await supabase.from('comprobantes').insert({
      emisor_id:proveedor.id,
      punto_emision_id:(await supabase.from('puntos_emision').select('id').eq('emisor_id',proveedor.id).eq('activo',true).order('establecimiento').order('punto_emision').limit(1).maybeSingle()).data?.id,
      tipo:'factura',secuencial:null,cliente_id:cliente.id,
      subtotal_0:0,subtotal_15:base,total_descuento:0,total_iva:iva,propina:0,importe_total:total,estado:'generado'
    }).select('id').single();
    if(compErr||!comp) throw new Error(`No se pudo crear el comprobante SaaS: ${compErr?.message??''}`);
    comprobanteId=comp.id;
    const {error:itemErr}=await supabase.from('comprobante_items').insert({comprobante_id:comprobanteId,producto_id:null,descripcion,cantidad:1,precio_unitario:base,descuento:0,precio_total_sin_impuesto:base,costo_unitario_momento:0,tarifa_iva:String(tasa),valor_iva:iva});
    if(itemErr) throw new Error(`No se pudo crear el detalle de la factura SaaS: ${itemErr.message}`);
    const {error:payErr}=await supabase.from('comprobante_formas_pago').insert({comprobante_id:comprobanteId,forma_pago_codigo:codigoFormaPago(String(pago.metodo??'20')),valor:total});
    if(payErr) throw new Error(`No se pudo registrar la forma de pago de la factura SaaS: ${payErr.message}`);
    await supabase.from('comprobante_impuestos').upsert({comprobante_id:comprobanteId,codigo_impuesto:'2',codigo_porcentaje:codigo,tarifa:tasa,base_imponible:base,valor:iva,descripcion:`IVA ${tasa}%`,fecha_vigencia:fechaEmisionEcuador()},{onConflict:'comprobante_id,codigo_impuesto,codigo_porcentaje'});
    await supabase.from('pagos_suscripcion').update({comprobante_id:comprobanteId,estado_factura:'pendiente',subtotal_facturado:base,iva_facturado:iva,tarifa_iva_facturada:tasa,codigo_porcentaje_iva_facturado:codigo,error_factura:null}).eq('id',pagoId);
    await supabase.from('facturas_saas').upsert({pago_suscripcion_id:pagoId,comprobante_id:comprobanteId,cliente_emisor_id:clienteEmisor.id,proveedor_emisor_id:proveedor.id,plan_id:(pago.suscripciones as any)?.plan_id??null,descripcion,subtotal:base,tarifa_iva:tasa,codigo_porcentaje_iva:codigo,iva,total,estado:'pendiente'},{onConflict:'pago_suscripcion_id'});
  }

  const detalles:FacturaDetail[]=[{codigoPrincipal:'SAAS',descripcion,cantidad:1,precioUnitario:base,descuento:0,precioTotalSinImpuesto:base,impuestos:[{codigo:'2',codigoPorcentaje:codigo,tarifa:tasa,baseImponible:base,valor:iva}]}];
  const impuestos:TotalTax[]=[{codigo:'2',codigoPorcentaje:codigo,baseImponible:base,valor:iva}];
  const facturaData:FacturaData={fechaEmision:fechaEmisionEcuador(),tipoIdentificacionComprador:/^\d{13}$/.test(String(clienteEmisor.ruc))?'04':'05',razonSocialComprador:String(clienteEmisor.razon_social),identificacionComprador:String(clienteEmisor.ruc),direccionComprador:clienteEmisor.direccion_matriz??undefined,totalSinImpuestos:base,totalDescuento:0,totalConImpuestos:impuestos,propina:0,importeTotal:total,pagos:[{formaPago:codigoFormaPago(String(pago.metodo??'20')),total}],detalles};

  try{
    const resultado=await emitirFactura({emisorId:proveedor.id,comprobanteId,facturaData});
    const autorizado=String(resultado.estado).toUpperCase()==='AUTORIZADO';
    await supabase.from('pagos_suscripcion').update({estado_factura:autorizado?'autorizada':'rechazada',error_factura:autorizado?null:(resultado.mensaje??`Estado SRI: ${resultado.estado}`)}).eq('id',pagoId);
    await supabase.from('facturas_saas').update({estado:autorizado?'autorizada':'rechazada',clave_acceso:resultado.claveAcceso,numero_autorizacion:resultado.numeroAutorizacion??null,error:autorizado?null:(resultado.mensaje??`Estado SRI: ${resultado.estado}`),updated_at:new Date().toISOString()}).eq('pago_suscripcion_id',pagoId);
    if(autorizado){
      try{
        const {data:authUser}=await supabase.from('usuarios_emisor').select('user_id').eq('emisor_id',clienteEmisor.id).eq('rol','admin').limit(1).maybeSingle();
        let email:string|null=null;
        if(authUser?.user_id){const r=await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/users/${authUser.user_id}`,{headers:{apikey:process.env.SUPABASE_SERVICE_ROLE_KEY??'',Authorization:`Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY??''}`}});if(r.ok) email=(await r.json()).email??null;}
        if(email){
          const ride=await generarRidePdf(comprobanteId);
          await enviarComprobantePorCorreo({to:email,subject:`Factura CONTSERTRIB ${resultado.secuencial}`,html:`<p>Estimado/a ${clienteEmisor.razon_social},</p><p>Adjuntamos la factura electrónica correspondiente a su suscripción SaaS.</p><p>Clave de acceso: <strong>${resultado.claveAcceso}</strong></p>`,attachments:[{filename:`${resultado.claveAcceso}.xml`,content:Buffer.from(resultado.xmlFirmado,'utf8').toString('base64'),type:'application/xml'},{filename:`RIDE-${resultado.secuencial}.pdf`,content:ride.toString('base64'),type:'application/pdf'}]});
        }
      }catch{/* El envío de correo no debe invalidar una factura ya autorizada. */}
    }
    return {ok:autorizado,estado:resultado.estado,comprobanteId,secuencial:resultado.secuencial,claveAcceso:resultado.claveAcceso,numeroAutorizacion:resultado.numeroAutorizacion??null,error:resultado.mensaje};
  }catch(e){
    const error=e instanceof Error?e.message:String(e);
    await supabase.from('pagos_suscripcion').update({estado_factura:'rechazada',error_factura:error}).eq('id',pagoId);
    await supabase.from('facturas_saas').update({estado:'rechazada',error,updated_at:new Date().toISOString()}).eq('pago_suscripcion_id',pagoId);
    return {ok:false,estado:'RECHAZADA',comprobanteId,error};
  }
}
