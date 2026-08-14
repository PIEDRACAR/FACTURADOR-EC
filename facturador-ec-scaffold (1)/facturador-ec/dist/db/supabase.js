import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';
/**
 * Cliente de Supabase para uso EXCLUSIVO del backend, con la service role key
 * (bypassa RLS). Nunca exportar esta key ni este cliente hacia el navegador —
 * mismo principio de seguridad que ya se aplicó con la API key de Anthropic
 * en CONTSERTRIB y con el certificado .p12 aquí.
 *
 * El frontend (POS, panel de administración) debe usar su propia instancia
 * de Supabase con la clave "anon" pública, para que las políticas RLS
 * definidas en setup-supabase-facturador.sql sí se apliquen.
 */
export const supabase = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false },
});
//# sourceMappingURL=supabase.js.map