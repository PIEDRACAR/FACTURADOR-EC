export type ParametroNomina={codigo:string;valor:number;tipo:string;vigenciaDesde:string;vigenciaHasta?:string|null;fuente?:string|null;observacion?:string|null;emisorId?:string|null};
export type NovedadCalculo={idempotenciaClave?:string;tipo:string;valor:number;cantidad?:number;afectaIess?:boolean;codigo?:string;descripcion?:string;centroCostoId?:string|null};
export type EmpleadoCalculo={id:string;sueldoBase:number;fechaIngreso:string;fechaSalida?:string|null;iessBase?:number|null;acumulaDecimoTercero?:boolean;acumulaDecimoCuarto?:boolean;fondoReservaMensual?:boolean};
export type LineaNomina={codigo:string;debe:number;haber:number;descripcion?:string;empleadoId?:string|null;centroCostoId?:string|null};

const money=(n:number)=>Math.round((Number(n)||0)*100)/100;
const fechaPeriodo=(periodo:string,fin=false)=>{if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodo))throw new Error('Periodo invalido.');const [y,m]=periodo.split('-').map(Number);return fin?new Date(Date.UTC(y,m,0)):new Date(Date.UTC(y,m-1,1));};
const iso=(d:Date)=>d.toISOString().slice(0,10);

export function parametrosVigentes(lista:ParametroNomina[],periodo:string){
  const fecha=iso(fechaPeriodo(periodo,true));const out:Record<string,ParametroNomina>={};
  for(const p of lista){if(p.vigenciaDesde<=fecha&&(!p.vigenciaHasta||p.vigenciaHasta>=fecha)){if(out[p.codigo])throw new Error(`Parametro ambiguo para ${p.codigo}.`);out[p.codigo]={...p};}}
  return out;
}

export function validarNovedades(novedades:NovedadCalculo[]){const claves=new Set<string>();for(const n of novedades){if(!Number.isFinite(Number(n.valor))||Number(n.valor)<0)throw new Error(`Valor negativo o invalido en novedad ${n.tipo}.`);if(n.idempotenciaClave){if(claves.has(n.idempotenciaClave))throw new Error(`Novedad duplicada: ${n.idempotenciaClave}.`);claves.add(n.idempotenciaClave);}}return novedades;}
const requerido=(p:Record<string,ParametroNomina>,codigo:string)=>{const x=p[codigo];if(!x||!Number.isFinite(Number(x.valor)))throw new Error(`Falta parametro vigente ${codigo}.`);return Number(x.valor);};
const diasEnPeriodo=(e:EmpleadoCalculo,periodo:string)=>{const ini=fechaPeriodo(periodo),fin=fechaPeriodo(periodo,true),alta=new Date(`${e.fechaIngreso}T00:00:00Z`),baja=e.fechaSalida?new Date(`${e.fechaSalida}T00:00:00Z`):fin;if(alta>fin||baja<ini)return 0;const desde=alta>ini?alta:ini,hasta=baja<fin?baja:fin;return Math.max(0,Math.round((hasta.getTime()-desde.getTime())/86400000)+1);};

