import type { FastifyInstance } from 'fastify';
import { supabase } from '../db/supabase.js';
import { cifrar, cifrarTexto, bufferAPgBytea } from '../crypto/secrets.js';

interface RegistrarEmisorBody {
  ruc: string;
  razonSocial: string;
  direccionMatriz: string;
  obligadoContabilidad: boolean;
  establecimiento?: string; // default '001'
  puntoEmision?: string; // default '001'
  direccionEstablecimiento?: string; // default = direccionMatriz
  ambiente: 'pruebas' | 'produccion';
  p12Base64: string; // el .p12 completo, codificado en base64 (lo arma el navegador)
  p12Password: string;
  fechaExpiracionCertificado: string; // 'YYYY-MM-DD'
}

const RUC_REGEX = /^\d{13}$/;

export async function registrarRutasEmisores(app: FastifyInstance) {
  /**
   * Da de alta un negocio nuevo (emisor) completo, en un solo paso:
   * datos tributarios + punto de emisión + certificado cifrado.
   *
   * Este endpoint es lo que reemplaza los `insert into emisores/...` que
   * se hicieron a mano por SQL durante las pruebas — a partir de aquí,
   * cualquier negocio se registra llenando el formulario de /registro,
   * sin que nadie tenga que tocar Supabase ni Railway.
   */
  app.post<{ Body: RegistrarEmisorBody }>('/emisores/registrar', async (request, reply) => {
    const body = request.body;

    const faltantes: string[] = [];
    if (!body?.ruc) faltantes.push('ruc');
    if (!body?.razonSocial) faltantes.push('razonSocial');
    if (!body?.direccionMatriz) faltantes.push('direccionMatriz');
    if (typeof body?.obligadoContabilidad !== 'boolean') faltantes.push('obligadoContabilidad');
    if (!body?.ambiente) faltantes.push('ambiente');
    if (!body?.p12Base64) faltantes.push('p12Base64');
    if (!body?.p12Password) faltantes.push('p12Password');
    if (!body?.fechaExpiracionCertificado) faltantes.push('fechaExpiracionCertificado');

    if (faltantes.length > 0) {
      return reply.status(400).send({ error: `Faltan campos obligatorios: ${faltantes.join(', ')}` });
    }

    if (!RUC_REGEX.test(body.ruc)) {
      return reply.status(400).send({ error: 'El RUC debe tener exactamente 13 dígitos numéricos.' });
    }

    if (body.ambiente !== 'pruebas' && body.ambiente !== 'produccion') {
      return reply.status(400).send({ error: "El ambiente debe ser 'pruebas' o 'produccion'." });
    }

    // Validación mínima de que el base64 realmente decodifica a algo con
    // contenido — un .p12 real nunca pesa unos pocos bytes.
    let p12Buffer: Buffer;
    try {
      p12Buffer = Buffer.from(body.p12Base64, 'base64');
    } catch {
      return reply.status(400).send({ error: 'p12Base64 no es un base64 válido.' });
    }
    if (p12Buffer.length < 500) {
      return reply.status(400).send({
        error: `El archivo .p12 decodificado es demasiado pequeño (${p12Buffer.length} bytes) — revisa que se haya adjuntado el archivo correcto.`,
      });
    }

    const establecimiento = body.establecimiento ?? '001';
    const puntoEmision = body.puntoEmision ?? '001';
    const direccionEstablecimiento = body.direccionEstablecimiento ?? body.direccionMatriz;

    // Si el RUC ya existe, esto es una actualización (por ejemplo, renovar
    // un certificado vencido) en vez de un registro nuevo — el RUC es
    // único a nivel de toda la tabla, así que reintentar un `insert` con un
    // RUC existente siempre fallaría. Se reutiliza el emisor existente en
    // vez de bloquear al usuario sin darle forma de actualizar su
    // certificado.
    const { data: emisorExistente } = await supabase.from('emisores').select('id').eq('ruc', body.ruc).maybeSingle();

    let emisorId: string;
    let esActualizacion = false;

    if (emisorExistente) {
      esActualizacion = true;
      emisorId = emisorExistente.id;

      const { error: errorActualizarEmisor } = await supabase
        .from('emisores')
        .update({
          razon_social: body.razonSocial,
          direccion_matriz: body.direccionMatriz,
          obligado_contabilidad: body.obligadoContabilidad,
          ambiente: body.ambiente,
        })
        .eq('id', emisorId);

      if (errorActualizarEmisor) {
        request.log.error(errorActualizarEmisor);
        return reply.status(500).send({ error: 'No se pudo actualizar el emisor existente.', detalle: errorActualizarEmisor.message });
      }
    } else {
      const { data: emisorNuevo, error: errorEmisor } = await supabase
        .from('emisores')
        .insert({
          ruc: body.ruc,
          razon_social: body.razonSocial,
          direccion_matriz: body.direccionMatriz,
          obligado_contabilidad: body.obligadoContabilidad,
          ambiente: body.ambiente,
        })
        .select('id')
        .single();

      if (errorEmisor || !emisorNuevo) {
        request.log.error(errorEmisor);
        return reply.status(500).send({ error: 'No se pudo registrar el emisor.', detalle: errorEmisor?.message });
      }
      emisorId = emisorNuevo.id;
    }

    // 2) Punto de emisión — reutiliza el activo si ya existe uno (caso de
    // actualización), o crea uno nuevo.
    let puntoEmisionId: string;
    const { data: puntoExistente } = await supabase
      .from('puntos_emision')
      .select('id')
      .eq('emisor_id', emisorId)
      .eq('activo', true)
      .limit(1)
      .maybeSingle();

    if (puntoExistente) {
      puntoEmisionId = puntoExistente.id;
    } else {
      const { data: puntoEmisionRow, error: errorPunto } = await supabase
        .from('puntos_emision')
        .insert({ emisor_id: emisorId, establecimiento, punto_emision: puntoEmision, direccion: direccionEstablecimiento })
        .select('id')
        .single();

      if (errorPunto || !puntoEmisionRow) {
        request.log.error(errorPunto);
        return reply.status(500).send({
          error: 'El emisor se creó/actualizó pero falló el punto de emisión. Revisa manualmente en Supabase.',
          emisorId,
          detalle: errorPunto?.message,
        });
      }
      puntoEmisionId = puntoEmisionRow.id;
    }

    // 3) Certificado, cifrado antes de guardarse — nunca en texto plano.
    // `upsert` con onConflict por (emisor_id, alias) actualiza el
    // certificado si ya existía uno con el alias PRINCIPAL (renovación),
    // o lo crea si es la primera vez.
    const p12Cifrado = bufferAPgBytea(cifrar(p12Buffer));
    const passwordCifrada = bufferAPgBytea(cifrarTexto(body.p12Password));

    const { data: certificado, error: errorCert } = await supabase
      .from('certificados')
      .upsert(
        {
          emisor_id: emisorId,
          alias: 'PRINCIPAL',
          referencia_almacenamiento: 'db:cifrado',
          fecha_expiracion: body.fechaExpiracionCertificado,
          p12_cifrado: p12Cifrado,
          p12_password_cifrado: passwordCifrada,
        },
        { onConflict: 'emisor_id,alias' }
      )
      .select('id')
      .single();

    if (errorCert || !certificado) {
      request.log.error(errorCert);
      return reply.status(500).send({
        error: 'El emisor y el punto de emisión quedaron listos pero falló el certificado. Revisa manualmente en Supabase.',
        emisorId,
        detalle: errorCert?.message,
      });
    }

    return reply.status(201).send({
      emisorId,
      puntoEmisionId,
      certificadoId: certificado.id,
      mensaje: esActualizacion
        ? 'Este RUC ya estaba registrado — se actualizaron sus datos y su certificado.'
        : 'Emisor registrado correctamente. Ya puede emitir comprobantes.',
    });
  });
}
