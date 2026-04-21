import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET;

if (!SECRET) {
  throw new Error(
    '❌ JWT_SECRET não definida nas variáveis de ambiente.\n' +
    'Adicione JWT_SECRET=<string-longa-aleatória> no .env.local e no painel da Vercel.'
  );
}

export interface JwtPayload {
  sub: string;   // user id
  email: string;
  iat?: number;
  exp?: number;
}

/** Gera um JWT assinado válido por 7 dias. */
export function signToken(payload: Omit<JwtPayload, 'iat' | 'exp'>): string {
  return jwt.sign(payload, SECRET as string, { expiresIn: '7d' });
}

/** Verifica e decodifica o token. Lança erro se inválido ou expirado. */
export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, SECRET as string) as JwtPayload;
}

/** Extrai o token do header Authorization: Bearer <token> */
export function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  return authHeader.slice(7).trim() || null;
}