export function calcularRolEmpleado(e:EmpleadoCalculo,periodo:string,parametros:ParametroNomina[],novedades:NovedadCalculo[]){
  validarNovedades(novedades);const p=parametrosVigentes(parametros,periodo),diasPeriodo=fechaPeriodo(periodo,true).getUTCDate(),diasPagados=diasEnPeriodo(e,periodo);
  const sueldo=money(Number(e.sueldoBase)*diasPagados/diasPeriodo);
  const ingreso=novedades.filter(n=>n.tipo==='INGRESO'||n.tipo==='BONO'||n.tipo==='COMISION'||n.tipo==='HORA_EXTRA').reduce((s,n)=>s+Number(n.valor),0);
  const descuento=novedades.filter(n=>n.tipo==='DESCUENTO'||n.tipo==='FALTA'||n.tipo==='ANTICIPO'||n.tipo==='PRESTAMO').reduce((s,n)=>s+Number(n.valor),0);
  const baseVariable=novedades.filter(n=>n.afectaIess).reduce((s,n)=>s+Number(n.valor),0),iessBase=money((e.iessBase?Number(e.iessBase)*diasPagados/diasPeriodo:sueldo)+baseVariable);
  const iessPersonal=money(iessBase*requerido(p,'IESS_PERSONAL_PCT')/100),iessPatronal=money(iessBase*requerido(p,'IESS_PATRONAL_PCT')/100);
  const d13=money((sueldo+ingreso)/requerido(p,'FACTOR_DECIMO_TERCERO')),d14=money(requerido(p,'SBU')/requerido(p,'FACTOR_DECIMO_CUARTO')*diasPagados/diasPeriodo),vac=money((sueldo+ingreso)/requerido(p,'FACTOR_VACACIONES'));
  const meses=Math.floor((fechaPeriodo(periodo,true).getTime()-new Date(`${e.fechaIngreso}T00:00:00Z`).getTime())/(365.25/12*86400000)),fr=meses>=requerido(p,'MESES_FONDO_RESERVA')?money((sueldo+ingreso)/requerido(p,'FACTOR_FONDO_RESERVA')):0;
  const d13Pagado=e.acumulaDecimoTercero?0:d13,d14Pagado=e.acumulaDecimoCuarto?0:d14,frPagado=e.fondoReservaMensual?fr:0;
  const neto=money(sueldo+ingreso+d13Pagado+d14Pagado+frPagado-iessPersonal-descuento),provisiones=money(d13+d14+vac+fr),costo=money(sueldo+ingreso+iessPatronal+provisiones);
  return {empleadoId:e.id,diasPagados,sueldo,otrosIngresos:money(ingreso),otrasDeducciones:money(descuento),iessBase,iessPersonal,iessPatronal,decimoTercero:d13,decimoCuarto:d14,vacaciones:vac,fondoReserva:fr,beneficiosAcumulados:money((d13-d13Pagado)+(d14-d14Pagado)+(fr-frPagado)+vac),netoPagar:neto,costoEmpleador:costo,parametrosSnapshot:p,novedadesSnapshot:novedades.map(x=>({...x}))};
}

const FLUJO:Record<string,string[]>={BORRADOR:['CALCULADO'],CALCULADO:['BORRADOR','REVISADO'],REVISADO:['CALCULADO','APROBADO'],APROBADO:['CONTABILIZADO'],CONTABILIZADO:['PAGADO'],PAGADO:['CERRADO'],CERRADO:[]};
export function estadoSiguientePermitido(actual:string,siguiente:string){return (FLUJO[actual]||[]).includes(siguiente);}
export function construirAsientoNomina(lineas:LineaNomina[]){const limpias=lineas.filter(x=>money(x.debe)>0||money(x.haber)>0).map(x=>({...x,debe:money(x.debe),haber:money(x.haber)}));for(const x of limpias)if(x.debe<0||x.haber<0||(x.debe>0&&x.haber>0))throw new Error('Linea contable invalida.');const d=money(limpias.reduce((s,x)=>s+x.debe,0)),h=money(limpias.reduce((s,x)=>s+x.haber,0));if(d<=0||Math.abs(d-h)>.009)throw new Error(`Asiento de nomina descuadrado: ${d}/${h}.`);return limpias;}
export function construirAsientoPagoNomina(monto:number,pasivoCodigo:string,medioCodigo:string):LineaNomina[]{const v=money(monto);if(v<=0)throw new Error('Monto de pago invalido.');return [{codigo:pasivoCodigo,debe:v,haber:0,descripcion:'Cancelacion de nomina'},{codigo:medioCodigo,debe:0,haber:v,descripcion:'Pago de nomina'}];}
export function resumirPagos(total:number,pagos:number[]){const t=money(total),pagado=money(pagos.reduce((s,x)=>s+Number(x||0),0));if(pagado>t+.009)throw new Error('El pago excede el saldo pendiente.');const pendiente=money(Math.max(0,t-pagado));return {total:t,pagado,pendiente,estado:pendiente===0?'PAGADO':'CONTABILIZADO'};}
