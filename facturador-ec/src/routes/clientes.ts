import type { FastifyInstance } from 'fastify';
import { supabase } from '../db/supabase.js';
import { env } from '../config/env.js';

function normalizarIdentificacion(v: string) { return v.replace(/\D/g, ''); }
function validarEmail(v: string) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }

function mapearSRI(data: any) {
  const item = Array.isArray(data) ? data[0] : data?.data?.[0] ?? data?.data ?? data;
  if (!item) return null;
  return {
    razonSocial: item.razonSocial ?? item.razon_social ?? item.nombreRazonSocial ?? item.nombreComercial ?? item.nombre ?? null,
    nombreComercial: item.nombreComercial ?? item.nombre_comercial ?? null,
    estado: item.estadoContribuyenteRuc ?? item.estado ?? item.estadoContribuyente ?? null,
    direccion: item.direccionMatriz ?? item.direccion ?? item.domicilioFiscal ?? null,
    actividadPrincipal: item.actividadEconomicaPrincipal ?? item.actividadPrincipal ?? item.actividad_economica_principal ?? null,
    regimen: item.regimen ?? null,
    tipoContribuyente: item.tipoContribuyente ?? item.tipo_contribuyente ?? null,
    obligadoContabilidad: item.obligadoLlevarContabilidad ?? item.obligado_contabilidad ?? null,
    fuente: 'SRI',
  };
}

export async function registrarRutasClientes(app: FastifyInstance) {
  app.get<{ Querystring: { emisorId?: string } }>('/clientes', async (request, reply) => {
    const { emisorId } = request.query;
    if (!emisorId) return reply.status(400).send({ error: 'Falta el parámetro emisorId.' });
    const { data, error } = await supabase.from('clientes').select('*').eq('emisor_id', emisorId).order('razon_social', { ascending: true });
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(data);
  });

  // Consulta de identificación: RUC directamente al servicio de catastro del SRI.
  // Para cédula, si no existe un servicio de interoperabilidad del Registro Civil
  // configurado, se intenta consultar el RUC de persona natural (cédula + 001).
  app.get<{ Querystring: { tipo?: string; identificacion?: string } }>('/clientes/consultar', async (request, reply) => {
    const tipo = request.query.tipo ?? '05';
    const identificacion = normalizarIdentificacion(request.query.identificacion ?? '');
    if (!identificacion) return reply.status(400).send({ error: 'Indica una identificación.' });
    if (tipo === '05' && !/^\d{10}$/.test(identificacion)) return reply.status(400).send({ error: 'La cédula debe tener 10 dígitos.' });
    if (tipo === '04' && !/^\d{13}$/.test(identificacion)) return reply.status(400).send({ error: 'El RUC debe tener 13 dígitos.' });

    // Servicio autorizado de Registro Civil, si el operador lo ha contratado/configurado.
    if (tipo === '05' && env.registroCivilLookupUrl) {
      try {
        const u = new URL(env.registroCivilLookupUrl);
        u.searchParams.set('cedula', identificacion);
        const r = await fetch(u, { headers: { Accept: 'application/json' } });
        if (r.ok) {
          const d = await r.json();
          if (d) return reply.send({ encontrado: true, fuente: 'REGISTRO_CIVIL', datos: d });
        }
      } catch (e) { request.log.warn({ err: e }, 'Consulta Registro Civil no disponible; se intenta SRI.'); }
    }

    const ruc = tipo === '05' ? `${identificacion}001` : identificacion;
    try {
      const u = new URL(env.sriRucLookupUrl);
      u.searchParams.set('ruc', ruc);
      u.searchParams.set('numeroRuc', ruc);
      const r = await fetch(u, { headers: { Accept: 'application/json', 'User-Agent': 'FacturadorEC/1.0' } });
      if (!r.ok) return reply.send({ encontrado: false, fuente: 'SRI', mensaje: `SRI respondió HTTP ${r.status}.` });
      const mapped = mapearSRI(await r.json());
      return reply.send({ encontrado: !!mapped, fuente: 'SRI', datos: mapped });
    } catch (e) {
      request.log.error({ err: e }, 'Consulta SRI falló');
      return reply.status(502).send({ error: 'No fue posible consultar el SRI en este momento.', detalle: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post<{ Body: { emisorId: string; tipoIdentificacion: string; identificacion: string; razonSocial: string; email: string; telefono?: string; direccion?: string } }>('/clientes', async (request, reply) => {
    const b = request.body;
    if (!b?.emisorId || !b?.tipoIdentificacion || !b?.identificacion || !b?.razonSocial || !b?.email) {
      return reply.status(400).send({ error: 'Identificación, razón social y correo electrónico son obligatorios para facturar.' });
    }
    if (!validarEmail(b.email)) return reply.status(400).send({ error: 'El correo electrónico no tiene un formato válido.' });
    const { data, error } = await supabase.from('clientes').upsert({
      emisor_id: b.emisorId, tipo_identificacion: b.tipoIdentificacion, identificacion: b.identificacion,
      razon_social: b.razonSocial, email: b.email.trim().toLowerCase(), telefono: b.telefono ?? null, direccion: b.direccion ?? null,
    }, { onConflict: 'emisor_id,tipo_identificacion,identificacion' }).select('id').single();
    if (error || !data) return reply.status(500).send({ error: error?.message ?? 'No se pudo guardar el cliente.' });
    return reply.status(201).send({ id: data.id });
  });

  app.patch<{ Params: { id: string }; Body: Partial<{ razonSocial: string; email: string; telefono: string; direccion: string }> }>('/clientes/:id', async (request, reply) => {
    const b = request.body ?? {}; const cambios: Record<string, unknown> = {};
    if (b.razonSocial !== undefined) cambios.razon_social = b.razonSocial;
    if (b.email !== undefined) { if (!validarEmail(b.email)) return reply.status(400).send({ error: 'Correo inválido.' }); cambios.email = b.email.trim().toLowerCase(); }
    if (b.telefono !== undefined) cambios.telefono = b.telefono;
    if (b.direccion !== undefined) cambios.direccion = b.direccion;
    if (!Object.keys(cambios).length) return reply.status(400).send({ error: 'No se envió ningún campo para actualizar.' });
    const { error } = await supabase.from('clientes').update(cambios).eq('id', request.params.id);
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({ ok: true });
  });
}
