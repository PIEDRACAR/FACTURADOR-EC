import type { FastifyInstance } from 'fastify';
import { supabase } from '../db/supabase.js';
import { env } from '../config/env.js';

export async function registrarRutasProveedores(app: FastifyInstance) {
  app.get<{ Querystring: { emisorId?: string; incluirInactivos?: string } }>('/proveedores', async (request, reply) => {
    const { emisorId, incluirInactivos } = request.query;
    if (!emisorId) return reply.status(400).send({ error: 'Falta el parámetro emisorId.' });

    let consulta = supabase
      .from('proveedores')
      .select('*')
      .eq('emisor_id', emisorId)
      .order('razon_social', { ascending: true });
    if (incluirInactivos !== 'true') consulta = consulta.eq('activo', true);

    const { data, error } = await consulta;
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(data);
  });

  app.get<{ Querystring: { emisorId?: string; tipo?: string; identificacion?: string } }>('/proveedores/consultar', async (request, reply) => {
    const emisorId=String(request.query.emisorId||''); const tipo=String(request.query.tipo||'04'); const identificacion=String(request.query.identificacion||'').replace(/\D/g,'');
    if(!emisorId||!identificacion)return reply.status(400).send({error:'Emisor e identificación son obligatorios.'});
    if(tipo==='05' && !/^\d{10}$/.test(identificacion)) return reply.status(400).send({error:'La cédula debe tener 10 dígitos.'});
    if(tipo==='04' && !/^\d{13}$/.test(identificacion)) return reply.status(400).send({error:'El RUC debe tener 13 dígitos.'});
    const {data:local}=await supabase.from('proveedores').select('razon_social,nombre_comercial,telefono,email,direccion').eq('emisor_id',emisorId).eq('tipo_identificacion',tipo).eq('identificacion',identificacion).maybeSingle();
    if(local)return reply.send({encontrado:true,fuente:'PROVEEDOR_LOCAL',datos:{razonSocial:local.razon_social,nombreComercial:local.nombre_comercial,telefono:local.telefono,email:local.email,direccion:local.direccion}});
    const ruc=tipo==='05'?`${identificacion}001`:identificacion;
    try {
      const u=new URL(env.sriRucLookupUrl); u.searchParams.set('ruc',ruc); u.searchParams.set('numeroRuc',ruc);
      const r=await fetch(u,{headers:{Accept:'application/json','User-Agent':'FacturadorEC/1.0'}});
      if(!r.ok)return reply.send({encontrado:false,fuente:'SRI',mensaje:`SRI respondió HTTP ${r.status}.`});
      const raw:any=await r.json(); const item=Array.isArray(raw)?raw[0]:raw?.data?.[0]??raw?.data??raw;
      if(item)return reply.send({encontrado:true,fuente:'SRI',datos:{razonSocial:item.razonSocial??item.razon_social??item.nombreRazonSocial??item.nombreComercial??item.nombre??'',nombreComercial:item.nombreComercial??item.nombre_comercial??'',direccion:item.direccionMatriz??item.direccion??item.domicilioFiscal??'',estado:item.estadoContribuyenteRuc??item.estado??'',actividadPrincipal:item.actividadEconomicaPrincipal??item.actividadPrincipal??''}});
      return reply.send({encontrado:false,fuente:'SRI',mensaje:tipo==='05'?'La cédula no tiene un RUC consultable en el catastro del SRI.':'No se encontró el RUC en el catastro del SRI.'});
    } catch(e){ request.log.error({err:e},'Consulta SRI de proveedor falló'); return reply.status(502).send({error:'No fue posible consultar el SRI en este momento.'}); }
  });

  app.post<{
    Body: {
      emisorId: string;
      tipoIdentificacion?: string;
      identificacion: string;
      razonSocial: string;
      nombreComercial?: string;
      telefono?: string;
      email: string;
      direccion?: string;
    };
  }>('/proveedores', async (request, reply) => {
    const b = request.body;
    if (!b?.emisorId || !b?.identificacion || !b?.razonSocial || !b?.email) {
      return reply.status(400).send({ error: 'Identificación, razón social y correo electrónico son obligatorios.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(b.email))) return reply.status(400).send({ error:'El correo electrónico no tiene un formato válido.' });

    const { data, error } = await supabase
      .from('proveedores')
      .insert({
        emisor_id: b.emisorId,
        tipo_identificacion: b.tipoIdentificacion ?? '04',
        identificacion: b.identificacion,
        razon_social: b.razonSocial,
        nombre_comercial: b.nombreComercial ?? null,
        telefono: b.telefono ?? null,
        email: String(b.email).trim().toLowerCase(),
        direccion: b.direccion ?? null,
      })
      .select('id')
      .single();

    if (error || !data) {
      return reply.status(409).send({
        error: 'No se pudo crear el proveedor. Es posible que esa identificación ya esté registrada.',
        detalle: error?.message,
      });
    }
    return reply.status(201).send({ id: data.id });
  });

  app.patch<{
    Params: { id: string };
    Body: Partial<{
      razonSocial: string;
      nombreComercial: string;
      telefono: string;
      email: string;
      direccion: string;
      activo: boolean;
    }>;
  }>('/proveedores/:id', async (request, reply) => {
    const b = request.body ?? {};
    const cambios: Record<string, unknown> = {};
    if (b.razonSocial !== undefined) cambios.razon_social = b.razonSocial;
    if (b.nombreComercial !== undefined) cambios.nombre_comercial = b.nombreComercial;
    if (b.telefono !== undefined) cambios.telefono = b.telefono;
    if (b.email !== undefined) cambios.email = b.email;
    if (b.direccion !== undefined) cambios.direccion = b.direccion;
    if (b.activo !== undefined) cambios.activo = b.activo;

    if (Object.keys(cambios).length === 0) return reply.status(400).send({ error: 'No se envió ningún campo para actualizar.' });

    const { error } = await supabase.from('proveedores').update(cambios).eq('id', request.params.id);
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({ ok: true });
  });
}
