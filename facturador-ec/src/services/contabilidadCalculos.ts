export type NaturalezaContable = 'DEUDORA' | 'ACREEDORA' | string;

export interface MovimientoContable {
  cuentaId: string;
  codigo: string;
  nombre: string;
  tipo: string;
  naturaleza: NaturalezaContable;
  fecha: string;
  debe: number;
  haber: number;
  asientoId?: string;
  numeroAsiento?: number | string | null;
  tipoDiario?: string | null;
  concepto?: string | null;
  referencia?: string | null;
  origenTipo?: string | null;
  origenId?: string | null;
  terceroTipo?: string | null;
  terceroId?: string | null;
}

export interface FiltrosContables {
  desde?: string;
  hasta?: string;
  cuentaId?: string;
  codigo?: string;
  terceroTipo?: string;
  terceroId?: string;
}

export interface CuentaPlanResumen {
  id: string;
  codigo: string;
  nombre: string;
  tipo: string;
  naturaleza: NaturalezaContable;
  nivel?: number;
  cuentaPadreId?: string | null;
  aceptaMovimientos?: boolean;
}

const money=(valor:number)=>Math.round((Number(valor)||0)*100)/100;

export async function paginarResultados<T>(
  cargar:(desde:number,hasta:number)=>PromiseLike<{data:T[]|null;error:any}>,
  tamanoPagina=1000,
){
  if(!Number.isInteger(tamanoPagina)||tamanoPagina<=0)throw new Error('El tamaño de página debe ser un entero positivo.');
  const filas:T[]=[];
  for(let desde=0;;desde+=tamanoPagina){
    const resultado=await cargar(desde,desde+tamanoPagina-1);
    if(resultado.error)return {data:filas,error:resultado.error};
    const pagina=resultado.data||[];filas.push(...pagina);
    if(pagina.length<tamanoPagina)return {data:filas,error:null};
  }
}

export function validarVinculoOpcional(tipo:unknown,id:unknown,nombre='vinculo'){
  const tieneTipo=String(tipo??'').trim()!=='';
  const tieneId=String(id??'').trim()!=='';
  if(tieneTipo!==tieneId) throw new Error(`${nombre}: tipo e ID deben venir juntos.`);
  return tieneTipo&&tieneId;
}

export function puedeEditarAsiento(tipo:unknown,origenTipo:unknown,origenId:unknown){
  const manual=['MANUAL','AJUSTE'].includes(String(tipo??'').trim().toUpperCase());
  return manual&&!validarVinculoOpcional(origenTipo,origenId,'origen contable');
}

export function validarAsientoReversible(asiento:{tipo?:unknown;reversaDeId?:unknown}){
  if(String(asiento.tipo??'').trim().toUpperCase()==='REVERSO'||String(asiento.reversaDeId??'').trim()!==''){
    throw new Error('Un asiento de reverso no puede volver a revertirse.');
  }
  return true;
}

export function validarLineasContables(lineas:Array<{codigo?:string;debe?:number;haber?:number}>){
  if(!lineas.length) throw new Error('El asiento no contiene lineas.');
  let debe=0,haber=0;
  for(const linea of lineas){
    if(!String(linea.codigo||'').trim()) throw new Error('Cada linea requiere una cuenta contable.');
    const d=money(Number(linea.debe||0)),h=money(Number(linea.haber||0));
    if(d<0||h<0||(d>0&&h>0)) throw new Error(`Linea contable invalida: ${linea.codigo}.`);
    debe=money(debe+d);haber=money(haber+h);
  }
  const diferencia=money(debe-haber);
  if(debe<=0||Math.abs(diferencia)>0.01) throw new Error(`El asiento no cuadra. Debe ${debe.toFixed(2)} / Haber ${haber.toFixed(2)}.`);
  return {debe,haber,diferencia};
}

function numerosIguales(a:number,b:number){return Math.abs(money(a-b))<=0.01;}

