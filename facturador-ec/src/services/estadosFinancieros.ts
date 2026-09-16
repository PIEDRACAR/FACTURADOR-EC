export type SaldoCuenta={id?:string;codigo:string;nombre:string;tipo:string;saldo:number;centroCostoId?:string|null;centroNombre?:string|null};
export type MovimientoFlujo={monto:number;actividad:'OPERACION'|'INVERSION'|'FINANCIAMIENTO';rubro?:string};
const money=(n:number)=>Math.round((Number(n)||0)*100)/100;

export function presentarSaldo(c:SaldoCuenta){
  // Conserva saldos contrarios: no usa Math.abs.
  return money(['PASIVO','PATRIMONIO','INGRESO'].includes(c.tipo)?-c.saldo:c.saldo);
}
export function calcularEstadoResultados(cuentas:SaldoCuenta[]){
  const ingresos=money(cuentas.filter(c=>c.tipo==='INGRESO').reduce((s,c)=>s+presentarSaldo(c),0));
  const costos=money(cuentas.filter(c=>c.tipo==='COSTO').reduce((s,c)=>s+presentarSaldo(c),0));
  const gastos=money(cuentas.filter(c=>c.tipo==='GASTO').reduce((s,c)=>s+presentarSaldo(c),0));
  const resultado=money(ingresos-costos-gastos);
  return {ingresos,costos,gastos,margenBruto:money(ingresos-costos),resultadoOperativo:resultado,resultado};
}
export function calcularEstadoSituacion(cuentas:SaldoCuenta[],resultadoCorriente:number,tolerancia=.01){
  const activos=money(cuentas.filter(c=>c.tipo==='ACTIVO').reduce((s,c)=>s+presentarSaldo(c),0));
  const pasivos=money(cuentas.filter(c=>c.tipo==='PASIVO').reduce((s,c)=>s+presentarSaldo(c),0));
  const patrimonioBase=money(cuentas.filter(c=>c.tipo==='PATRIMONIO').reduce((s,c)=>s+presentarSaldo(c),0));
  const patrimonio=money(patrimonioBase+resultadoCorriente);
  const diferencia=money(activos-pasivos-patrimonio);
  return {activos,pasivos,patrimonioBase,resultadoCorriente:money(resultadoCorriente),patrimonio,totalPasivoPatrimonio:money(pasivos+patrimonio),diferencia,cuadra:Math.abs(diferencia)<=tolerancia};
}
export function variacion(valorA:number,valorB:number){
  const absoluta=money(valorA-valorB);
  return {valorA:money(valorA),valorB:money(valorB),variacion:absoluta,variacionPorcentual:valorB===0?null:money(absoluta/valorB*100)};
}
export function calcularFlujoEfectivo(efectivoInicial:number,movimientos:MovimientoFlujo[],efectivoBalance?:number,tolerancia=.01){
  const suma=(a:MovimientoFlujo['actividad'])=>money(movimientos.filter(m=>m.actividad===a).reduce((s,m)=>s+m.monto,0));
  const operacion=suma('OPERACION'),inversion=suma('INVERSION'),financiamiento=suma('FINANCIAMIENTO');
  const variacionNeta=money(operacion+inversion+financiamiento),efectivoFinal=money(efectivoInicial+variacionNeta);
  const diferenciaBalance=efectivoBalance===undefined?null:money(efectivoFinal-efectivoBalance);
  return {efectivoInicial:money(efectivoInicial),operacion,inversion,financiamiento,variacionNeta,efectivoFinal,efectivoBalance:efectivoBalance===undefined?null:money(efectivoBalance),diferenciaBalance,reconcilia:diferenciaBalance===null?null:Math.abs(diferenciaBalance)<=tolerancia};
}
export function calcularCentrosCosto(cuentas:SaldoCuenta[]){
  const grupos=new Map<string,{centroId:string|null;centro:string;ingresos:number;costos:number;gastos:number}>();
  for(const c of cuentas){
    const key=c.centroCostoId||'SIN_ASIGNAR',g=grupos.get(key)||{centroId:c.centroCostoId||null,centro:c.centroNombre||'SIN ASIGNAR',ingresos:0,costos:0,gastos:0};
    const v=presentarSaldo(c);if(c.tipo==='INGRESO')g.ingresos+=v;else if(c.tipo==='COSTO')g.costos+=v;else if(c.tipo==='GASTO')g.gastos+=v;grupos.set(key,g);
  }
  const filas=[...grupos.values()].map(g=>({...g,ingresos:money(g.ingresos),costos:money(g.costos),gastos:money(g.gastos),resultado:money(g.ingresos-g.costos-g.gastos)}));
  const totalResultado=money(filas.reduce((s,x)=>s+x.resultado,0));
  return filas.map(x=>({...x,participacionPorcentual:totalResultado===0?null:money(x.resultado/totalResultado*100)}));
}
