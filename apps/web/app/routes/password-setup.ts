import { hasPasskey } from '@gongyu/auth/service';
import {
    hasPassword,
    setupPassword,
} from '@gongyu/auth/password-service';
import { SessionService } from '@gongyu/auth/session-service';
import { Effect, Schema } from 'effect';
import {
    BootstrapRequest,
    bootstrapTokenMatches,
} from '../auth/bootstrap.server';
import { readRequestJson, runPasskeySessionJson } from '../passkeys/http.server';
import { cloudflareRequestContext } from '../platform-context';
import type { Route } from './+types/password-setup';

class PasswordSetupRequest extends Schema.Class<PasswordSetupRequest>(
    'PasswordSetupRequest',
)({
    bootstrapToken: Schema.String,
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
    const bootstrap = await Schema.decodeUnknownPromise(BootstrapRequest)(
        payload,
    ).catch(() => null);
    if (
        bootstrap === null ||
        !(await bootstrapTokenMatches(
            bootstrap.bootstrapToken,
            env.SETUP_TOKEN,
        ))
    ) {
        throw new Response('Bootstrap token is invalid', { status: 403 });
    }
    const credentials = await Schema.decodeUnknownPromise(
        PasswordSetupRequest,
    )(payload).catch(() => null);
    if (credentials === null) {
        throw new Response('Invalid password setup request', { status: 400 });
    }

    const setup = Effect.gen(function* () {
        const passkeyRegistered = yield* hasPasskey();
        const passwordRegistered = yield* hasPassword();
        if (passkeyRegistered || passwordRegistered) {
            return yield* Effect.fail({
                code: 'password_already_set',
                message: '管理员凭据已存在，初始化已关闭。',
                status: 409,
            } as const);
        }
        return yield* setupPassword(credentials.password);
    });

    return runPasskeySessionJson(effect, authentication, setup);
}
