import dotenv from 'dotenv';

export const E2E_ENV_FILE = '.env.e2e';

let didLoadE2EEnvFile = false;

const TEST_HOST_PATTERNS = [
  /^localhost$/i,
  /^127(?:\.\d{1,3}){3}$/,
  /^::1$/,
  /(^|[-.])e2e($|[-.])/i,
  /(^|[-.])test($|[-.])/i,
  /(^|[-.])testing($|[-.])/i,
];

function getAllowedHosts() {
  return (process.env.E2E_DATABASE_HOST_ALLOWLIST ?? '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}

export function loadE2EEnvFile() {
  if (didLoadE2EEnvFile) return;
  dotenv.config({ path: E2E_ENV_FILE, quiet: true });
  didLoadE2EEnvFile = true;
}

function parseDatabaseUrl(databaseUrl: string) {
  try {
    return new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL_TEST precisa ser uma URL Postgres valida.');
  }
}

export function assertE2EDatabaseUrl(databaseUrl: string) {
  const parsed = parseDatabaseUrl(databaseUrl);
  const host = parsed.hostname.toLowerCase();
  const allowedHosts = getAllowedHosts();

  const isAllowedTestHost =
    TEST_HOST_PATTERNS.some((pattern) => pattern.test(host)) ||
    allowedHosts.includes(host);

  if (!isAllowedTestHost) {
    throw new Error(
      [
        'DATABASE_URL_TEST recusada: o host do banco nao parece ser de teste.',
        `Host recebido: ${host}`,
        'Use localhost/127.0.0.1 ou um host com "test"/"e2e" no nome.',
        'Para um banco remoto dedicado a E2E, adicione o host exato em E2E_DATABASE_HOST_ALLOWLIST.',
      ].join('\n'),
    );
  }
}

export function getRequiredE2EDatabaseUrl() {
  loadE2EEnvFile();

  const databaseUrl = process.env.DATABASE_URL_TEST?.trim();

  if (!databaseUrl) {
    throw new Error(`DATABASE_URL_TEST nao definida. Crie ${E2E_ENV_FILE} antes de rodar E2E.`);
  }

  assertE2EDatabaseUrl(databaseUrl);
  return databaseUrl;
}

export function configureE2EDatabaseEnv() {
  const databaseUrl = getRequiredE2EDatabaseUrl();
  process.env.DATABASE_URL = databaseUrl;
  return databaseUrl;
}
