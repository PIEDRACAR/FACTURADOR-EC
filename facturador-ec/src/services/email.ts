import { env } from '../config/env.js';

interface EmailAttachment { filename: string; content: string; type?: string; }

function normalizarEmail(v: string): string {
  return String(v ?? '').trim().toLowerCase();
}

function validarFrom(from: string): void {
  // Resend accepts "Nombre <correo@dominio>". Validate only the address part.
  const match = from.match(/<([^>]+)>$/);
  const address = normalizarEmail(match ? match[1] : from);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
    throw new Error(`EMAIL_FROM no es válido: ${from || '(vacío)'}. Usa, por ejemplo, facturacion@contsertrib.com.`);
  }
}

async function resendRequest(path: string, options: RequestInit = {}) {
  if (!env.resendApiKey) throw new Error('RESEND_API_KEY no está configurada en Railway.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`https://api.resend.com${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${env.resendApiKey}`,
        ...(options.headers || {}),
      },
    });
    const text = await response.text();
    let data: any = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (!response.ok) {
      const detail = data?.message || data?.error || data?.name || data?.raw || `HTTP ${response.status}`;
      throw new Error(`Resend HTTP ${response.status}: ${String(detail)}`);
    }
    return data;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Resend no respondió en 15 segundos. Verifica conectividad de Railway.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function enviarComprobantePorCorreo(input: {
  to: string;
  subject: string;
  html: string;
  attachments?: EmailAttachment[];
}) {
  if (!env.resendApiKey || !env.emailFrom) {
    throw new Error('Correo no configurado: define RESEND_API_KEY y EMAIL_FROM en Railway.');
  }
  const to = normalizarEmail(input.to);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new Error(`Destinatario no válido: ${input.to}`);
  validarFrom(env.emailFrom);

  const data = await resendRequest('/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.emailFrom,
      to: [to],
      subject: input.subject,
      html: input.html,
      attachments: input.attachments?.map((a) => ({ filename: a.filename, content: a.content })),
    }),
  });

  if (!data?.id) throw new Error(`Resend respondió sin ID de correo: ${JSON.stringify(data)}`);
  return data;
}

/** Diagnóstico seguro para ROOT: nunca devuelve la API key. */
export async function diagnosticoResend() {
  if (!env.resendApiKey) return { ok:false, configured:false, error:'RESEND_API_KEY no está configurada.' };
  if (!env.emailFrom) return { ok:false, configured:false, error:'EMAIL_FROM no está configurada.' };
  try {
    validarFrom(env.emailFrom);
    const data = await resendRequest('/domains', { method:'GET' });
    const domains = Array.isArray(data?.data) ? data.data.map((d:any) => ({
      id:d.id, name:d.name, status:d.status,
    })) : [];
    const fromMatch = env.emailFrom.match(/<([^>]+)>$/);
    const fromAddress = normalizarEmail(fromMatch ? fromMatch[1] : env.emailFrom);
    const fromDomain = fromAddress.split('@')[1] || '';
    const domain = domains.find((d:any) => String(d.name).toLowerCase() === fromDomain);
    return {
      ok:true, configured:true,
      from:env.emailFrom, fromDomain,
      fromDomainFound:Boolean(domain),
      fromDomainStatus:domain?.status ?? 'no_encontrado',
      domains,
    };
  } catch (err) {
    return { ok:false, configured:true, error:err instanceof Error ? err.message : String(err) };
  }
}
