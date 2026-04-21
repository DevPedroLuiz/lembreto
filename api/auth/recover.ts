import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from '../_db.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST')
    return res.status(405).json({ error: 'Método não permitido' });

  const { email } = req.body ?? {};
  if (!email) return res.status(400).json({ error: 'Informe o email' });

  try {
    const rows = await sql`
      SELECT id FROM users WHERE email = ${email.trim().toLowerCase()}
    `;
    if (rows.length === 0)
      return res.status(404).json({ error: 'Email não encontrado' });

    return res.json({ message: 'Um link de recuperação foi enviado para seu email.' });
  } catch (e: any) {
    console.error('[recover]', e.message);
    return res.status(500).json({ error: `Erro interno: ${e.message}` });
  }
}
