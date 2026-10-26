import { verifyPassword } from '@gongyu/auth/password-service';
import { Schema } from 'effect';
import { readRequestJson, runPasskeySessionJson } from '../passkeys/http.server';
import { cloudflareRequestContext } from '../platform-context';
import type { Route } from './+types/password-login';

class PasswordLoginRequest extends Schema.Class<PasswordLoginRequest>(
    'PasswordLoginRequest',
)({
    password: Schema.String,
}) {}

export async function action({ context, request }: Route.ActionArgs) {
    const { authentication, effect, env } = context.get(
        cloudflareRequestContext,
    );
    if (request.headers.get('Origin') !== env.RP_ORIGIN) {
        throw new Response('Request origin is not allowed', { status: 403 });
    }
    const payload = await readRequestJson(request);
    const credentials = await Schema.decodeUnknownPromise(
        PasswordLoginRequest,
    )(payload).catch(() => null);
    if (credentials === null) {
        throw new Response('Invalid password login request', { status: 400 });
    }

    return runPasskeySessionJson(
        effect,
        authentication,
        verifyPassword(credentials.password),
    );
}
