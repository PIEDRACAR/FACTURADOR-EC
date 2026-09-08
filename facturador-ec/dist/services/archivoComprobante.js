import { createHash } from 'node:crypto';
import { supabase } from '../db/supabase.js';
import { generarRidePdf } from './ride.js';
export const COMPROBANTES_BUCKET = 'comprobantes';
let bucketReady = null;
async function ensureBucket() {
    if (!bucketReady) {
        bucketReady = (async () => {
            const { data: buckets, error: listError } = await supabase.storage.listBuckets();
            if (listError)
                throw new Error(`No se pudo consultar Supabase Storage: ${listError.message}`);
            if (buckets?.some((b) => b.name === COMPROBANTES_BUCKET))
                return;
            const { error: createError } = await supabase.storage.createBucket(COMPROBANTES_BUCKET, {
                public: false,
                fileSizeLimit: '20MB',
                allowedMimeTypes: ['application/xml', 'text/xml', 'application/pdf'],
            });
            if (createError && !/already exists|duplicate/i.test(createError.message)) {
                throw new Error(`No se pudo crear el bucket privado de comprobantes: ${createError.message}`);
            }
        })().catch((error) => {
            bucketReady = null;
            throw error;
        });
    }
    return bucketReady;
}
function sha256(data) {
    return createHash('sha256').update(data).digest('hex');
}
function safeSegment(value) {
    return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}
export async function archivarComprobanteAutorizado(input) {
    if (!input.xmlFirmado)
        throw new Error('No existe XML firmado para archivar.');
    await ensureBucket();
    const fecha = new Date();
    const year = String(fecha.getUTCFullYear());
    const key = safeSegment(input.claveAcceso || input.comprobanteId);
    const prefix = `${safeSegment(input.emisorId)}/${year}/${key}`;
    const xmlPath = `${prefix}.xml`;
    const pdfPath = `${prefix}.pdf`;
    const xmlBuffer = Buffer.from(input.xmlFirmado, 'utf8');
    const rideBuffer = await generarRidePdf(input.comprobanteId);
    const [xmlUpload, pdfUpload] = await Promise.all([
        supabase.storage.from(COMPROBANTES_BUCKET).upload(xmlPath, xmlBuffer, {
            contentType: 'application/xml',
            cacheControl: '31536000',
            upsert: true,
        }),
        supabase.storage.from(COMPROBANTES_BUCKET).upload(pdfPath, rideBuffer, {
            contentType: 'application/pdf',
            cacheControl: '31536000',
            upsert: true,
        }),
    ]);
    if (xmlUpload.error)
        throw new Error(`No se pudo guardar el XML en Storage: ${xmlUpload.error.message}`);
    if (pdfUpload.error)
        throw new Error(`No se pudo guardar el RIDE PDF en Storage: ${pdfUpload.error.message}`);
    const base = {
        comprobante_id: input.comprobanteId,
        emisor_id: input.emisorId,
        bucket: COMPROBANTES_BUCKET,
    };
    const { error: metadataError } = await supabase.from('comprobante_archivos').upsert([
        {
            ...base,
            tipo: 'xml_firmado',
            storage_path: xmlPath,
            mime_type: 'application/xml',
            nombre_archivo: `${key}.xml`,
            tamano_bytes: xmlBuffer.length,
            sha256: sha256(xmlBuffer),
        },
        {
            ...base,
            tipo: 'ride_pdf',
            storage_path: pdfPath,
            mime_type: 'application/pdf',
            nombre_archivo: `RIDE-${safeSegment(input.secuencial || key)}.pdf`,
            tamano_bytes: rideBuffer.length,
            sha256: sha256(rideBuffer),
        },
    ], { onConflict: 'comprobante_id,tipo' });
    if (metadataError) {
        throw new Error(`Los archivos fueron guardados, pero no se pudo registrar su índice: ${metadataError.message}`);
    }
    return { xmlPath, pdfPath };
}
export async function obtenerArchivosComprobante(comprobanteId) {
    const { data, error } = await supabase
        .from('comprobante_archivos')
        .select('id, tipo, bucket, storage_path, mime_type, nombre_archivo, tamano_bytes, sha256, created_at, updated_at')
        .eq('comprobante_id', comprobanteId)
        .order('tipo');
    if (error)
        throw new Error(`No se pudo consultar el archivo documental: ${error.message}`);
    const archivos = await Promise.all((data ?? []).map(async (archivo) => {
        const { data: signed, error: signedError } = await supabase.storage
            .from(archivo.bucket)
            .createSignedUrl(archivo.storage_path, 3600, { download: true });
        return {
            ...archivo,
            url: signedError ? null : signed?.signedUrl ?? null,
            error: signedError?.message ?? null,
        };
    }));
    return archivos;
}
//# sourceMappingURL=archivoComprobante.js.map