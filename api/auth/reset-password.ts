import type { VercelRequest, VercelResponse } from '@vercel/node';
import bcrypt from 'bcryptjs';
import sql from '../_db.js';
import { hashPasswordResetToken } from '../../lib/password-reset.js';
import { resetPasswordSchema, formatZodError } from '../../lib/schemas.js';
import { logError, logInfo } from '../../lib/logger.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST')
    return res.status(405).json({ error: 'Método não permitido' });

  const parsed = resetPasswordSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: formatZodError(parsed.error) });
  }

  const { token, password } = parsed.data;

  try {
    const tokenHash = hashPasswordResetToken(token);

    const rows = await sql`
      SELECT id AS token_id, user_id
      FROM password_reset_tokens
      WHERE token_hash = ${tokenHash}
        AND used = FALSE
        AND expires_at > NOW()
    `;

    if (rows.length === 0) {
      return res.status(400).json({
        error: 'Link inválido ou expirado. Solicite um novo link de recuperação.',
      });
    }

    const { token_id, user_id } = rows[0];
    const passwordHash = await bcrypt.hash(password, 12);

    await sql`
      UPDATE users SET password = ${passwordHash} WHERE id = ${user_id}
    `;

    await sql`
      UPDATE password_reset_tokens SET used = TRUE WHERE id = ${token_id}
    `;

    logInfo('auth_password_reset_success', { userId: user_id });
    return res.status(200).json({
      message: 'Senha redefinida com sucesso! Você já pode fazer login.',
    });
  } catch (error) {
    logError('auth_password_reset_failed', error);
    return res.status(500).json({ error: 'Erro interno. Tente novamente.' });
  }
}
