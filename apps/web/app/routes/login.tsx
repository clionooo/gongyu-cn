import {
    AuthenticationOptionsEnvelope,
    AuthenticationVerificationRequest,
} from '@gongyu/auth/contracts';
import { hasPasskey } from '@gongyu/auth/service';
import { FingerprintSimpleIcon, LockSimpleIcon } from '@phosphor-icons/react';
import { startAuthentication } from '@simplewebauthn/browser';
import { Schema } from 'effect';
import { useRef, useState } from 'react';
import { redirect } from 'react-router';
import { safeReturnTo } from '../auth/bootstrap.server';
import { Banner, Button, Input, LayerCard } from '../components/ui';
import { cloudflareRequestContext } from '../platform-context';
import type { Route } from './+types/login';

class ApiErrorEnvelope extends Schema.Class<ApiErrorEnvelope>(
    'LoginApiErrorEnvelope',
)({
    error: Schema.Struct({ code: Schema.String, message: Schema.String }),
}) {}

export function meta(): Route.MetaDescriptors {
    return [{ title: '登录 · Gongyu' }];
}

export async function loader({ context, request }: Route.LoaderArgs) {
    const { authentication, effect } = context.get(cloudflareRequestContext);
    const returnTo = safeReturnTo(
        new URL(request.url).searchParams.get('returnTo'),
    );
    if (authentication.authenticated) {
        return redirect(returnTo);
    }
    const passkeyRegistered = await effect
        .runPromise(hasPasskey())
        .catch(() => false);
    return { passkeyRegistered, returnTo };
}

async function postJson(path: string, body: unknown): Promise<unknown> {
    const response = await fetch(path, {
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
    });
    const payload: unknown = await response.json();
    if (!response.ok) {
        const failure =
            await Schema.decodeUnknownPromise(ApiErrorEnvelope)(payload);
        throw new Error(failure.error.message);
    }
    return payload;
}

export default function Login({ loaderData }: Route.ComponentProps) {
    const [message, setMessage] = useState<string | null>(null);
    const [processing, setProcessing] = useState(false);
    const [password, setPassword] = useState('');
    const authenticationInFlight = useRef(false);

    async function authenticateWithPasskey() {
        if (authenticationInFlight.current) {
            return;
        }
        authenticationInFlight.current = true;
        setProcessing(true);
        setMessage('正在等待通行密钥验证…');
        try {
            const envelope = await Schema.decodeUnknownPromise(
                AuthenticationOptionsEnvelope,
            )(await postJson('/api/passkey/authentication/options', {}));
            const response = await startAuthentication({
                optionsJSON: envelope.options,
            });
            const verification = AuthenticationVerificationRequest.make({
                ceremonyId: envelope.ceremonyId,
                response,
            });
            await postJson('/api/passkey/authentication/verify', verification);
            window.location.assign(loaderData.returnTo);
        } catch (error) {
            authenticationInFlight.current = false;
            setProcessing(false);
            setMessage(
                error instanceof Error
                    ? error.message
                    : '通行密钥验证失败。',
            );
        }
    }

    async function authenticateWithPassword() {
        setProcessing(true);
        setMessage(null);
        try {
            await postJson('/api/password/login', { password });
            window.location.assign(loaderData.returnTo);
        } catch (error) {
            setProcessing(false);
            setMessage(
                error instanceof Error ? error.message : '密码登录失败。',
            );
        }
    }

    return (
        <main
            className="mx-auto flex min-h-[calc(100vh-10rem)] w-full max-w-md flex-col justify-center gap-3 px-4 py-8 sm:px-6"
            id="main-content"
            tabIndex={-1}
        >
            <LayerCard className="gongyu-bookmark-card">
                <div className="p-5 sm:p-6">
                    <span className="flex size-10 items-center justify-center rounded-xl bg-gongyu-tint text-gongyu-link">
                        <LockSimpleIcon
                            aria-hidden="true"
                            size={22}
                            weight="duotone"
                        />
                    </span>
                    <h1 className="mt-4 text-xl font-semibold text-gongyu-default">
                        登录
                    </h1>
                    <p className="mt-1 text-sm text-gongyu-subtle">
                        输入管理员密码，或使用通行密钥继续。
                    </p>
                    <form
                        className="mt-5 flex flex-col gap-3"
                        onSubmit={(event) => {
                            event.preventDefault();
                            void authenticateWithPassword();
                        }}
                    >
                        <Input
                            autoComplete="current-password"
                            label="管理员密码"
                            onChange={(event) =>
                                setPassword(event.currentTarget.value)
                            }
                            type="password"
                            value={password}
                        />
                        <Button
                            className="w-full"
                            disabled={password.length === 0}
                            icon={LockSimpleIcon}
                            loading={processing}
                            type="submit"
                            variant="primary"
                        >
                            使用密码登录
                        </Button>
                    </form>
                    {loaderData.passkeyRegistered ? (
                        <>
                            <div className="my-4 flex items-center gap-3 text-xs text-gongyu-subtle">
                                <span className="h-px flex-1 bg-gongyu-tint" />
                                或
                                <span className="h-px flex-1 bg-gongyu-tint" />
                            </div>
                            <Button
                                className="w-full"
                                icon={FingerprintSimpleIcon}
                                loading={processing}
                                onClick={authenticateWithPasskey}
                                type="button"
                                variant="secondary"
                            >
                                使用通行密钥登录
                            </Button>
                        </>
                    ) : null}
                    {message === null ? null : (
                        <p
                            aria-live="polite"
                            className="mt-3 text-sm text-gongyu-subtle"
                        >
                            {message}
                        </p>
                    )}
                </div>
            </LayerCard>
            <noscript>
                <Banner
                    description="登录需要浏览器支持 JavaScript。"
                    title="需要 JavaScript"
                    variant="error"
                />
            </noscript>
        </main>
    );
}
