import { env } from '../config/env.js';
export async function enviarComprobantePorCorreo(input) {
    if (!env.resendApiKey || !env.emailFrom) {
        throw new Error('Correo no configurado: define RESEND_API_KEY y EMAIL_FROM en el backend.');
    }
    const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.resendApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            from: env.emailFrom,
            to: [input.to],
            subject: input.subject,
            html: input.html,
            attachments: input.attachments?.map((a) => ({ filename: a.filename, content: a.content })),
        }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok)
        throw new Error(`Proveedor de correo rechazó el envío: ${JSON.stringify(data)}`);
    return data;
}
//# sourceMappingURL=email.js.map