import { supabase } from '../db/supabase.js';
export async function registrarRutasProveedores(app) {
    app.get('/proveedores', async (request, reply) => {
        const { emisorId, incluirInactivos } = request.query;
        if (!emisorId)
            return reply.status(400).send({ error: 'Falta el parámetro emisorId.' });
        let consulta = supabase
            .from('proveedores')
            .select('*')
            .eq('emisor_id', emisorId)
            .order('razon_social', { ascending: true });
        if (incluirInactivos !== 'true')
            consulta = consulta.eq('activo', true);
        const { data, error } = await consulta;
        if (error)
            return reply.status(500).send({ error: error.message });
        return reply.send(data);
    });
    app.post('/proveedores', async (request, reply) => {
        const b = request.body;
        if (!b?.emisorId || !b?.identificacion || !b?.razonSocial) {
            return reply.status(400).send({ error: 'Faltan campos obligatorios: emisorId, identificacion, razonSocial.' });
        }
        const { data, error } = await supabase
            .from('proveedores')
            .insert({
            emisor_id: b.emisorId,
            tipo_identificacion: b.tipoIdentificacion ?? '04',
            identificacion: b.identificacion,
            razon_social: b.razonSocial,
            nombre_comercial: b.nombreComercial ?? null,
            telefono: b.telefono ?? null,
            email: b.email ?? null,
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
    app.patch('/proveedores/:id', async (request, reply) => {
        const b = request.body ?? {};
        const cambios = {};
        if (b.razonSocial !== undefined)
            cambios.razon_social = b.razonSocial;
        if (b.nombreComercial !== undefined)
            cambios.nombre_comercial = b.nombreComercial;
        if (b.telefono !== undefined)
            cambios.telefono = b.telefono;
        if (b.email !== undefined)
            cambios.email = b.email;
        if (b.direccion !== undefined)
            cambios.direccion = b.direccion;
        if (b.activo !== undefined)
            cambios.activo = b.activo;
        if (Object.keys(cambios).length === 0)
            return reply.status(400).send({ error: 'No se envió ningún campo para actualizar.' });
        const { error } = await supabase.from('proveedores').update(cambios).eq('id', request.params.id);
        if (error)
            return reply.status(500).send({ error: error.message });
        return reply.send({ ok: true });
    });
}
//# sourceMappingURL=proveedores.js.map