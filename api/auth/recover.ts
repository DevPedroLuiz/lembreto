// api/auth/recover.ts
// POST /api/auth/recover
//
// Correções aplicadas:
//  1. Envia e-mail real via Resend com link de redefinição
//  2. Sempre retorna a MESMA resposta — elimina user enumeration
//  3. Gera token seguro (crypto.randomBytes) e salva apenas o hash SHA-256 no banco
//  4. Invalida tokens anteriores ainda ativos do mesmo usuário

import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import sql from '../_db.js';

const GENERIC_RESPONSE = {
  message: 'Se este e-mail estiver cadastrado, você receberá um link em breve.',
};

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function sendRecoveryEmail(to: string, name: string, resetLink: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY não configurada');

  const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Redefinição de senha — Lembreto</title>
</head>
<body style="margin:0;padding:0;background:#040814;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#040814;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#0a122a;border-radius:16px;border:1px solid rgba(96,165,250,0.12);overflow:hidden;max-width:560px;width:100%;">

          <tr>
            <td style="background:linear-gradient(135deg,#1e3a8a,#1d4ed8);padding:32px 40px;text-align:center;">
              <p style="margin:0 0 4px;font-size:28px;">📝</p>
              <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;letter-spacing:-0.5px;">Lembreto</h1>
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
                Se você não solicitou a redefinição, ignore este e-mail — sua senha permanece a mesma.
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:20px 40px;border-top:1px solid rgba(96,165,250,0.08);text-align:center;">
              <p style="margin:0;color:#475569;font-size:12px;">© ${new Date().getFullYear()} Lembreto · Todos os direitos reservados</p>
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
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      // Troque pelo seu domínio verificado no Resend, ex: "Lembreto <noreply@seudominio.com>"
      from: 'Lembreto <onboarding@resend.dev>',
      to: [to],
      subject: '🔐 Redefinição de senha — Lembreto',
      html,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend ${response.status}: ${body}`);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST')
    return res.status(405).json({ error: 'Método não permitido' });

  const { email } = req.body ?? {};

  if (!email || typeof email !== 'string' || !email.includes('@'))
    return res.status(400).json({ error: 'Informe um e-mail válido' });

  const normalizedEmail = email.trim().toLowerCase();

  try {
    const rows = await sql`
      SELECT id, name FROM users WHERE email = ${normalizedEmail}
    `;

    if (rows.length > 0) {
      const user = rows[0];

      // Invalida tokens anteriores não usados deste usuário
      await sql`
        UPDATE password_reset_tokens
        SET used = TRUE
        WHERE user_id = ${user.id} AND used = FALSE AND expires_at > NOW()
      `;

      // Gera token bruto (enviado no link) e salva apenas o hash no banco
      const rawToken  = crypto.randomBytes(32).toString('hex');
      const tokenHash = hashToken(rawToken);
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // +1h

      await sql`
        INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
        VALUES (${user.id}, ${tokenHash}, ${expiresAt})
      `;

      const appUrl    = process.env.APP_URL ?? 'https://lembreto.vercel.app';
      const resetLink = `${appUrl}/reset-password?token=${rawToken}`;

      // Falha de e-mail é logada internamente — não vaza para o cliente
      try {
        await sendRecoveryEmail(normalizedEmail, user.name, resetLink);
        console.log(`[recover] E-mail enviado para: ${normalizedEmail}`);
      } catch (emailErr: any) {
        console.error('[recover] Falha ao enviar e-mail:', emailErr.message);
      }
    }
    // Se o e-mail não existir, não faz nada — retorna a mesma resposta abaixo
  } catch (e: any) {
    console.error('[recover] Erro de banco:', e.message);
  }

  // Sempre a mesma resposta — impede user enumeration
  return res.status(200).json(GENERIC_RESPONSE);
}
