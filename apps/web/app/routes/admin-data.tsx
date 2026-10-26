import {
    DataRunBusyError,
    DataRunRepository,
} from '@gongyu/data/data-run-repository';
import type { DataWorkflowPayload } from '@gongyu/domain/portability';
import { assertPublicHostname } from '@gongyu/integrations/network-safety';
import { R2Store } from '@gongyu/integrations/r2-store';
import {
    isSafeShaarliUrl,
    shaarliApiFailure,
    shaarliAuthorization,
    shaarliLinksUrl,
} from '@gongyu/integrations/shaarli-api-client';
import { NativeSelect } from '@mantine/core';
import {
    ArrowClockwiseIcon,
    DatabaseIcon,
    DownloadSimpleIcon,
} from '@phosphor-icons/react';
import { Effect } from 'effect';
import { useEffect } from 'react';
import {
    Form,
    redirect,
    useNavigation,
    useRevalidator,
    useRouteLoaderData,
} from 'react-router';
import {
    requireAuthenticatedMutation,
    requireAuthentication,
} from '../auth/session.server';
import { AdminPage } from '../components/admin-page';
import {
    AdminNativeField,
    AdminPanelHeader,
    adminFileInputClass,
    adminPanelBodyClass,
    adminPanelFooterClass,
} from '../components/admin-panel';
import {
    artifactOperationStatus,
    hasRowProgress,
    OperationProgress,
} from '../components/operation-progress';
import { StatusBadge } from '../components/status-badge';
import {
    Banner,
    Button,
    Empty,
    Input,
    LayerCard,
    LinkButton,
} from '../components/ui';
import { matchesFormSubmission } from '../form-navigation';
import { cloudflareRequestContext } from '../platform-context';
import type { loader as rootLoader } from '../root';
import type { Route } from './+types/admin-data';

const SOURCE_LIMIT_BYTES = 10 * 1_024 * 1_024;
const BACKUP_LIMIT_BYTES = 16 * 1_024 * 1_024;

export function meta(): Route.MetaDescriptors {
    return [{ title: '数据与恢复 · Gongyu' }];
}

async function digest(bytes: Uint8Array): Promise<string> {
    const value = await crypto.subtle.digest(
        'SHA-256',
        bytes.buffer as ArrayBuffer,
    );
    return Array.from(new Uint8Array(value), (byte) =>
        byte.toString(16).padStart(2, '0'),
    ).join('');
}

async function fetchShaarli(formData: FormData): Promise<Uint8Array> {
    const value = formData.get('shaarli_url');
    const secret = formData.get('api_secret');
    if (
        typeof value !== 'string' ||
        typeof secret !== 'string' ||
        secret.length < 12
    ) {
        throw new Response('请填写 Shaarli URL 和 API 密钥。', {
            status: 400,
        });
    }
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        throw new Response('请输入有效的 Shaarli URL。', { status: 400 });
    }
    if (!isSafeShaarliUrl(url)) {
        throw new Response(
            'Shaarli API 导入要求使用 HTTPS 且 URL 中不含凭据。',
            { status: 400 },
        );
    }
    url = shaarliLinksUrl(url);
    const origin = url.origin;
    const authorization = await shaarliAuthorization(secret);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    let response: Response | null = null;
    try {
        for (let redirects = 0; redirects <= 5; redirects += 1) {
            try {
                await assertPublicHostname(url);
            } catch {
                throw new Response(
                    'Shaarli API 主机无法解析为公网地址。',
                    { status: 400 },
                );
            }
            response = await fetch(url, {
                headers: {
                    Accept: 'application/json',
                    Authorization: authorization,
                },
                redirect: 'manual',
                signal: controller.signal,
            });
            if (![301, 302, 303, 307, 308].includes(response.status)) {
                break;
            }
            if (redirects === 5) {
                throw new Response('Shaarli API 重定向次数过多。', {
                    status: 502,
                });
            }
            const location = response.headers.get('Location');
            const redirected =
                location === null ? null : new URL(location, url);
            if (redirected === null || !isSafeShaarliUrl(redirected, origin)) {
                throw new Response('Shaarli API 返回了不安全的重定向。', {
                    status: 502,
                });
            }
            url = redirected;
        }
    } catch (error) {
        if (error instanceof Response) {
            throw error;
        }
        throw new Response('Shaarli API 请求失败。', { status: 502 });
    } finally {
        clearTimeout(timeout);
    }
    if (response === null) {
        throw new Response('Shaarli API 请求失败。', { status: 502 });
    }
    const failure = shaarliApiFailure(response);
    if (failure !== null) {
        throw new Response(failure.message, { status: failure.status });
    }
    const declared = Number.parseInt(
        response.headers.get('Content-Length') ?? '0',
        10,
    );
    if (declared > SOURCE_LIMIT_BYTES) {
        throw new Response('Shaarli API 响应过大。', {
            status: 413,
        });
    }
    if (response.body === null) {
        return new Uint8Array();
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    const deadline = Date.now() + 60_000;
    let size = 0;
    while (true) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
            await reader.cancel();
            throw new Response('Shaarli API 响应超时。', {
                status: 504,
            });
        }
        let timer: ReturnType<typeof setTimeout> | undefined;
        const result = await Promise.race([
            reader.read(),
            new Promise<never>((_, reject) => {
                timer = setTimeout(
                    () =>
                        reject(
                            new Response('Shaarli API 响应超时。', {
                                status: 504,
                            }),
                        ),
                    remaining,
                );
            }),
        ]).finally(() => {
            if (timer !== undefined) {
                clearTimeout(timer);
            }
        });
        if (result.done) {
            break;
        }
        size += result.value.byteLength;
        if (size > SOURCE_LIMIT_BYTES) {
            await reader.cancel();
            throw new Response('Shaarli API 响应过大。', {
                status: 413,
            });
        }
        chunks.push(result.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return bytes;
}