export function verificarConsistenciaMayorBalance(
  cuentasMayor:Array<{cuentaId:string;saldoInicial:number;debitosPeriodo:number;creditosPeriodo:number;saldoFinal:number}>,
  cuentasBalance:Array<{cuentaId:string;esGrupo?:boolean;saldoInicial:number;debitosPeriodo:number;creditosPeriodo:number;saldoFinal:number}>,
){
  const movimientoBalance=new Map(cuentasBalance.filter(x=>!x.esGrupo).map(x=>[x.cuentaId,x]));
  if(cuentasMayor.length!==movimientoBalance.size)return false;
  for(const mayor of cuentasMayor){
    const balance=movimientoBalance.get(mayor.cuentaId);
    if(!balance||!numerosIguales(mayor.saldoInicial,balance.saldoInicial)||!numerosIguales(mayor.debitosPeriodo,balance.debitosPeriodo)||!numerosIguales(mayor.creditosPeriodo,balance.creditosPeriodo)||!numerosIguales(mayor.saldoFinal,balance.saldoFinal))return false;
  }
  const suma=(filas:any[],campo:string)=>money(filas.reduce((total,fila)=>total+Number(fila[campo]||0),0));
  const hojas=[...movimientoBalance.values()];
  return ['saldoInicial','debitosPeriodo','creditosPeriodo','saldoFinal'].every(campo=>numerosIguales(suma(cuentasMayor,campo),suma(hojas,campo)));
}

export function validarNaturalezaCuenta(naturaleza:NaturalezaContable,saldo:number){
  if(Math.abs(saldo)<0.005)return true;
  return String(naturaleza).toUpperCase()==='ACREEDORA'?saldo<0:saldo>0;
}

function coincide(m:MovimientoContable,f:FiltrosContables){
  if(f.cuentaId&&m.cuentaId!==f.cuentaId)return false;
  if(f.codigo&&m.codigo!==f.codigo)return false;
  if(f.terceroTipo&&String(m.terceroTipo||'').toUpperCase()!==f.terceroTipo.toUpperCase())return false;
  if(f.terceroId&&m.terceroId!==f.terceroId)return false;
  return true;
}

export function construirMayor(movimientos:MovimientoContable[],filtros:FiltrosContables={}){
  const candidatos=movimientos.filter(m=>coincide(m,filtros)&&(!filtros.hasta||m.fecha<=filtros.hasta));
  const porCuenta=new Map<string,MovimientoContable[]>();
  for(const m of candidatos){const lista=porCuenta.get(m.cuentaId)||[];lista.push(m);porCuenta.set(m.cuentaId,lista);}
  const cuentas=Array.from(porCuenta.values()).map(lista=>{
    lista.sort((a,b)=>a.fecha.localeCompare(b.fecha)||String(a.asientoId||'').localeCompare(String(b.asientoId||'')));
    const base=lista[0];
    const anteriores=filtros.desde?lista.filter(m=>m.fecha<filtros.desde!):[];
    const periodo=lista.filter(m=>(!filtros.desde||m.fecha>=filtros.desde)&&(!filtros.hasta||m.fecha<=filtros.hasta));
    const saldoInicial=money(anteriores.reduce((s,m)=>s+Number(m.debe||0)-Number(m.haber||0),0));
    let saldo=saldoInicial;
    const detalle=periodo.map(m=>{saldo=money(saldo+Number(m.debe||0)-Number(m.haber||0));return {...m,debe:money(m.debe),haber:money(m.haber),saldoAcumulado:saldo};});
    const debitosPeriodo=money(periodo.reduce((s,m)=>s+Number(m.debe||0),0));
    const creditosPeriodo=money(periodo.reduce((s,m)=>s+Number(m.haber||0),0));
    return {cuentaId:base.cuentaId,codigo:base.codigo,nombre:base.nombre,tipo:base.tipo,naturaleza:base.naturaleza,saldoInicial,debitosPeriodo,creditosPeriodo,saldoFinal:money(saldoInicial+debitosPeriodo-creditosPeriodo),movimientos:detalle};
  }).sort((a,b)=>a.codigo.localeCompare(b.codigo,undefined,{numeric:true}));
  return {cuentas,movimientos:cuentas.flatMap(c=>c.movimientos.map(m=>({...m,saldoInicialCuenta:c.saldoInicial,saldoFinalCuenta:c.saldoFinal})))};
}

