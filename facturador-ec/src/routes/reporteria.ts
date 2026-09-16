import type { FastifyInstance } from 'fastify';
import { supabase } from '../db/supabase.js';
import { generarExcelDesdeFilas } from '../services/excel.js';
import { generarPdfTabla } from '../services/pdfReportes.js';
import { obtenerAnalisisCentroCosto, obtenerCambiosPatrimonio, obtenerComparativo, obtenerEstadoResultados, obtenerEstadoSituacion, obtenerFlujoEfectivo } from '../services/reporteriaContable.js';

const TIPOS=new Set(['situacion-financiera','resultados','flujo-efectivo','centros-costo','comparativo','cambios-patrimonio']);
const emisor=(req:any)=>String(req.usuarioSesion?.emisorId||'');
const err=(reply:any,e:unknown)=>reply.status(422).send({error:e instanceof Error?e.message:String(e)});
function fechas(q:any){return {desde:q?.desde?String(q.desde):undefined,hasta:q?.hasta?String(q.hasta):undefined,desdeB:q?.desdeB?String(q.desdeB):undefined,hastaB:q?.hastaB?String(q.hastaB):undefined};}
async function reporte(tipo:string,id:string,q:any){
  const f=fechas(q);
  if(tipo==='situacion-financiera')return obtenerEstadoSituacion(id,f.hasta);
  if(tipo==='resultados')return obtenerEstadoResultados(id,f.desde,f.hasta);
  if(tipo==='centros-costo')return obtenerAnalisisCentroCosto(id,f.desde,f.hasta);
  if(tipo==='comparativo'){if(!f.desde||!f.hasta||!f.desdeB||!f.hastaB)throw new Error('Comparativo requiere desde, hasta, desdeB y hastaB.');return obtenerComparativo(id,f.desde,f.hasta,f.desdeB,f.hastaB,String(q?.informe||'resultados'));}
  if(tipo==='flujo-efectivo'){if(!f.desde||!f.hasta)throw new Error('Flujo requiere desde y hasta.');return obtenerFlujoEfectivo(id,f.desde,f.hasta);}
  if(tipo==='cambios-patrimonio'){if(!f.desde||!f.hasta)throw new Error('Cambios en patrimonio requiere desde y hasta.');return obtenerCambiosPatrimonio(id,f.desde,f.hasta);}
  throw new Error('Tipo de reporte inválido.');
}
function filas(tipo:string,d:any){
  if(tipo==='situacion-financiera'||tipo==='resultados')return (d.detalle||[]).map((x:any)=>({codigo:x.codigo,cuenta:x.nombre,tipo:x.tipo,valor:x.valor}));
  if(tipo==='centros-costo')return d.centros||[];
  if(tipo==='flujo-efectivo')return [{rubro:'Efectivo inicial',valor:d.efectivoInicial},{rubro:'Operación',valor:d.operacion},{rubro:'Inversión',valor:d.inversion},{rubro:'Financiamiento',valor:d.financiamiento},{rubro:'Efectivo final',valor:d.efectivoFinal},{rubro:'Efectivo balance',valor:d.efectivoBalance}];
  if(tipo==='cambios-patrimonio')return [...(d.patrimonio||[]).map((x:any)=>({codigo:x.codigo,rubro:x.nombre,valor:x.variacion})),{codigo:'RESULTADO',rubro:'Resultado del período',valor:d.resultadoPeriodo}];
  if(tipo==='comparativo')return Object.entries(d).filter(([k,v])=>v&&typeof v==='object'&&'variacion' in (v as any)).map(([rubro,v]:any)=>({rubro,valorA:v.valorA,valorB:v.valorB,variacion:v.variacion,variacionPorcentual:v.variacionPorcentual}));
  return [];
}
export async function registrarRutasReporteria(app:FastifyInstance){
  for(const tipo of ['situacion-financiera','resultados','flujo-efectivo','centros-costo','comparativo','cambios-patrimonio']){
    app.get(`/contabilidad/reportes/${tipo}`,async(req:any,reply)=>{const id=emisor(req);if(!id)return reply.status(400).send({error:'Empresa activa no determinada.'});try{return reply.send(await reporte(tipo,id,req.query));}catch(e){return err(reply,e);}});
  }
  app.get('/contabilidad/reportes/:tipo/exportar',async(req:any,reply)=>{
    const id=emisor(req),tipo=String(req.params.tipo||''),formato=String(req.query?.formato||'excel').toLowerCase();
    if(!id)return reply.status(400).send({error:'Empresa activa no determinada.'});if(!TIPOS.has(tipo))return reply.status(400).send({error:'Tipo de reporte inválido.'});if(!['excel','pdf'].includes(formato))return reply.status(400).send({error:'Formato inválido.'});
    try{
      const d=await reporte(tipo,id,req.query),fs=filas(tipo,d),cols=Object.keys(fs[0]||{mensaje:''}).map(k=>({clave:k,etiqueta:k.replace(/([A-Z])/g,' $1').replace(/^./,x=>x.toUpperCase()),ancho:Math.max(55,Math.floor(700/Math.max(1,Object.keys(fs[0]||{}).length))),alinearDerecha:/valor|ingreso|costo|gasto|resultado|participacion/i.test(k)}));
      const eq=await supabase.from('emisores').select('razon_social,nombre_comercial,ruc,direccion_matriz').eq('id',id).single();const empresa:any=eq.data||{};
      if(formato==='excel'){const b=await generarExcelDesdeFilas(`Reporte ${tipo}`,cols.map(c=>({clave:c.clave,etiqueta:c.etiqueta})),fs.length?fs:[{mensaje:'Sin datos'}]);reply.header('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').header('Content-Disposition',`attachment; filename="${tipo}.xlsx"`);return reply.send(b);}
      const pdf=await generarPdfTabla({titulo:`Reporte · ${tipo}`,subtitulo:`Período: ${req.query?.desde||'inicio'} a ${req.query?.hasta||'actual'} · Moneda USD · Generado ${new Date().toISOString()}`,columnas:cols,filas:fs.length?fs:[{mensaje:'Sin datos'}],empresa:{razonSocial:empresa.razon_social,nombreComercial:empresa.nombre_comercial,ruc:empresa.ruc,direccion:empresa.direccion_matriz}});
      reply.header('Content-Type','application/pdf').header('Content-Disposition',`inline; filename="${tipo}.pdf"`);return reply.send(pdf);
    }catch(e){return err(reply,e);}
  });
}
