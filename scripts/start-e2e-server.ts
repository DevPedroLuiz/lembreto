import { configureE2EDatabaseEnv } from '../e2e/support/e2e-env.ts';

process.env.PORT = process.env.PORT || '3001';
configureE2EDatabaseEnv();

await import('../server.ts');
