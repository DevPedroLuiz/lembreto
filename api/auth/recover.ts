import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from '../_db.js';
import {
  createPasswordResetToken,
  sendRecoveryEmail,
} from '../../lib/password-reset.js';
import { recoverPasswordSchema, formatZodError } from '../../lib/schemas.js';
import { logError, logInfo } from '../../lib/logger.js';

const GENERIC_RESPONSE = {
  message: 'Se este e-mail estiver cadastrado, você receberá um link em breve.',
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST')
    return res.status(405).json({ error: 'Método não permitido' });

  const parsed = recoverPasswordSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: formatZodError(parsed.error) });
  }

  const { email } = parsed.data;

  try {
    const rows = await sql`
      SELECT id, name FROM users WHERE email = ${email}
    `;

    if (rows.length > 0) {
      const user = rows[0];

      await sql`
        UPDATE password_reset_tokens
        SET used = TRUE
        WHERE user_id = ${user.id} AND used = FALSE AND expires_at > NOW()
      `;

      const { rawToken, tokenHash, expiresAt } = createPasswordResetToken();

      await sql`
        INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
        VALUES (${user.id}, ${tokenHash}, ${expiresAt})
      `;

      const appUrl = process.env.APP_URL ?? 'https://lembreto.vercel.app';
      const resetLink = `${appUrl}/reset-password?token=${rawToken}`;

      try {
        await sendRecoveryEmail(email, user.name, resetLink);
        logInfo('auth_recover_email_sent', { userId: user.id });
      } catch (error) {
        logError('auth_recover_email_failed', error, { userId: user.id });
      }
    }
  } catch (error) {
    logError('auth_recover_failed', error, { email });
  }

  return res.status(200).json(GENERIC_RESPONSE);
}
