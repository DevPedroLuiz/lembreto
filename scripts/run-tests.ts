import assert from 'node:assert/strict';
import {
  buildGoogleOAuthStateCookie,
  buildSessionCookie,
  clearGoogleOAuthStateCookie,
  clearSessionCookie,
  getGoogleOAuthStateFromCookieHeader,
  getSessionTokenFromCookieHeader,
} from '../lib/session.js';
import { isTrustedRequestOrigin } from '../lib/csrf.js';
import { MAX_AVATAR_BYTES, validateAvatarDataUrl } from '../lib/avatar.js';
import {
  createTaskSchema,
  formatZodError,
  loginSchema,
  profileUpdateSchema,
  registerSchema,
  updateTaskSchema,
} from '../lib/schemas.js';

process.env.JWT_SECRET ||= 'test-secret-with-at-least-thirty-two-characters';

function createSqlMock(options?: { blacklisted?: boolean; missingUser?: boolean }) {
  return async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join(' ');

    if (query.includes('FROM token_blacklist')) {
      return options?.blacklisted ? [{ exists: 1 }] : [];
    }

    if (query.includes('FROM users')) {
      if (options?.missingUser) return [];
      return [{
        id: values[0],
        name: 'Pedro',
        email: 'pedro@example.com',
        avatar: null,
      }];
    }

    return [];
  };
}

async function run(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

async function main() {
  const { signToken } = await import('../lib/jwt.js');
  const {
    buildTokenJti,
    getAuthFailureResponse,
    requireAuthFromToken,
  } = await import('../lib/auth.js');

  await run('buildTokenJti composes subject and iat', () => {
    assert.equal(buildTokenJti({ sub: 'user-1', iat: 42 }), 'user-1_42');
    assert.equal(buildTokenJti({ sub: 'user-1' }), 'user-1_0');
  });

  await run('requireAuthFromToken returns payload and user for valid token', async () => {
    const token = signToken({ sub: 'user-1', email: 'pedro@example.com' });
    const auth = await requireAuthFromToken(createSqlMock(), token);
    assert.equal(auth.user.id, 'user-1');
    assert.equal(auth.user.email, 'pedro@example.com');
    assert.equal(auth.payload.sub, 'user-1');
  });

  await run('requireAuthFromToken rejects blacklisted token', async () => {
    const token = signToken({ sub: 'user-1', email: 'pedro@example.com' });

    await assert.rejects(
      requireAuthFromToken(createSqlMock({ blacklisted: true }), token),
      (error: unknown) => {
        const response = getAuthFailureResponse(error);
        assert.deepEqual(response, {
          status: 401,
          error: 'Sessão encerrada. Faça login novamente.',
        });
        return true;
      },
    );
  });

  await run('session cookie helpers set and clear auth cookie', () => {
    const cookie = buildSessionCookie('token-123', 60);
    assert.match(cookie, /lembreto_session=token-123/);
    assert.match(cookie, /HttpOnly/);

    const cleared = clearSessionCookie();
    assert.match(cleared, /Max-Age=0/);

    const token = getSessionTokenFromCookieHeader('foo=bar; lembreto_session=token-123; theme=dark');
    assert.equal(token, 'token-123');
  });

  await run('google oauth state cookie helpers set and clear state cookie', () => {
    const cookie = buildGoogleOAuthStateCookie('state-123', 600);
    assert.match(cookie, /lembreto_google_oauth_state=state-123/);
    assert.match(cookie, /SameSite=Lax/);

    const cleared = clearGoogleOAuthStateCookie();
    assert.match(cleared, /Max-Age=0/);

    const state = getGoogleOAuthStateFromCookieHeader('foo=bar; lembreto_google_oauth_state=state-123');
    assert.equal(state, 'state-123');
  });

  await run('csrf helper rejects cross-site requests', () => {
    assert.equal(
      isTrustedRequestOrigin({
        host: 'localhost:3000',
        origin: 'http://localhost:3000',
        'sec-fetch-site': 'same-origin',
      }),
      true,
    );

    assert.equal(
      isTrustedRequestOrigin({
        host: 'localhost:3000',
        origin: 'https://evil.example',
        'sec-fetch-site': 'cross-site',
      }),
      false,
    );
  });

  await run('avatar validator enforces mime type and size limit', () => {
    const validPayload = Buffer.from('avatar-image').toString('base64');
    const validAvatar = `data:image/png;base64,${validPayload}`;
    assert.equal(validateAvatarDataUrl(validAvatar).valid, true);

    const invalidMime = `data:text/plain;base64,${validPayload}`;
    assert.equal(validateAvatarDataUrl(invalidMime).valid, false);

    const bigPayload = Buffer.alloc(MAX_AVATAR_BYTES + 1).toString('base64');
    const hugeAvatar = `data:image/png;base64,${bigPayload}`;
    assert.equal(validateAvatarDataUrl(hugeAvatar).valid, false);
  });

  await run('register schema trims and validates payloads', () => {
    const parsed = registerSchema.parse({
      name: ' Pedro ',
      email: 'pedro@example.com',
      password: '123456',
    });

    assert.equal(parsed.name, 'Pedro');
    assert.throws(() => registerSchema.parse({
      name: '',
      email: 'invalid',
      password: '123',
    }));
  });

  await run('login schema rejects malformed email', () => {
    assert.throws(() => loginSchema.parse({
      email: 'not-an-email',
      password: '123456',
    }));
  });

  await run('profile schema accepts null avatar and rejects invalid avatar', () => {
    assert.deepEqual(profileUpdateSchema.parse({ avatar: null }), { avatar: null });

    assert.throws(() => profileUpdateSchema.parse({
      avatar: 'data:text/plain;base64,Zm9v',
    }));
  });

  await run('task schemas validate create and update payloads', () => {
    const created = createTaskSchema.parse({
      title: 'Estudar',
      description: 'Revisar schemas',
      dueDate: new Date().toISOString(),
      priority: 'high',
      category: 'Estudos',
      suppressHolidayNotifications: true,
    });

    assert.equal(created.priority, 'high');
    assert.equal(created.suppressHolidayNotifications, true);

    const updated = updateTaskSchema.parse({
      status: 'completed',
      suppressHolidayNotifications: false,
    });

    assert.equal(updated.status, 'completed');
    assert.equal(updated.suppressHolidayNotifications, false);

    const result = updateTaskSchema.safeParse({});
    assert.equal(result.success, false);
    if (!result.success) {
      assert.equal(formatZodError(result.error), 'Envie ao menos um campo para atualizar');
    }
  });

  console.log('PASS all tests');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
