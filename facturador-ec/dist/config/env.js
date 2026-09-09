import 'dotenv/config';
function required(name) {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Falta la variable de entorno ${name}. Revisa tu archivo .env (usa .env.example como plantilla).`);
    }
    return value;
}
export const env = {
    port: Number(process.env.PORT ?? 3000),
    supabaseUrl: required('SUPABASE_URL'),
    supabaseServiceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
    // Llave maestra (32 bytes en hex) para cifrar/descifrar el certificado
    // .p12 y su contraseña dentro de Supabase. Ver src/crypto/secrets.ts.
    // Generarla una sola vez con:
    //   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
    secretsEncryptionKey: required('SECRETS_ENCRYPTION_KEY'),
    // Estos dos son solo para las pruebas locales de este scaffold.
    // En el sistema real, el ambiente y el certificado se leen POR EMISOR
    // desde las tablas `emisores` y `certificados` (ver sección 4/12 del
    // documento de arquitectura), no de variables de entorno globales.
    sriAmbiente: (process.env.SRI_AMBIENTE ?? '1'),
    p12Path: process.env.P12_PATH ?? './certificados/firma.p12',
    p12Password: process.env.P12_PASSWORD ?? '',
    // Correo transaccional. Resend se usa por HTTPS, sin exponer credenciales al navegador.
    resendApiKey: process.env.RESEND_API_KEY ?? '',
    emailFrom: process.env.EMAIL_FROM ?? '',
    sriRucLookupUrl: process.env.SRI_RUC_LOOKUP_URL ?? 'https://srienlinea.sri.gob.ec/sri-catastro-sujeto-servicio-internet/rest/ConsolidadoContribuyente/obtenerPorNumerosRuc',
    registroCivilLookupUrl: process.env.REGISTRO_CIVIL_LOOKUP_URL ?? '',
    appUrl: process.env.APP_URL ?? 'http://localhost:3000',
    proveedorAdminEmails: process.env.PROVEEDOR_ADMIN_EMAILS ?? '',
};
//# sourceMappingURL=env.js.map