export function agruparBalanza(movimientos:MovimientoContable[],filtros:FiltrosContables={},plan:CuentaPlanResumen[]=[]){
  const mayor=construirMayor(movimientos,filtros);
  const padreDe=(cuenta:CuentaPlanResumen)=>cuenta.cuentaPadreId||plan
    .filter(p=>(p.nivel||0)===(cuenta.nivel||1)-1&&cuenta.codigo.startsWith(p.codigo))
    .sort((a,b)=>b.codigo.length-a.codigo.length)[0]?.id||null;
  const hojas=new Map(mayor.cuentas.map(c=>{const pc=plan.find(p=>p.id===c.cuentaId);return [c.cuentaId,{...c,saldoDeudor:money(Math.max(c.saldoFinal,0)),saldoAcreedor:money(Math.max(-c.saldoFinal,0)),saldoContrario:!validarNaturalezaCuenta(c.naturaleza,c.saldoFinal),esGrupo:false,nivel:pc?.nivel??4,cuentaPadreId:pc?padreDe(pc):null}]}));
  const filas:any[]=[...hojas.values()];
  if(plan.length){
    const padres=plan.filter(p=>p.aceptaMovimientos===false||plan.some(x=>x.cuentaPadreId===p.id)).sort((a,b)=>(b.nivel||0)-(a.nivel||0));
    for(const p of padres){
      const hijos=filas.filter(x=>x.cuentaPadreId===p.id);
      if(!hijos.length)continue;
      const suma=(k:string)=>money(hijos.reduce((s,x)=>s+Number(x[k]||0),0));
      filas.push({cuentaId:p.id,codigo:p.codigo,nombre:p.nombre,tipo:p.tipo,naturaleza:p.naturaleza,nivel:p.nivel||1,cuentaPadreId:padreDe(p),esGrupo:true,saldoInicial:suma('saldoInicial'),debitosPeriodo:suma('debitosPeriodo'),creditosPeriodo:suma('creditosPeriodo'),saldoFinal:suma('saldoFinal'),saldoDeudor:suma('saldoDeudor'),saldoAcreedor:suma('saldoAcreedor'),saldoContrario:false,movimientos:[]});
    }
  }
  filas.sort((a,b)=>a.codigo.localeCompare(b.codigo,undefined,{numeric:true}));
  const baseTotales=[...hojas.values()];
  const totales={
    saldoInicialDeudor:money(baseTotales.reduce((s,x)=>s+Math.max(x.saldoInicial,0),0)),
    saldoInicialAcreedor:money(baseTotales.reduce((s,x)=>s+Math.max(-x.saldoInicial,0),0)),
    debitosPeriodo:money(baseTotales.reduce((s,x)=>s+x.debitosPeriodo,0)),
    creditosPeriodo:money(baseTotales.reduce((s,x)=>s+x.creditosPeriodo,0)),
    saldoDeudor:money(baseTotales.reduce((s,x)=>s+x.saldoDeudor,0)),
    saldoAcreedor:money(baseTotales.reduce((s,x)=>s+x.saldoAcreedor,0)),
  };
  const consistenteConMayor=verificarConsistenciaMayorBalance(mayor.cuentas,filas);
  return {cuentas:filas,totales,cuadrado:Math.abs(money(totales.debitosPeriodo-totales.creditosPeriodo))<=0.01,consistenteConMayor};
}
