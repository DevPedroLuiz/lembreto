import crypto from 'crypto';

export function hashEmailVerificationToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function createEmailVerificationToken(): {
  rawToken: string;
  tokenHash: string;
  expiresAt: string;
} {
  const rawToken = crypto.randomBytes(32).toString('hex');

  return {
    rawToken,
    tokenHash: hashEmailVerificationToken(rawToken),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  };
}

export function isVerificationEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export async function sendVerificationEmail(
  to: string,
  name: string,
  verificationLink: string,
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY não configurada');

  const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Verifique seu e-mail - Lembreto</title>
</head>
<body style="margin:0;padding:0;background:#040814;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#040814;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#0a122a;border-radius:16px;border:1px solid rgba(96,165,250,0.12);overflow:hidden;max-width:560px;width:100%;">
          <tr>
            <td style="background:linear-gradient(135deg,#1e3a8a,#0284c7);padding:32px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;">Lembreto</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:40px;">
              <h2 style="margin:0 0 12px;color:#e2e8f0;font-size:20px;font-weight:600;">Verifique seu e-mail</h2>
              <p style="margin:0 0 24px;color:#94a3b8;font-size:15px;line-height:1.6;">
                Olá, <strong style="color:#e2e8f0;">${name}</strong>! Confirme este endereço para proteger sua conta e receber avisos importantes.
              </p>
              <p style="margin:0 0 32px;color:#94a3b8;font-size:15px;line-height:1.6;">
                O link é válido por <strong style="color:#e2e8f0;">24 horas</strong>.
              </p>
              <table cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="center">
                    <a href="${verificationLink}" style="display:inline-block;background:linear-gradient(135deg,#1d4ed8,#0ea5e9);color:#ffffff;text-decoration:none;padding:14px 36px;border-radius:10px;font-size:16px;font-weight:600;">
                      Verificar e-mail
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:32px 0 0;color:#64748b;font-size:13px;line-height:1.6;">
                Se o botão não funcionar, copie e cole este link no navegador:
              </p>
              <p style="margin:8px 0 0;word-break:break-all;">
                <a href="${verificationLink}" style="color:#60a5fa;font-size:13px;">${verificationLink}</a>
              </p>
              <hr style="margin:32px 0;border:none;border-top:1px solid rgba(96,165,250,0.1);" />
              <p style="margin:0;color:#64748b;font-size:13px;line-height:1.6;">
                Se você não criou ou alterou uma conta no Lembreto, ignore este e-mail.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 40px;border-top:1px solid rgba(96,165,250,0.08);text-align:center;">
              <p style="margin:0;color:#475569;font-size:12px;">© ${new Date().getFullYear()} Lembreto</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Lembreto <onboarding@resend.dev>',
      to: [to],
      subject: 'Verifique seu e-mail - Lembreto',
      html,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend ${response.status}: ${body}`);
  }
}
