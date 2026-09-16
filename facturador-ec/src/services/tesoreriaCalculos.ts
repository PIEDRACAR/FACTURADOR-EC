import { validarLineasContables } from './contabilidadCalculos.js';
const money=(n:number)=>Math.round(Number(n)*100)/100;
export type LineaTesoreria={codigo:string;debe:number;haber:number;descripcion?:string};
export function construirTransferencia(origen:{codigo:string},destino:{codigo:string},monto:number,concepto='Transferencia interna'):LineaTesoreria[]{
 const valor=money(monto);if(!Number.isFinite(valor)||valor<=0)throw new Error('El monto debe ser mayor a cero.');if(origen.codigo===destino.codigo)throw new Error('La cuenta de origen y destino deben ser diferentes.');
 const lineas=[{codigo:destino.codigo,debe:valor,haber:0,descripcion:concepto},{codigo:origen.codigo,debe:0,haber:valor,descripcion:concepto}];validarLineasContables(lineas);return lineas;
}
