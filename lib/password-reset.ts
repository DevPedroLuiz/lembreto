import crypto from 'crypto';

export function hashPasswordResetToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function createPasswordResetToken(): {
  rawToken: string;
  tokenHash: string;
  expiresAt: string;
} {
  const rawToken = crypto.randomBytes(32).toString('hex');

  return {
    rawToken,
    tokenHash: hashPasswordResetToken(rawToken),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  };
}

export async function sendRecoveryEmail(
  to: string,
  name: string,
  resetLink: string,
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY não configurada');

  const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Redefinição de senha - Lembreto</title>
</head>
<body style="margin:0;padding:0;background:#040814;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#040814;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#0a122a;border-radius:16px;border:1px solid rgba(96,165,250,0.12);overflow:hidden;max-width:560px;width:100%;">
          <tr>
            <td style="background:linear-gradient(135deg,#1e3a8a,#1d4ed8);padding:32px 40px;text-align:center;">
              <p style="margin:0 0 4px;font-size:28px;">Lembreto</p>
              <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;">Lembreto</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:40px;">
              <h2 style="margin:0 0 12px;color:#e2e8f0;font-size:20px;font-weight:600;">Redefinição de senha</h2>
              <p style="margin:0 0 24px;color:#94a3b8;font-size:15px;line-height:1.6;">
                Olá, <strong style="color:#e2e8f0;">${name}</strong>! Recebemos uma solicitação para redefinir a senha da sua conta.
              </p>
              <p style="margin:0 0 32px;color:#94a3b8;font-size:15px;line-height:1.6;">
                Clique no botão abaixo para criar uma nova senha. O link é válido por <strong style="color:#e2e8f0;">1 hora</strong>.
              </p>
              <table cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="center">
                    <a href="${resetLink}" style="display:inline-block;background:linear-gradient(135deg,#1d4ed8,#3b82f6);color:#ffffff;text-decoration:none;padding:14px 36px;border-radius:10px;font-size:16px;font-weight:600;">
                      Redefinir minha senha
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:32px 0 0;color:#64748b;font-size:13px;line-height:1.6;">
                Se o botão não funcionar, copie e cole este link no seu navegador:
              </p>
              <p style="margin:8px 0 0;word-break:break-all;">
                <a href="${resetLink}" style="color:#60a5fa;font-size:13px;">${resetLink}</a>
              </p>
              <hr style="margin:32px 0;border:none;border-top:1px solid rgba(96,165,250,0.1);" />
              <p style="margin:0;color:#64748b;font-size:13px;line-height:1.6;">
                Se você não solicitou a redefinição, ignore este e-mail. Sua senha permanece a mesma.
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
      subject: 'Redefinição de senha - Lembreto',
      html,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend ${response.status}: ${body}`);
  }
}
