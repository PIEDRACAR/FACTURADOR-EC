import type { FastifyInstance } from 'fastify';
import { supabase } from '../db/supabase.js';
import { obtenerSesion, obtenerRolEnNegocio } from '../auth/sesiones.js';

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

  app.patch<{ Body: { emisorId?: string; nombreComercial?: string; razonSocial?: string; direccionMatriz?: string; ambiente?: 'pruebas'|'produccion'; obligadoContabilidad?: boolean; notificacionesActivas?: boolean } }>('/configuracion/guardar', async (request, reply) => {
    const b = request.body ?? {};
    if (!b.emisorId) return reply.status(400).send({ error: 'Falta emisorId.' });
    // El proveedor del sistema es una configuración central protegida. Nunca se acepta desde el navegador.
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
    const { data: existente } = await supabase.from('configuracion_sistema').select('ruc_proveedor_facturacion,nombre_proveedor_facturacion').eq('emisor_id', b.emisorId).maybeSingle();
    const config = {
      emisor_id: b.emisorId,
      // Se conserva el valor histórico, pero el usuario no puede modificarlo desde Configuración.
      ruc_proveedor_facturacion: existente?.ruc_proveedor_facturacion ?? process.env.RUC_PROVEEDOR_FACTURACION ?? null,
      nombre_proveedor_facturacion: existente?.nombre_proveedor_facturacion ?? process.env.NOMBRE_PROVEEDOR_FACTURACION ?? 'Proveedor del sistema de facturación',
      incluir_ruc_proveedor: true,
      notificaciones_activas: b.notificacionesActivas ?? true,
    };
    const { error: e2 } = await supabase.from('configuracion_sistema').upsert(config, { onConflict: 'emisor_id' });
    if (e2) return reply.status(500).send({ error: e2.message });
    return reply.send({ ok: true });
  });

  // Establecimientos operativos del emisor. Esto administra la configuración interna;
  // el alta legal del establecimiento en el RUC sigue correspondiendo al SRI.
  app.get<{ Querystring: { emisorId?: string } }>('/configuracion/establecimientos', async (request, reply) => {
    const emisorId = request.query.emisorId;
    if (!emisorId) return reply.status(400).send({ error: 'Falta emisorId.' });
    const { data, error } = await supabase.from('establecimientos_emisor').select('*').eq('emisor_id', emisorId).order('codigo');
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({ items: data ?? [] });
  });

  app.post<{ Body: { emisorId?: string; codigo?: string; nombreComercial?: string; direccion?: string } }>('/configuracion/establecimientos', async (request, reply) => {
    const b = request.body ?? {}; const codigo = String(b.codigo ?? '').replace(/\D/g, '').padStart(3, '0');
    if (!b.emisorId || !/^\d{3}$/.test(codigo) || !String(b.direccion ?? '').trim()) return reply.status(400).send({ error: 'Código de establecimiento de 3 dígitos y dirección son obligatorios.' });
    const { data, error } = await supabase.from('establecimientos_emisor').insert({ emisor_id: b.emisorId, codigo, nombre_comercial: String(b.nombreComercial ?? '').trim() || null, direccion: String(b.direccion).trim(), activo: true }).select('*').single();
    if (error || !data) return reply.status(500).send({ error: error?.message ?? 'No se pudo crear el establecimiento.' });
    return reply.status(201).send(data);
  });

  app.patch<{ Params: { id: string }; Body: { nombreComercial?: string; direccion?: string; activo?: boolean } }>('/configuracion/establecimientos/:id', async (request, reply) => {
    const b=request.body??{}; const cambios:Record<string,unknown>={};
    if (b.nombreComercial !== undefined) cambios.nombre_comercial=String(b.nombreComercial).trim()||null;
    if (b.direccion !== undefined) cambios.direccion=String(b.direccion).trim();
    if (b.activo !== undefined) cambios.activo=!!b.activo;
    if (!Object.keys(cambios).length) return reply.status(400).send({error:'No se enviaron cambios.'});
    const {error}=await supabase.from('establecimientos_emisor').update(cambios).eq('id',request.params.id);
    if(error)return reply.status(500).send({error:error.message});
    return reply.send({ok:true});
  });

  app.get<{ Querystring: { emisorId?: string; establecimiento?: string } }>('/configuracion/puntos-emision', async (request, reply) => {
    const { emisorId, establecimiento }=request.query; if(!emisorId)return reply.status(400).send({error:'Falta emisorId.'});
    let q=supabase.from('puntos_emision').select('*').eq('emisor_id',emisorId).order('establecimiento').order('punto_emision');
    if(establecimiento)q=q.eq('establecimiento',establecimiento);
    const {data,error}=await q; if(error)return reply.status(500).send({error:error.message}); return reply.send({items:data??[]});
  });

  app.post<{ Body: { emisorId?: string; establecimiento?: string; puntoEmision?: string; direccion?: string } }>('/configuracion/puntos-emision', async (request, reply) => {
    const b=request.body??{}; const establecimiento=String(b.establecimiento??'').replace(/\D/g,'').padStart(3,'0'); const puntoEmision=String(b.puntoEmision??'').replace(/\D/g,'').padStart(3,'0');
    if(!b.emisorId||!/^\d{3}$/.test(establecimiento)||!/^\d{3}$/.test(puntoEmision))return reply.status(400).send({error:'Establecimiento y punto de emisión deben tener 3 dígitos.'});
    const {data:est}=await supabase.from('establecimientos_emisor').select('direccion,activo').eq('emisor_id',b.emisorId).eq('codigo',establecimiento).maybeSingle();
    if(!est)return reply.status(400).send({error:'Primero registra el establecimiento en Configuración.'});
    if(est.activo===false)return reply.status(400).send({error:'El establecimiento está inactivo.'});
    // Los puntos pueden permanecer activos simultáneamente: distintos cajeros
    // pueden trabajar en paralelo y cada punto conserva su numeración independiente.
    const {data,error}=await supabase.from('puntos_emision').insert({emisor_id:b.emisorId,establecimiento,punto_emision:puntoEmision,direccion:String(b.direccion??est.direccion).trim(),activo:true}).select('*').single();
    if(error||!data)return reply.status(500).send({error:error?.message??'No se pudo crear el punto de emisión.'});
    return reply.status(201).send(data);
  });

  app.patch<{ Params: { id: string }; Body: { direccion?: string; activo?: boolean } }>('/configuracion/puntos-emision/:id', async (request, reply) => {
    const b=request.body??{}; const {data:punto}=await supabase.from('puntos_emision').select('id,emisor_id,establecimiento').eq('id',request.params.id).maybeSingle();
    if(!punto)return reply.status(404).send({error:'Punto de emisión no encontrado.'});
    // NO se desactivan los demás puntos al activar este.
    // Todos los puntos autorizados pueden estar activos al mismo tiempo.
    const cambios:Record<string,unknown>={}; if(b.direccion!==undefined)cambios.direccion=String(b.direccion).trim(); if(b.activo!==undefined)cambios.activo=!!b.activo;
    const {error}=await supabase.from('puntos_emision').update(cambios).eq('id',request.params.id); if(error)return reply.status(500).send({error:error.message});
    return reply.send({ok:true});
  });

  app.get<{ Querystring: { emisorId?: string } }>('/notificaciones', async (request, reply) => {
    const emisorId = request.query.emisorId;
    if (!emisorId) return reply.status(400).send({ error: 'Falta emisorId.' });
    const token = request.cookies?.sesion;
    const sesion = token ? await obtenerSesion(token) : null;
    if (!sesion) return reply.status(401).send({ error: 'Sesión no válida.' });
    const rol = await obtenerRolEnNegocio(sesion.userId, emisorId);
    if (!rol) return reply.status(403).send({ error: 'No tienes acceso a este negocio.' });
    const [stock, rechazados, correos, leidas] = await Promise.all([
      supabase.from('productos').select('id,nombre,stock_actual,stock_critico,stock_minimo').eq('emisor_id', emisorId).eq('activo', true),
      supabase.from('comprobantes').select('id,secuencial,motivo_error,created_at').eq('emisor_id', emisorId).in('estado',['rechazado','devuelto']).order('created_at',{ascending:false}).limit(20),
      supabase.from('email_envios').select('id,comprobante_id,destinatario,detalle,created_at').eq('estado','error').order('created_at',{ascending:false}).limit(50),
      supabase.from('notificaciones_leidas').select('notificacion_key,read_at').eq('user_id', sesion.userId).eq('emisor_id', emisorId),
    ]);
    const emailRows = correos.data ?? [];
    const emailComprobanteIds = [...new Set(emailRows.map(x => x.comprobante_id).filter(Boolean))];
    let emailPermitidos = new Set<string>();
    if (emailComprobanteIds.length) {
      const { data: emailComprobantes } = await supabase.from('comprobantes').select('id').eq('emisor_id', emisorId).in('id', emailComprobanteIds);
      emailPermitidos = new Set((emailComprobantes ?? []).map(x => x.id));
    }
    const leidasSet = new Set((leidas.data ?? []).map(x => x.notificacion_key));
    const items: Array<{id:string;tipo:string;prioridad:string;titulo:string;detalle:string;fecha?:string;leida:boolean}> = [];
    for (const p of stock.data ?? []) {
      const actual=Number(p.stock_actual??0), crit=Number(p.stock_critico??0), min=Number(p.stock_minimo??0);
      if (actual<=crit) { const id=`stock:${p.id}:stop`; items.push({id,tipo:'inventario',prioridad:'alta',titulo:`STOP: ${p.nombre}`,detalle:`Stock ${actual}. Nivel crítico ${crit}.`,leida:leidasSet.has(id)}); }
      else if (actual<=min) { const id=`stock:${p.id}:bajo`; items.push({id,tipo:'inventario',prioridad:'media',titulo:`Stock bajo: ${p.nombre}`,detalle:`Stock ${actual}. Mínimo ${min}.`,leida:leidasSet.has(id)}); }
    }
    for (const r of rechazados.data ?? []) { const id=`sri:${r.id}`; items.push({id,tipo:'sri',prioridad:'alta',titulo:`Comprobante rechazado ${r.secuencial??''}`.trim(),detalle:r.motivo_error??'Revisar respuesta del SRI.',fecha:r.created_at,leida:leidasSet.has(id)}); }
    for (const e of emailRows.filter(x => emailPermitidos.has(x.comprobante_id))) { const id=`correo:${e.id}`; items.push({id,tipo:'correo',prioridad:'media',titulo:'Correo no enviado',detalle:e.detalle??`No se pudo enviar a ${e.destinatario}.`,fecha:e.created_at,leida:leidasSet.has(id)}); }
    items.sort((a,b)=>Number(a.leida)-Number(b.leida) || ({alta:0,media:1,baja:2}[a.prioridad]??9)-({alta:0,media:1,baja:2}[b.prioridad]??9) || String(b.fecha??'').localeCompare(String(a.fecha??'')));
    return reply.send({ items: items.slice(0,40), total: items.length, noLeidas: items.filter(x=>!x.leida).length });
  });

  app.post<{ Body: { emisorId?: string; notificacionId?: string } }>('/notificaciones/leer', async (request, reply) => {
    const { emisorId, notificacionId } = request.body ?? {};
    if (!emisorId || !notificacionId) return reply.status(400).send({ error: 'Faltan emisorId o notificacionId.' });
    const token = request.cookies?.sesion;
    const sesion = token ? await obtenerSesion(token) : null;
    if (!sesion) return reply.status(401).send({ error: 'Sesión no válida.' });
    const rol = await obtenerRolEnNegocio(sesion.userId, emisorId);
    if (!rol) return reply.status(403).send({ error: 'No tienes acceso a este negocio.' });
    const { error } = await supabase.from('notificaciones_leidas').upsert({ user_id: sesion.userId, emisor_id: emisorId, notificacion_key: notificacionId, read_at: new Date().toISOString() }, { onConflict: 'user_id,emisor_id,notificacion_key' });
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({ ok: true });
  });

  app.post<{ Body: { emisorId?: string } }>('/notificaciones/leer-todas', async (request, reply) => {
    const { emisorId } = request.body ?? {};
    if (!emisorId) return reply.status(400).send({ error: 'Falta emisorId.' });
    const token = request.cookies?.sesion;
    const sesion = token ? await obtenerSesion(token) : null;
    if (!sesion) return reply.status(401).send({ error: 'Sesión no válida.' });
    const rol = await obtenerRolEnNegocio(sesion.userId, emisorId);
    if (!rol) return reply.status(403).send({ error: 'No tienes acceso a este negocio.' });
    const [stock, rechazados, correos] = await Promise.all([
      supabase.from('productos').select('id,stock_actual,stock_critico,stock_minimo').eq('emisor_id', emisorId).eq('activo', true),
      supabase.from('comprobantes').select('id').eq('emisor_id', emisorId).in('estado',['rechazado','devuelto']).limit(50),
      supabase.from('email_envios').select('id,comprobante_id').eq('estado','error').limit(100),
    ]);
    const ids:string[] = [];
    for (const p of stock.data ?? []) { const actual=Number(p.stock_actual??0), crit=Number(p.stock_critico??0), min=Number(p.stock_minimo??0); if(actual<=crit) ids.push(`stock:${p.id}:stop`); else if(actual<=min) ids.push(`stock:${p.id}:bajo`); }
    for (const r of rechazados.data ?? []) ids.push(`sri:${r.id}`);
    const emailIds=[...new Set((correos.data??[]).map(e=>e.comprobante_id).filter(Boolean))];
    let emailOk=new Set<string>();
    if(emailIds.length){const {data:ec}=await supabase.from('comprobantes').select('id').eq('emisor_id',emisorId).in('id',emailIds);emailOk=new Set((ec??[]).map(x=>x.id));}
    for (const e of (correos.data ?? []).filter(x=>emailOk.has(x.comprobante_id))) ids.push(`correo:${e.id}`);
    const rows = ids.map(id => ({ user_id: sesion.userId, emisor_id: emisorId, notificacion_key: id, read_at: new Date().toISOString() }));
    if (rows.length) { const { error } = await supabase.from('notificaciones_leidas').upsert(rows, { onConflict: 'user_id,emisor_id,notificacion_key' }); if (error) return reply.status(500).send({ error: error.message }); }
    return reply.send({ ok: true, total: rows.length });
  });
}
