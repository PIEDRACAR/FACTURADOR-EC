import type { FastifyInstance } from 'fastify';
import { supabase } from '../db/supabase.js';

const RUC_RE = /^\d{13}$/;

export async function registrarRutasConfiguracion(app: FastifyInstance) {
  app.get<{ Querystring: { emisorId?: string } }>('/configuracion/datos', async (request, reply) => {
    const emisorId = request.query.emisorId;
    if (!emisorId) return reply.status(400).send({ error: 'Falta emisorId.' });
    const [{ data: emisor }, { data: config }, { data: usuarios }] = await Promise.all([
      supabase.from('emisores').select('id,ruc,razon_social,nombre_comercial,direccion_matriz,ambiente,obligado_contabilidad').eq('id', emisorId).single(),
      supabase.from('configuracion_sistema').select('*').eq('emisor_id', emisorId).maybeSingle(),
      supabase.from('usuarios_emisor').select('user_id,rol').eq('emisor_id', emisorId),
    ]);
    return reply.send({ emisor, config, usuarios: usuarios ?? [] });
  });

  app.patch<{ Body: { emisorId?: string; nombreComercial?: string; razonSocial?: string; direccionMatriz?: string; ambiente?: 'pruebas'|'produccion'; obligadoContabilidad?: boolean; rucProveedorFacturacion?: string; nombreProveedorFacturacion?: string; incluirRucProveedor?: boolean; notificacionesActivas?: boolean } }>('/configuracion/guardar', async (request, reply) => {
    const b = request.body ?? {};
    if (!b.emisorId) return reply.status(400).send({ error: 'Falta emisorId.' });
    if (b.rucProveedorFacturacion && !RUC_RE.test(b.rucProveedorFacturacion)) return reply.status(400).send({ error: 'El RUC del proveedor de facturación debe tener 13 dígitos.' });
    const cambios: Record<string, unknown> = {};
    if (b.nombreComercial !== undefined) cambios.nombre_comercial = b.nombreComercial.trim() || null;
    if (b.razonSocial !== undefined) cambios.razon_social = b.razonSocial.trim();
    if (b.direccionMatriz !== undefined) cambios.direccion_matriz = b.direccionMatriz.trim();
    if (b.ambiente !== undefined) cambios.ambiente = b.ambiente;
    if (b.obligadoContabilidad !== undefined) cambios.obligado_contabilidad = b.obligadoContabilidad;
    if (Object.keys(cambios).length) {
      const { error } = await supabase.from('emisores').update(cambios).eq('id', b.emisorId);
      if (error) return reply.status(500).send({ error: error.message });
    }
    const config = {
      emisor_id: b.emisorId,
      ruc_proveedor_facturacion: b.rucProveedorFacturacion || null,
      nombre_proveedor_facturacion: b.nombreProveedorFacturacion?.trim() || null,
      incluir_ruc_proveedor: true,
      notificaciones_activas: b.notificacionesActivas ?? true,
    };
    const { error: e2 } = await supabase.from('configuracion_sistema').upsert(config, { onConflict: 'emisor_id' });
    if (e2) return reply.status(500).send({ error: e2.message });
    return reply.send({ ok: true });
  });

  app.get<{ Querystring: { emisorId?: string } }>('/notificaciones', async (request, reply) => {
    const emisorId = request.query.emisorId;
    if (!emisorId) return reply.status(400).send({ error: 'Falta emisorId.' });
    const [stock, rechazados, correos] = await Promise.all([
      supabase.from('productos').select('id,nombre,stock_actual,stock_critico,stock_minimo').eq('emisor_id', emisorId).eq('activo', true),
      supabase.from('comprobantes').select('id,secuencial,motivo_error,created_at').eq('emisor_id', emisorId).eq('estado','rechazado').order('created_at',{ascending:false}).limit(10),
      supabase.from('email_envios').select('id,comprobante_id,destinatario,detalle,created_at').eq('estado','error').order('created_at',{ascending:false}).limit(10),
    ]);
    const items: Array<{tipo:string;prioridad:string;titulo:string;detalle:string;fecha?:string}> = [];
    for (const p of stock.data ?? []) {
      const actual=Number(p.stock_actual??0), crit=Number(p.stock_critico??0), min=Number(p.stock_minimo??0);
      if (actual<=crit) items.push({tipo:'inventario',prioridad:'alta',titulo:`STOP: ${p.nombre}`,detalle:`Stock ${actual}. Nivel crítico ${crit}.`});
      else if (actual<=min) items.push({tipo:'inventario',prioridad:'media',titulo:`Stock bajo: ${p.nombre}`,detalle:`Stock ${actual}. Mínimo ${min}.`});
    }
    for (const r of rechazados.data ?? []) items.push({tipo:'sri',prioridad:'alta',titulo:`Comprobante rechazado ${r.secuencial??''}`.trim(),detalle:r.motivo_error??'Revisar respuesta del SRI.',fecha:r.created_at});
    for (const e of correos.data ?? []) items.push({tipo:'correo',prioridad:'media',titulo:'Correo no enviado',detalle:e.detalle??`No se pudo enviar a ${e.destinatario}.`,fecha:e.created_at});
    return reply.send({ items: items.slice(0,30), total: items.length });
  });
}
