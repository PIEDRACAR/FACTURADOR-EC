export type FiltrosContables={
  desde?:string;hasta?:string;periodo?:string;estado?:string;busqueda?:string;cuenta?:string;
  terceroTipo?:string;terceroId?:string;centroCostoId?:string;sucursal?:string;documento?:string;
  origenTipo?:string;page:number;pageSize:number;
};
const limpio=(v:unknown)=>String(v??'').trim().slice(0,200);
export function filtrosContables(q:any):FiltrosContables{
  const page=Math.max(1,Math.floor(Number(q?.page)||1));
  const pageSize=Math.min(500,Math.max(1,Math.floor(Number(q?.pageSize)||50)));
  const out:any={page,pageSize};
  for(const k of ['desde','hasta','periodo','estado','busqueda','cuenta','terceroTipo','terceroId','centroCostoId','sucursal','documento','origenTipo']){
    const v=limpio(q?.[k]);if(v)out[k]=v;
  }
  return out;
}
export function rangoPagina(f:FiltrosContables){const from=(f.page-1)*f.pageSize;return {from,to:from+f.pageSize-1};}
export function metadatosExportacion(f:FiltrosContables,total:number,ahora=new Date()){
  return {filtros:{...f},total,moneda:'USD',generadoAt:ahora.toISOString()};
}
export function sanitizarCelda(v:unknown){const s=String(v??'').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'').trim();return /^[=+\-@]/.test(s)?`'${s}`:s;}
export type ErrorImportacion={fila:number;campo:string;problema:string};
export function validarImportManual(filas:Array<Record<string,unknown>>,maxFilas=5000){
  const errores:ErrorImportacion[]=[];const validas:any[]=[];
  if(filas.length>maxFilas)errores.push({fila:0,campo:'archivo',problema:`Máximo ${maxFilas} filas.`});
  filas.slice(0,maxFilas).forEach((f,i)=>{
    if(Object.keys(f).some(k=>k.toLowerCase()==='emisor_id'))errores.push({fila:i+2,campo:'emisor_id',problema:'La empresa nunca puede venir del Excel.'});
    const fecha=limpio(f.fecha??f.Fecha).slice(0,10),concepto=sanitizarCelda(f.concepto??f.Concepto),referencia=sanitizarCelda(f.referencia??f.Referencia),codigo=limpio(f.codigo??f['Código']);
    const debe=Number(f.debe??f.Debe??0),haber=Number(f.haber??f.Haber??0),tipo=limpio(f.tipo??f.Tipo??'MANUAL').toUpperCase();
    if(!/^\d{4}-\d{2}-\d{2}$/.test(fecha))errores.push({fila:i+2,campo:'fecha',problema:'Use YYYY-MM-DD.'});
    if(!concepto)errores.push({fila:i+2,campo:'concepto',problema:'Obligatorio.'});
    if(!codigo)errores.push({fila:i+2,campo:'codigo',problema:'Obligatorio.'});
    if(!Number.isFinite(debe)||!Number.isFinite(haber)||debe<0||haber<0||((debe>0)===(haber>0)))errores.push({fila:i+2,campo:'debe/haber',problema:'Debe existir un único importe positivo por línea.'});
    if(!['MANUAL','AJUSTE'].includes(tipo))errores.push({fila:i+2,campo:'tipo',problema:'Solo MANUAL o AJUSTE son importables.'});
    if(fecha&&concepto&&codigo&&Number.isFinite(debe)&&Number.isFinite(haber)&&debe>=0&&haber>=0&&((debe>0)!==(haber>0))&&['MANUAL','AJUSTE'].includes(tipo))
      validas.push({fecha,concepto,referencia,codigo,debe,haber,tipo,descripcion:sanitizarCelda(f.descripcion??f['Descripción']??concepto)});
  });
  return {validas,errores};
}
export function agruparAsientosImportados(filas:any[]){
  const m=new Map<string,any[]>();for(const f of filas){const k=[f.fecha,f.tipo,f.concepto,f.referencia].join('|');if(!m.has(k))m.set(k,[]);m.get(k)!.push(f);}
  return [...m.entries()].map(([clave,lineas])=>{const [fecha,tipo,concepto,referencia]=clave.split('|');const debe=Math.round(lineas.reduce((s,x)=>s+x.debe,0)*100)/100,haber=Math.round(lineas.reduce((s,x)=>s+x.haber,0)*100)/100;return {fecha,tipo,concepto,referencia,lineas,debe,haber,valido:debe>0&&Math.abs(debe-haber)<=.009};});
}

export function aplicarFiltrosFilas(filas:Array<Record<string,any>>,f:FiltrosContables){
  const needle=(f.busqueda||'').toLocaleLowerCase('es');
  return filas.filter(row=>{
    const vals=Object.values(row).map(v=>String(v??'').toLocaleLowerCase('es'));
    if(needle&&!vals.some(v=>v.includes(needle)))return false;
    if(f.estado&&!vals.includes(f.estado.toLocaleLowerCase('es')))return false;
    if(f.documento&&!vals.some(v=>v.includes(f.documento!.toLocaleLowerCase('es'))))return false;
    if(f.origenTipo&&!vals.some(v=>v.includes(f.origenTipo!.toLocaleLowerCase('es'))))return false;
    if(f.cuenta&&!vals.some(v=>v.includes(f.cuenta!.toLocaleLowerCase('es'))))return false;
    return true;
  });
}
