import {
    RegistrationOptionsEnvelope,
    RegistrationVerificationRequest,
} from '@gongyu/auth/contracts';
import { hasPasskey } from '@gongyu/auth/service';
import { hasPassword } from '@gongyu/auth/password-service';
import {
    FingerprintSimpleIcon,
    KeyIcon,
    LockSimpleIcon,
} from '@phosphor-icons/react';
import { startRegistration } from '@simplewebauthn/browser';
import { Schema } from 'effect';
import { useRef, useState } from 'react';
import { redirect } from 'react-router';
import { Banner, Button, Input, LayerCard } from '../components/ui';
import { cloudflareRequestContext } from '../platform-context';
import type { Route } from './+types/setup';

class ApiErrorEnvelope extends Schema.Class<ApiErrorEnvelope>(
    'SetupApiErrorEnvelope',
)({
    error: Schema.Struct({ code: Schema.String, message: Schema.String }),
}) {}

export function meta(): Route.MetaDescriptors {
    return [{ title: '初始化 Gongyu' }];
}

export async function loader({ context }: Route.LoaderArgs) {
    const { authentication, effect } = context.get(cloudflareRequestContext);
    const credentialsRegistered =
        authentication.authenticated ||
        (await effect.runPromise(hasPasskey())) ||
        (await effect.runPromise(hasPassword()));
    if (credentialsRegistered) {
        return redirect(
            authentication.authenticated ? '/admin/bookmarks' : '/login',
        );
    }
    return null;
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

export default function Setup() {
    const [mode, setMode] = useState<'password' | 'passkey'>('password');
    const [bootstrapToken, setBootstrapToken] = useState('');
    const [password, setPassword] = useState('');
    const [passwordConfirm, setPasswordConfirm] = useState('');
    const [message, setMessage] = useState<string | null>(null);
    const [processing, setProcessing] = useState(false);
    const registrationInFlight = useRef(false);

    async function registerPasskey() {
        if (registrationInFlight.current) {
            return;
        }
        registrationInFlight.current = true;
        setProcessing(true);
        setMessage('正在等待通行密钥注册…');
        try {
            const envelope = await Schema.decodeUnknownPromise(
                RegistrationOptionsEnvelope,
            )(
                await postJson('/api/passkey/registration/options', {
                    bootstrapToken,
                }),
            );
            const response = await startRegistration({
                optionsJSON: envelope.options,
            });
            await postJson(
                '/api/passkey/registration/verify',
                RegistrationVerificationRequest.make({
                    ceremonyId: envelope.ceremonyId,
                    response,
                }),
            );
            window.location.assign('/admin/bookmarks');
        } catch (error) {
            registrationInFlight.current = false;
            setProcessing(false);
            setMessage(
                error instanceof Error
                    ? error.message
                    : '通行密钥注册失败。',
            );
        }
    }

    async function setupPasswordAction() {
        setProcessing(true);
        setMessage(null);
        if (password.length < 8) {
            setProcessing(false);
            setMessage('密码至少需要 8 个字符。');
            return;
        }
        if (password !== passwordConfirm) {
            setProcessing(false);
            setMessage('两次输入的密码不一致。');
            return;
        }
        try {
            await postJson('/api/password/setup', {
                bootstrapToken,
                password,
            });
            window.location.assign('/admin/bookmarks');
        } catch (error) {
            setProcessing(false);
            setMessage(
                error instanceof Error ? error.message : '密码设置失败。',
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
                        {mode === 'password' ? (
                            <LockSimpleIcon
                                aria-hidden="true"
                                size={22}
                                weight="duotone"
                            />
                        ) : (
                            <KeyIcon
                                aria-hidden="true"
                                size={22}
                                weight="duotone"
                            />
                        )}
                    </span>
                    <h1 className="mt-4 text-xl font-semibold text-gongyu-default">
                        初始化 Gongyu
                    </h1>
                    <p className="mt-1 text-sm text-gongyu-subtle">
                        选择一种方式创建管理员凭据，只需一次。
                    </p>
                    <div className="mt-4 flex gap-2">
                        <Button
                            className="flex-1"
                            onClick={() => {
                                setMode('password');
                                setMessage(null);
                            }}
                            type="button"
                            variant={mode === 'password' ? 'primary' : 'secondary'}
                        >
                            密码登录
                        </Button>
                        <Button
                            className="flex-1"
                            onClick={() => {
                                setMode('passkey');
                                setMessage(null);
                            }}
                            type="button"
                            variant={mode === 'passkey' ? 'primary' : 'secondary'}
                        >
                            通行密钥
                        </Button>
                    </div>
                    <div className="mt-5">
                        <Input
                            autoComplete="off"
                            label="初始化令牌"
                            onChange={(event) =>
                                setBootstrapToken(event.currentTarget.value)
                            }
                            type="password"
                            value={bootstrapToken}
                        />
                    </div>
                    {mode === 'password' ? (
                        <div className="mt-4 flex flex-col gap-3">
                            <Input
                                autoComplete="new-password"
                                label="管理员密码（至少 8 个字符）"
                                onChange={(event) =>
                                    setPassword(event.currentTarget.value)
                                }
                                type="password"
                                value={password}
                            />
                            <Input
                                autoComplete="new-password"
                                label="确认密码"
                                onChange={(event) =>
                                    setPasswordConfirm(event.currentTarget.value)
                                }
                                type="password"
                                value={passwordConfirm}
                            />
                            <Button
                                className="w-full"
                                disabled={
                                    bootstrapToken.length === 0 ||
                                    password.length === 0
                                }
                                icon={LockSimpleIcon}
                                loading={processing}
                                onClick={setupPasswordAction}
                                type="button"
                                variant="primary"
                            >
                                设置管理员密码
                            </Button>
                        </div>
                    ) : (
                        <Button
                            className="mt-4 w-full"
                            disabled={bootstrapToken.length === 0}
                            icon={FingerprintSimpleIcon}
                            loading={processing}
                            onClick={registerPasskey}
                            type="button"
                            variant="primary"
                        >
                            注册管理员通行密钥
                        </Button>
                    )}
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
                    description="初始化需要浏览器支持 JavaScript。"
                    title="需要 JavaScript"
                    variant="error"
                />
            </noscript>
        </main>
    );
}