async function sourceBytes(
    formData: FormData,
    intent: string,
): Promise<Uint8Array | null> {
    if (intent === 'import_api') {
        return fetchShaarli(formData);
    }
    if (intent !== 'import' && intent !== 'restore') {
        return null;
    }
    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) {
        throw new Response('请选择源文件。', { status: 400 });
    }
    const maximum =
        intent === 'restore' ? BACKUP_LIMIT_BYTES : SOURCE_LIMIT_BYTES;
    if (file.size > maximum) {
        throw new Response(
            intent === 'restore'
                ? '备份文件不能超过 16 MiB。'
                : '源文件不能超过 10 MiB。',
            { status: 413 },
        );
    }
    return new Uint8Array(await file.arrayBuffer());
}

export async function loader({ context, request }: Route.LoaderArgs) {
    const { authentication, effect } = context.get(cloudflareRequestContext);
    if (!authentication.authenticated) {
        const url = new URL(request.url);
        return redirect(`/login?returnTo=${encodeURIComponent(url.pathname)}`);
    }
    const runs = await effect.runPromise(
        Effect.gen(function* () {
            const repository = yield* DataRunRepository;
            const runs = yield* repository.listRuns(50);
            return yield* Effect.forEach(runs, (run) =>
                repository
                    .listErrors(run.id, 20)
                    .pipe(Effect.map((errors) => ({ errors, run }))),
            );
        }),
    );
    return { now: Date.now() * 1_000, operations: runs };
}

