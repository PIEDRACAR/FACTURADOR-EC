import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

const METODOS_SEGUROS = new Set(['GET','HEAD','OPTIONS']);
const RUTAS_EXTERNAS = new Set(['/pagos/payphone/NotificacionPago','/pagos/payphone/notificacion']);

export function origenMismoSitio(requestUrl:string, host:string, origin?:string, referer?:string): boolean {
  const fuente=origin||referer;
  if (!fuente) return true;
  try {
    const url=new URL(fuente);
    return url.host.toLowerCase()===host.toLowerCase() && ['http:','https:'].includes(url.protocol) && Boolean(requestUrl);
  } catch { return false; }
}

export function solicitudMutableConfiable(headers:Record<string,unknown>, requestUrl:string, host:string): boolean {
  const fetchSite=String(headers['sec-fetch-site']??'').toLowerCase();
  if (fetchSite==='cross-site') return false;
  const origin=typeof headers.origin==='string'?headers.origin:undefined;
  const referer=typeof headers.referer==='string'?headers.referer:undefined;
  if (origin||referer) return origenMismoSitio(requestUrl,host,origin,referer);
  return String(headers['x-requested-with']??'').toLowerCase()==='xmlhttprequest' && (!fetchSite||fetchSite==='same-origin'||fetchSite==='same-site'||fetchSite==='none');
}

export function registrarProteccionCsrf(app:FastifyInstance): void {
  app.addHook('preHandler',async(request:FastifyRequest,reply:FastifyReply)=>{
    if (METODOS_SEGUROS.has(request.method)) return;
    const ruta=request.routeOptions?.url??request.url.split('?')[0];
    if (RUTAS_EXTERNAS.has(ruta)) return;
    const host=String(request.headers['x-forwarded-host']??request.headers.host??'').split(',')[0].trim();
    if (!host || !solicitudMutableConfiable(request.headers as Record<string,unknown>,request.url,host)) {
      return reply.status(403).send({error:'Solicitud rechazada por protección CSRF.'});
    }
  });
}
