import { neon } from '@neondatabase/serverless';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL não definida nas variáveis de ambiente.');
}

const sql = neon(process.env.DATABASE_URL);

export default sql;