export async function action({ context, request }: Route.ActionArgs) {
    const { authentication, effect, env } = context.get(
        cloudflareRequestContext,
    );
    requireAuthentication(authentication);
    if (request.headers.get('Origin') !== env.RP_ORIGIN) {
        throw new Response('请求来源不被允许', { status: 403 });
    }
    const formData = await request.formData();
    const submittedCsrfToken = formData.get('_csrf');
    await requireAuthenticatedMutation({
        authentication,
        expectedOrigin: env.RP_ORIGIN,
        request,
        requireWritable: true,
        runner: effect,
        submittedCsrfToken:
            typeof submittedCsrfToken === 'string' ? submittedCsrfToken : null,
    });
    const intentValue = formData.get('intent');
    const intent = typeof intentValue === 'string' ? intentValue : '';
    if (
        ![
            'backup',
            'export',
            'import',
            'import_api',
            'restore',
            'retry',
        ].includes(intent)
    ) {
        throw new Response('不支持的数据操作。', { status: 400 });
    }
    if (intent === 'retry') {
        const runIdValue = formData.get('run_id');
        if (typeof runIdValue !== 'string') {
            throw new Response('缺少数据操作。', { status: 400 });
        }
        const run = await effect.runPromise(
            Effect.gen(function* () {
                const repository = yield* DataRunRepository;
                return yield* repository.getRun(runIdValue);
            }),
        );
        if (run === null || run.state !== 'pending') {
            throw new Response('只有待处理的数据操作才能启动。', {
                status: 409,
            });
        }
        await startDataWorkflow(env.DATA_WORKFLOW, {
            format: run.format as DataWorkflowPayload['format'],
            kind: run.kind as DataWorkflowPayload['kind'],
            mode: run.mode as DataWorkflowPayload['mode'],
            rpId: env.RP_ID,
            runId: run.id,
            sourceEtag: run.sourceEtag,
            sourceKey: run.sourceKey,
            sourceSha256: run.sourceSha256,
            sourceSize: run.sourceSize,
            version: 1,
        });
        return redirect('/admin/data');
    }
    const kind =
        intent === 'backup'
            ? 'backup'
            : intent === 'restore'
              ? 'restore'
              : intent === 'export'
                ? 'export'
                : 'import';
    const formatValue = formData.get('format');
    const format =
        kind === 'backup' || kind === 'restore'
            ? 'full_backup'
            : typeof formatValue === 'string'
              ? formatValue
              : null;
    const allowedFormats =
        kind === 'import'
            ? [
                  'gongyu_json',
                  'netscape_html',
                  'shaarli_api',
                  'shaarli_datastore',
              ]
            : kind === 'export'
              ? ['gongyu_json', 'netscape_html']
              : ['full_backup'];
    if (format === null || !allowedFormats.includes(format)) {
        throw new Response('不支持的数据格式。', { status: 400 });
    }
    const modeValue = formData.get('mode');
    const mode =
        kind === 'restore' &&
        (modeValue === 'merge' || modeValue === 'replacement')
            ? modeValue
            : null;
    if (
        mode === 'replacement' &&
        formData.get('confirmation') !== 'REPLACE ALL DATA'
    ) {
        throw new Response('请输入 REPLACE ALL DATA 以确认替换。', {
            status: 400,
        });
    }
    const bytes = await sourceBytes(formData, intent);
    const runId = crypto.randomUUID();
    const sourceKey =
        bytes === null
            ? null
            : `${kind === 'restore' ? 'restores' : 'imports'}/${runId}/source`;
    let sourceReference: {
        etag: string;
        sha256: string;
        size: number;
    } | null = null;
    if (bytes !== null && sourceKey !== null) {
        const checksum = await digest(bytes);
        sourceReference = await effect.runPromise(
            Effect.gen(function* () {
                const r2 = yield* R2Store;
                const body = new Response(bytes.buffer as ArrayBuffer).body;
                if (body === null) {
                    return yield* Effect.die(
                        new Error('源文件不可读。'),
                    );
                }
                const object = yield* r2.putStream({
                    body,
                    contentLength: bytes.byteLength,
                    contentType: 'application/octet-stream',
                    key: sourceKey,
                });
                return {
                    etag: object.etag,
                    sha256: checksum,
                    size: object.size,
                };
            }),
        );
    }
    const now = Date.now() * 1_000;
    try {
        await effect.runPromise(
            Effect.gen(function* () {
                const repository = yield* DataRunRepository;
                yield* repository.createRun({
                    format,
                    id: runId,
                    kind,
                    mode,
                    now,
                    sourceEtag: sourceReference?.etag ?? null,
                    sourceKey,
                    sourceSha256: sourceReference?.sha256 ?? null,
                    sourceSize: sourceReference?.size ?? null,
                });
            }),
        );
    } catch (error) {
        if (sourceKey !== null) {
            await effect.runPromise(
                Effect.gen(function* () {
                    const r2 = yield* R2Store;
                    yield* r2.delete(sourceKey);
                }).pipe(Effect.ignore),
            );
        }
        if (error instanceof DataRunBusyError) {
            throw new Response('已有另一个数据操作正在运行。', {
                status: 409,
            });
        }
        throw error;
    }
    const payload: DataWorkflowPayload = {
        format: format as DataWorkflowPayload['format'],
        kind: kind as DataWorkflowPayload['kind'],
        mode,
        rpId: env.RP_ID,
        runId,
        sourceEtag: sourceReference?.etag ?? null,
        sourceKey,
        sourceSha256: sourceReference?.sha256 ?? null,
        sourceSize: sourceReference?.size ?? null,
        version: 1,
    };
    await startDataWorkflow(env.DATA_WORKFLOW, payload);
    return redirect('/admin/data');
}

async function startDataWorkflow(
    workflow: Env['DATA_WORKFLOW'],
    payload: DataWorkflowPayload,
): Promise<void> {
    const instanceId = `${payload.kind}-v1-${payload.runId}`;
    try {
        await workflow.create({
            id: instanceId,
            params: payload,
            retention: {
                errorRetention: '7 days',
                successRetention: '1 day',
            },
        });
    } catch (creationError) {
        try {
            const status = await (await workflow.get(instanceId)).status();
            if (status.status !== 'errored' && status.status !== 'terminated') {
                return;
            }
        } catch {
            throw creationError;
        }
        throw creationError;
    }
}

