import type { FastifyInstance } from 'fastify';
import { supabase } from '../db/supabase.js';

function limpiar(v: string) {
  return String(v ?? '').trim().replace(/[^0-9A-Za-zÁÉÍÓÚÜÑáéíóúüñ ._\-]/g, '').slice(0, 80);
}

export async function registrarRutaBusquedaGlobal(app: FastifyInstance) {
  app.get<{ Querystring: { emisorId?: string; q?: string } }>('/buscar-global', async (request, reply) => {
    const emisorId = String(request.query.emisorId ?? '').trim();
    const q = limpiar(request.query.q ?? '');
    if (!emisorId) return reply.status(400).send({ error: 'Falta el parámetro emisorId.' });
    if (q.length < 2) return reply.send({ facturas: [], clientes: [], productos: [] });

    const patron = `%${q}%`;
    const [facturasR, clientesR, productosR] = await Promise.all([
      supabase.from('comprobantes')
        .select('id,secuencial,importe_total,created_at,clientes(razon_social,identificacion)')
        .eq('emisor_id', emisorId).eq('estado', 'autorizado')
        .or(`secuencial.ilike.${patron},clave_acceso.ilike.${patron},numero_autorizacion.ilike.${patron}`)
        .order('created_at', { ascending: false }).limit(10),
      supabase.from('clientes')
        .select('id,identificacion,razon_social,email')
        .eq('emisor_id', emisorId)
        .or(`identificacion.ilike.${patron},razon_social.ilike.${patron},email.ilike.${patron}`)
        .order('razon_social', { ascending: true }).limit(10),
      supabase.from('productos')
        .select('id,codigo_principal,descripcion,precio_venta')
        .eq('emisor_id', emisorId)
        .or(`codigo_principal.ilike.${patron},descripcion.ilike.${patron}`)
        .order('descripcion', { ascending: true }).limit(10),
    ]);
    const error = facturasR.error || clientesR.error || productosR.error;
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({
      facturas: (facturasR.data ?? []).map((x: any) => ({ id:x.id, secuencial:x.secuencial, numero:x.secuencial, total:Number(x.importe_total||0), fecha:x.created_at, cliente:x.clientes?.razon_social || x.clientes?.identificacion || '' })),
      clientes: clientesR.data ?? [],
      productos: productosR.data ?? [],
    });
  });
}
