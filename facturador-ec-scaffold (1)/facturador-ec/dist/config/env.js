import 'dotenv/config';
function required(name) {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Falta la variable de entorno ${name}. Revisa tu archivo .env (usa .env.example como plantilla).`);
    }
    return value;
}
export const env = {
    port: Number(process.env.PORT ?? 8080),
    supabaseUrl: required('SUPABASE_URL'),
    supabaseServiceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
    // Estos dos son solo para las pruebas locales de este scaffold.
    // En el sistema real, el ambiente y el certificado se leen POR EMISOR
    // desde las tablas `emisores` y `certificados` (ver sección 4/12 del
    // documento de arquitectura), no de variables de entorno globales.
    sriAmbiente: (process.env.SRI_AMBIENTE ?? '1'),
    p12Path: process.env.P12_PATH ?? './certificados/firma.p12',
    p12Password: process.env.P12_PASSWORD ?? '',
};
//# sourceMappingURL=env.js.map