function formatDate(value: number): string {
    return new Date(Math.floor(value / 1_000)).toLocaleString('zh-CN', {
        timeZone: 'UTC',
    });
}

export default function AdminData({ loaderData }: Route.ComponentProps) {
    const rootData = useRouteLoaderData<typeof rootLoader>('root');
    const csrfToken = rootData?.csrfToken ?? '';
    const navigation = useNavigation();
    const isSubmitting = matchesFormSubmission(navigation, {
        action: '/admin/data',
        method: 'POST',
    });
    const revalidator = useRevalidator();
    const hasActiveOperations = loaderData.operations.some(({ run }) =>
        ['pending', 'running'].includes(run.state),
    );
    useEffect(() => {
        if (!hasActiveOperations) {
            return;
        }
        const refresh = () => {
            if (
                document.visibilityState === 'visible' &&
                revalidator.state === 'idle'
            ) {
                revalidator.revalidate();
            }
        };
        const interval = window.setInterval(refresh, 2_000);
        document.addEventListener('visibilitychange', refresh);
        window.addEventListener('focus', refresh);
        return () => {
            window.clearInterval(interval);
            document.removeEventListener('visibilitychange', refresh);
            window.removeEventListener('focus', refresh);
        };
    }, [hasActiveOperations, revalidator]);
    return (
        <AdminPage
            description="导入、导出、备份或恢复你的数据。"
            title="数据与恢复"
        >
            {isSubmitting ? (
                <Banner
                    description="在操作开始前请保持本页打开。"
                    title="正在启动数据操作"
                    variant="secondary"
                />
            ) : null}
            <div aria-busy={isSubmitting} className="grid gap-3 lg:grid-cols-2">
                <LayerCard>
                    <AdminPanelHeader
                        description="Gongyu JSON、Netscape HTML 或 Shaarli datastore。"
                        title="导入书签"
                    />
                    <Form encType="multipart/form-data" method="post">
                        <div className={adminPanelBodyClass}>
                            <input
                                name="_csrf"
                                type="hidden"
                                value={csrfToken}
                            />
                            <input name="intent" type="hidden" value="import" />
                            <AdminNativeField
                                htmlFor="import-format"
                                label="源格式"
                            >
                                <NativeSelect
                                    data={[
                                        {
                                            label: 'Gongyu JSON v1.0',
                                            value: 'gongyu_json',
                                        },
                                        {
                                            label: 'Netscape / Shaarli HTML',
                                            value: 'netscape_html',
                                        },
                                        {
                                            label: 'Shaarli datastore.php',
                                            value: 'shaarli_datastore',
                                        },
                                    ]}
                                    id="import-format"
                                    name="format"
                                />
                            </AdminNativeField>
                            <AdminNativeField
                                description="文件大小上限：10 MiB。"
                                htmlFor="import-file"
                                label="源文件"
                            >
                                <input
                                    className={adminFileInputClass}
                                    id="import-file"
                                    name="file"
                                    required
                                    type="file"
                                />
                            </AdminNativeField>
                        </div>
                        <div className={adminPanelFooterClass}>
                            <Button
                                disabled={isSubmitting}
                                type="submit"
                                variant="primary"
                            >
                                开始导入
                            </Button>
                        </div>
                    </Form>
                </LayerCard>

                <LayerCard>
                    <AdminPanelHeader
                        description="直接从现有 Shaarli 实例拉取书签。"
                        title="从 Shaarli API 导入"
                    />
                    <Form method="post">
                        <div className={adminPanelBodyClass}>
                            <input
                                name="_csrf"
                                type="hidden"
                                value={csrfToken}
                            />
                            <input
                                name="intent"
                                type="hidden"
                                value="import_api"
                            />
                            <input
                                name="format"
                                type="hidden"
                                value="shaarli_api"
                            />
                            <Input
                                id="shaarli-url"
                                label="Shaarli URL"
                                name="shaarli_url"
                                placeholder="https://links.example.com"
                                required
                                type="url"
                            />
                            <Input
                                id="shaarli-secret"
                                label="API 密钥"
                                minLength={12}
                                name="api_secret"
                                placeholder="API 密钥"
                                required
                                type="password"
                            />
                        </div>
                        <div className={adminPanelFooterClass}>
                            <Button
                                disabled={isSubmitting}
                                type="submit"
                                variant="primary"
                            >
                                拉取并导入
                            </Button>
                        </div>
                    </Form>
                </LayerCard>

                <LayerCard>
                    <AdminPanelHeader
                        description="生成可移植的下载文件，不改动你的书签库。"
                        title="可移植导出"
                    />
                    <div className="flex flex-wrap gap-2 p-4">
                        {[
                            ['gongyu_json', 'Gongyu JSON v1.0'],
                            ['netscape_html', 'Netscape HTML'],
                        ].map(([format, label]) => (
                            <Form key={format} method="post">
                                <input
                                    name="_csrf"
                                    type="hidden"
                                    value={csrfToken}
                                />
                                <input
                                    name="intent"
                                    type="hidden"
                                    value="export"
                                />
                                <input
                                    name="format"
                                    type="hidden"
                                    value={format}
                                />
                                <Button
                                    disabled={isSubmitting}
                                    size="sm"
                                    type="submit"
                                    variant="secondary"
                                >
                                    生成 {label}
                                </Button>
                            </Form>
                        ))}
                    </div>
                </LayerCard>

                <LayerCard>
                    <AdminPanelHeader
                        description="包含书签、设置、通行密钥、配置和镜像缩略图。24 小时后过期。"
                        title="完整备份"
                    />
                    <div className="p-4">
                        <Form method="post">
                            <input
                                name="_csrf"
                                type="hidden"
                                value={csrfToken}
                            />
                            <input name="intent" type="hidden" value="backup" />
                            <Button
                                disabled={isSubmitting}
                                size="sm"
                                type="submit"
                                variant="secondary"
                            >
                                创建完整备份
                            </Button>
                        </Form>
                    </div>
                </LayerCard>

                <LayerCard className="lg:col-span-2">
                    <AdminPanelHeader
                        description="将备份合并到此书签库，或显式替换所有现有数据。"
                        title="恢复完整备份"
                    />
                    <Form encType="multipart/form-data" method="post">
                        <div className={adminPanelBodyClass}>
                            <input
                                name="_csrf"
                                type="hidden"
                                value={csrfToken}
                            />
                            <input
                                name="intent"
                                type="hidden"
                                value="restore"
                            />
                            <div className="grid gap-3 sm:grid-cols-2">
                                <AdminNativeField
                                    description="文件大小上限：16 MiB。"
                                    htmlFor="restore-file"
                                    label="完整备份文件"
                                >
                                    <input
                                        className={adminFileInputClass}
                                        id="restore-file"
                                        name="file"
                                        required
                                        type="file"
                                    />
                                </AdminNativeField>
                                <AdminNativeField
                                    htmlFor="restore-mode"
                                    label="恢复模式"
                                >
                                    <NativeSelect
                                        data={[
                                            { label: '合并', value: 'merge' },
                                            {
                                                label: '替换',
                                                value: 'replacement',
                                            },
                                        ]}
                                        id="restore-mode"
                                        name="mode"
                                    />
                                </AdminNativeField>
                            </div>
                            <Input
                                description="仅替换模式需要填写。"
                                id="restore-confirmation"
                                label="替换确认"
                                name="confirmation"
                                placeholder="Type REPLACE ALL DATA"
                            />
                        </div>
                        <div className={adminPanelFooterClass}>
                            <Button
                                disabled={isSubmitting}
                                type="submit"
                                variant="primary"
                            >
                                开始恢复
                            </Button>
                        </div>
                    </Form>
                </LayerCard>
            </div>

            <section className="space-y-3" aria-labelledby="runs-heading">
                <div>
                    <h2
                        className="text-lg font-semibold text-gongyu-default"
                        id="runs-heading"
                    >
                        最近操作
                    </h2>
                    <p className="mt-1 text-sm text-gongyu-subtle">
                        最近数据操作的进度与下载。
                    </p>
                </div>
                {loaderData.operations.length === 0 ? (
                    <LayerCard>
                        <Empty
                            description="导入、导出、备份和恢复记录会显示在这里。"
                            icon={
                                <DatabaseIcon
                                    aria-hidden="true"
                                    size={42}
                                    weight="duotone"
                                />
                            }
                            title="暂无数据操作"
                        />
                    </LayerCard>
                ) : (
                    <div className="grid gap-3 xl:grid-cols-2">
                        {loaderData.operations.map(({ errors, run }) => (
                            <LayerCard key={run.id}>
                                <article className="space-y-4 p-4">
                                    <div className="flex flex-col items-start gap-3 sm:flex-row sm:justify-between sm:gap-4">
                                        <div className="min-w-0">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <h3 className="font-semibold capitalize text-gongyu-default">
                                                    {run.kind.replace('_', ' ')}
                                                </h3>
                                                <StatusBadge
                                                    state={run.state}
                                                />
                                            </div>
                                            <p className="mt-1 truncate text-xs text-gongyu-subtle">
                                                {run.format ??
                                                    run.mode ??
                                                    '数据'}{' '}
                                                · {formatDate(run.createdAt)}
                                            </p>
                                        </div>
                                        {run.state === 'pending' ? (
                                            <Form method="post">
                                                <input
                                                    name="_csrf"
                                                    type="hidden"
                                                    value={csrfToken}
                                                />
                                                <input
                                                    name="intent"
                                                    type="hidden"
                                                    value="retry"
                                                />
                                                <input
                                                    name="run_id"
                                                    type="hidden"
                                                    value={run.id}
                                                />
                                                <Button
                                                    disabled={isSubmitting}
                                                    icon={ArrowClockwiseIcon}
                                                    size="sm"
                                                    type="submit"
                                                    variant="secondary"
                                                >
                                                    再次启动
                                                </Button>
                                            </Form>
                                        ) : null}
                                        {run.state === 'completed' &&
                                        run.artifactKey !== null &&
                                        run.expiresAt !== null &&
                                        run.expiresAt > loaderData.now ? (
                                            <LinkButton
                                                href={`/admin/data/${run.id}/download`}
                                                icon={DownloadSimpleIcon}
                                                reloadDocument
                                                size="sm"
                                                variant="secondary"
                                            >
                                                下载
                                            </LinkButton>
                                        ) : null}
                                    </div>

                                    {hasRowProgress(run.kind) ? (
                                        <>
                                            <OperationProgress
                                                label="已处理行数"
                                                processed={run.processedRows}
                                                total={run.totalRows}
                                            />

                                            <dl className="grid grid-cols-3 gap-2 text-center">
                                                <div className="rounded-md border border-gongyu-line p-2">
                                                    <dt className="text-xs text-gongyu-subtle">
                                                        已导入
                                                    </dt>
                                                    <dd className="mt-1 font-semibold text-gongyu-default">
                                                        {run.importedRows}
                                                    </dd>
                                                </div>
                                                <div className="rounded-md border border-gongyu-line p-2">
                                                    <dt className="text-xs text-gongyu-subtle">
                                                        已跳过
                                                    </dt>
                                                    <dd className="mt-1 font-semibold text-gongyu-default">
                                                        {run.skippedRows}
                                                    </dd>
                                                </div>
                                                <div className="rounded-md border border-gongyu-line p-2">
                                                    <dt className="text-xs text-gongyu-subtle">
                                                        错误
                                                    </dt>
                                                    <dd className="mt-1 font-semibold text-gongyu-default">
                                                        {run.errorRows}
                                                    </dd>
                                                </div>
                                            </dl>
                                        </>
                                    ) : (
                                        <p className="rounded-md border border-gongyu-line bg-gongyu-fill px-3 py-2 text-sm text-gongyu-subtle">
                                            {artifactOperationStatus(
                                                run.kind,
                                                run.state,
                                            )}
                                        </p>
                                    )}

                                    {run.errorCode === null &&
                                    errors.length === 0 ? null : (
                                        <details className="border-t border-gongyu-line pt-4 text-sm">
                                            <summary className="cursor-pointer font-medium text-gongyu-danger">
                                                查看操作错误
                                            </summary>
                                            {run.errorCode === null ? null : (
                                                <p className="mt-3 font-mono text-xs text-gongyu-danger">
                                                    {run.errorCode}
                                                </p>
                                            )}
                                            {errors.length === 0 ? null : (
                                                <ul className="mt-3 max-h-40 space-y-2 overflow-auto text-xs text-gongyu-subtle">
                                                    {errors.map((error) => (
                                                        <li
                                                            key={`${error.rowIndex}:${error.code}`}
                                                        >
                                                            第{' '}
                                                            {error.rowIndex + 1}
                                                            {' '}行：{error.code} —{' '}
                                                            {error.message}
                                                        </li>
                                                    ))}
                                                </ul>
                                            )}
                                        </details>
                                    )}
                                </article>
                            </LayerCard>
                        ))}
                    </div>
                )}
            </section>
        </AdminPage>
    );
}
