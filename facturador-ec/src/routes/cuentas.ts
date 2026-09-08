import type { FastifyInstance } from 'fastify';
import { supabase } from '../db/supabase.js';

/**
 * Cuentas por pagar y por cobrar como un libro de seguimiento independiente
 * del motor de facturación: no modifican cómo `/pos/venta` emite ante el
 * SRI (que sigue exigiendo que las formas de pago cuadren con el total en
 * el momento de emitir, como exige el comprobante electrónico). Una cuenta
 * por cobrar puede referenciar un `comprobante_id` ya emitido, para llevar
 * el seguimiento de cobro de una venta que en la práctica se cobra después
 * — la factura ya está emitida y autorizada; esto es el registro contable
 * de cuándo se cobra.
 */

export async function registrarRutasCuentas(app: FastifyInstance) {
  // ========== CUENTAS POR PAGAR ==========

  app.get<{ Querystring: { emisorId?: string; estado?: string } }>('/cuentas-por-pagar/listado', async (request, reply) => {
    const { emisorId, estado } = request.query;
    if (!emisorId) return reply.status(400).send({ error: 'Falta el parámetro emisorId.' });

    let consulta = supabase
      .from('cuentas_por_pagar')
      .select('*, proveedores(razon_social)')
      .eq('emisor_id', emisorId)
      .order('fecha_vencimiento', { ascending: true });
    if (estado) consulta = consulta.eq('estado', estado);

    const { data, error } = await consulta;
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(data);
  });

  app.post<{
    Body: {
      emisorId: string;
      proveedorId: string;
      numeroDocumento?: string;
      concepto: string;
      fechaVencimiento: string;
      montoTotal: number;
    };
  }>('/cuentas-por-pagar', async (request, reply) => {
    const b = request.body;
    if (!b?.emisorId || !b?.proveedorId || !b?.concepto || !b?.fechaVencimiento || !b?.montoTotal) {
      return reply.status(400).send({ error: 'Faltan campos obligatorios.' });
    }
    if (b.montoTotal <= 0) return reply.status(400).send({ error: 'El monto debe ser mayor a 0.' });

    const { data, error } = await supabase
      .from('cuentas_por_pagar')
      .insert({
        emisor_id: b.emisorId,
        proveedor_id: b.proveedorId,
        numero_documento: b.numeroDocumento ?? null,
        concepto: b.concepto,
        fecha_vencimiento: b.fechaVencimiento,
        monto_total: b.montoTotal,
      })
      .select('id')
      .single();

    if (error || !data) return reply.status(500).send({ error: error?.message ?? 'No se pudo crear la cuenta.' });
    return reply.status(201).send({ id: data.id });
  });

  app.post<{
    Params: { id: string };
    Body: { monto: number; formaPagoCodigo?: string; nota?: string };
  }>('/cuentas-por-pagar/:id/pagos', async (request, reply) => {
    const { monto, formaPagoCodigo, nota } = request.body ?? {};
    if (!monto || monto <= 0) return reply.status(400).send({ error: 'Indica un monto de pago válido.' });

    const { data, error } = await supabase.rpc('registrar_pago_cuenta_por_pagar', {
      p_cuenta_id: request.params.id,
      p_monto: monto,
      p_forma_pago_codigo: formaPagoCodigo ?? '20',
      p_nota: nota ?? null,
    });

    if (error || !data?.[0]) {
      const mensaje = error?.message ?? '';
      if (mensaje.includes('cuenta_no_encontrada')) return reply.status(404).send({ error: 'Cuenta no encontrada.' });
      if (mensaje.includes('monto_excede_saldo')) return reply.status(400).send({ error: 'El pago supera el saldo pendiente de esta cuenta.' });
      return reply.status(500).send({ error: mensaje || 'No se pudo registrar el pago.' });
    }

    return reply.status(201).send({
      montoPagado: data[0].monto_pagado_resultante,
      saldo: data[0].saldo_resultante,
      estado: data[0].estado_resultante,
    });
  });

  // ========== CUENTAS POR COBRAR ==========

  app.get<{ Querystring: { emisorId?: string; estado?: string } }>('/cuentas-por-cobrar/listado', async (request, reply) => {
    const { emisorId, estado } = request.query;
    if (!emisorId) return reply.status(400).send({ error: 'Falta el parámetro emisorId.' });

    let consulta = supabase
      .from('cuentas_por_cobrar')
      .select('*, clientes(razon_social)')
      .eq('emisor_id', emisorId)
      .order('fecha_vencimiento', { ascending: true });
    if (estado) consulta = consulta.eq('estado', estado);

    const { data, error } = await consulta;
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(data);
  });

  app.post<{
    Body: {
      emisorId: string;
      clienteId: string;
      comprobanteId?: string;
      concepto: string;
      fechaVencimiento: string;
      montoTotal: number;
    };
  }>('/cuentas-por-cobrar', async (request, reply) => {
    const b = request.body;
    if (!b?.emisorId || !b?.clienteId || !b?.concepto || !b?.fechaVencimiento || !b?.montoTotal) {
      return reply.status(400).send({ error: 'Faltan campos obligatorios.' });
    }
    if (b.montoTotal <= 0) return reply.status(400).send({ error: 'El monto debe ser mayor a 0.' });

    const { data, error } = await supabase
      .from('cuentas_por_cobrar')
      .insert({
        emisor_id: b.emisorId,
        cliente_id: b.clienteId,
        comprobante_id: b.comprobanteId ?? null,
        concepto: b.concepto,
        fecha_vencimiento: b.fechaVencimiento,
        monto_total: b.montoTotal,
      })
      .select('id')
      .single();

    if (error || !data) return reply.status(500).send({ error: error?.message ?? 'No se pudo crear la cuenta.' });
    return reply.status(201).send({ id: data.id });
  });

  app.post<{
    Params: { id: string };
    Body: { monto: number; formaPagoCodigo?: string; nota?: string };
  }>('/cuentas-por-cobrar/:id/pagos', async (request, reply) => {
    const { monto, formaPagoCodigo, nota } = request.body ?? {};
    if (!monto || monto <= 0) return reply.status(400).send({ error: 'Indica un monto de cobro válido.' });

    const { data, error } = await supabase.rpc('registrar_pago_cuenta_por_cobrar', {
      p_cuenta_id: request.params.id,
      p_monto: monto,
      p_forma_pago_codigo: formaPagoCodigo ?? '01',
      p_nota: nota ?? null,
    });

    if (error || !data?.[0]) {
      const mensaje = error?.message ?? '';
      if (mensaje.includes('cuenta_no_encontrada')) return reply.status(404).send({ error: 'Cuenta no encontrada.' });
      if (mensaje.includes('monto_excede_saldo')) return reply.status(400).send({ error: 'El cobro supera el saldo pendiente de esta cuenta.' });
      return reply.status(500).send({ error: mensaje || 'No se pudo registrar el cobro.' });
    }

    return reply.status(201).send({
      montoCobrado: data[0].monto_cobrado_resultante,
      saldo: data[0].saldo_resultante,
      estado: data[0].estado_resultante,
    });
  });
}
