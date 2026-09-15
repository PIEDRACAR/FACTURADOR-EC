/** Catálogo SRI de retenciones de uso frecuente — vigencia desde 01/03/2026.
 * Los porcentajes se basan en la Resolución NAC-DGERCGC26-00000009 y para IVA
 * en la normativa SRI vigente. El usuario selecciona el concepto; el sistema
 * no permite digitar manualmente código/% cuando existe un concepto catalogado.
 */
export type RetencionCatalogo = { codigo: string; porcentaje: number; descripcion: string; impuesto: 'RENTA'|'IVA' };
export const RETENCIONES_SRI_2026: RetencionCatalogo[] = [
  {codigo:'303', porcentaje:10, descripcion:'Honorarios profesionales y servicios relacionados con título profesional — persona natural', impuesto:'RENTA'},
  {codigo:'303A', porcentaje:5, descripcion:'Servicios profesionales prestados por sociedades residentes', impuesto:'RENTA'},
  {codigo:'304', porcentaje:10, descripcion:'Servicios donde predomina el intelecto no relacionados con título profesional', impuesto:'RENTA'},
  {codigo:'304A', porcentaje:10, descripcion:'Comisiones y servicios donde predomina el intelecto', impuesto:'RENTA'},
  {codigo:'304B', porcentaje:10, descripcion:'Notarios y registradores de la propiedad y mercantil', impuesto:'RENTA'},
  {codigo:'304C', porcentaje:10, descripcion:'Deportistas, entrenadores, árbitros y cuerpo técnico', impuesto:'RENTA'},
  {codigo:'304D', porcentaje:10, descripcion:'Artistas por actividades ejercidas como tales', impuesto:'RENTA'},
  {codigo:'304E', porcentaje:10, descripcion:'Honorarios y pagos por servicios de docencia', impuesto:'RENTA'},
  {codigo:'307', porcentaje:3, descripcion:'Servicios donde predomina la mano de obra', impuesto:'RENTA'},
  {codigo:'308', porcentaje:10, descripcion:'Utilización o aprovechamiento de imagen o renombre / influencers', impuesto:'RENTA'},
  {codigo:'309', porcentaje:3, descripcion:'Medios de comunicación y agencias de publicidad', impuesto:'RENTA'},
  {codigo:'310', porcentaje:1, descripcion:'Transporte privado de pasajeros o transporte público/privado de carga', impuesto:'RENTA'},
  {codigo:'311', porcentaje:3, descripcion:'Pagos mediante liquidación de compra — nivel cultural o rusticidad', impuesto:'RENTA'},
  {codigo:'312', porcentaje:2, descripcion:'Transferencia de bienes muebles de naturaleza corporal', impuesto:'RENTA'},
  {codigo:'312A', porcentaje:1, descripcion:'Compra al productor de bienes agrícolas, pecuarios, forestales, bioacuáticos y similares', impuesto:'RENTA'},
  {codigo:'312C', porcentaje:1.75, descripcion:'Compra al comercializador de bienes agrícolas, pecuarios, forestales, bioacuáticos y similares', impuesto:'RENTA'},
  {codigo:'319', porcentaje:2, descripcion:'Arrendamiento mercantil prestado por sociedades', impuesto:'RENTA'},
  {codigo:'320', porcentaje:10, descripcion:'Arrendamiento de bienes inmuebles', impuesto:'RENTA'},
  {codigo:'322', porcentaje:2, descripcion:'Seguros y reaseguros — primas y cesiones', impuesto:'RENTA'},
  {codigo:'323', porcentaje:3, descripcion:'Rendimientos financieros pagados a naturales y sociedades (no IFIs)', impuesto:'RENTA'},
  {codigo:'332', porcentaje:0, descripcion:'Otras compras de bienes y servicios no sujetas a retención / RIMPE Negocios Populares', impuesto:'RENTA'},
  {codigo:'343', porcentaje:1, descripcion:'Otras retenciones aplicables al 1% / RIMPE Emprendedores', impuesto:'RENTA'},
  {codigo:'343A', porcentaje:2, descripcion:'Energía eléctrica', impuesto:'RENTA'},
  {codigo:'343B', porcentaje:2, descripcion:'Construcción de obra material inmueble, urbanización y similares', impuesto:'RENTA'},
  {codigo:'343C', porcentaje:2, descripcion:'Recepción de botellas plásticas no retornables PET', impuesto:'RENTA'},
  {codigo:'3440', porcentaje:3, descripcion:'Otras retenciones aplicables al 3%', impuesto:'RENTA'},
  {codigo:'344A', porcentaje:2, descripcion:'Pagos locales con tarjeta de crédito/débito reportados por emisoras y auxiliares de pago', impuesto:'RENTA'},
  {codigo:'344B', porcentaje:2, descripcion:'Adquisición de sustancias minerales dentro del territorio nacional', impuesto:'RENTA'},
  {codigo:'3482', porcentaje:5, descripcion:'Comisiones a sociedades nacionales/extranjeras residentes y establecimientos permanentes', impuesto:'RENTA'},
  {codigo:'1', porcentaje:30, descripcion:'IVA — bienes: 30% del IVA causado', impuesto:'IVA'},
  {codigo:'2', porcentaje:70, descripcion:'IVA — servicios y consultoría: 70% del IVA causado', impuesto:'IVA'},
  {codigo:'3', porcentaje:100, descripcion:'IVA — servicios profesionales de personas naturales: 100% del IVA causado', impuesto:'IVA'},
  {codigo:'7', porcentaje:0, descripcion:'IVA — retención en cero, caso especial', impuesto:'IVA'},
  {codigo:'8', porcentaje:0, descripcion:'IVA — no procede retención', impuesto:'IVA'},
  {codigo:'9', porcentaje:10, descripcion:'IVA — caso especial 10%', impuesto:'IVA'},
  {codigo:'10', porcentaje:20, descripcion:'IVA — caso especial 20%', impuesto:'IVA'},
  {codigo:'11', porcentaje:50, descripcion:'IVA — caso especial 50%', impuesto:'IVA'},
];
export function buscarRetencionSRI(codigo:string, impuesto:'RENTA'|'IVA'): RetencionCatalogo|undefined { return RETENCIONES_SRI_2026.find(x=>x.codigo===codigo && x.impuesto===impuesto); }
