import { configureE2EDatabaseEnv } from '../e2e/support/e2e-env.ts';

configureE2EDatabaseEnv();

await import('../server.ts');
