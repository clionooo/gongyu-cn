import { WorkRepository } from '@gongyu/data/work-repository';
import {
    ArrowClockwiseIcon,
    CheckCircleIcon,
    QueueIcon,
    WarningIcon,
} from '@phosphor-icons/react';
import { Effect } from 'effect';
import {
    data,
    Form,
    Link,
    redirect,
    useNavigation,
    useRouteLoaderData,
} from 'react-router';
import {
    requireAuthenticatedMutation,
    requireAuthentication,
} from '../auth/session.server';
import { AdminPage } from '../components/admin-page';
import { StatusBadge } from '../components/status-badge';
import {
    Banner,
    Button,
    cn,
    Dialog,
    Empty,
    HydratedOnly,
    LayerCard,
} from '../components/ui';
import { submittedFormValue } from '../form-navigation';
import { cloudflareRequestContext } from '../platform-context';
import type { loader as rootLoader } from '../root';
import type { Route } from './+types/admin-jobs';

const filters = ['all', 'active', 'failed', 'completed'] as const;
type JobFilter = (typeof filters)[number];

function parseFilter(value: string | null): JobFilter {
    return filters.find((filter) => filter === value) ?? 'all';
}

function included(state: string, filter: JobFilter): boolean {
    if (filter === 'active') {
        return [
            'queued',
            'processing',
            'retrying',
            'waiting_metadata',
        ].includes(state);
    }
    if (filter === 'failed') {
        return ['failed', 'needs_review'].includes(state);
    }
    if (filter === 'completed') {
        return ['completed', 'delivered'].includes(state);
    }
    return true;
}

function formatDate(microseconds: number): string {
    return new Intl.DateTimeFormat('zh-CN', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'UTC',
    }).format(new Date(microseconds / 1_000));
}

export function meta(): Route.MetaDescriptors {
    return [{ title: '后台任务 · Gongyu' }];
}

export async function loader({ context, request }: Route.LoaderArgs) {
    const { authentication, effect } = context.get(cloudflareRequestContext);
    const url = new URL(request.url);
    if (!authentication.authenticated) {
        return redirect(`/login?returnTo=${encodeURIComponent(url.pathname)}`);
    }
    const jobs = await effect.runPromise(
        Effect.gen(function* () {
            const repository = yield* WorkRepository;
            return yield* repository.listJobs(100);
        }),
    );
    const filter = parseFilter(url.searchParams.get('state'));
    return {
        filter,
        jobs: jobs.filter((job) => included(job.state, filter)),
        summary: {
            active: jobs.filter((job) => included(job.state, 'active')).length,
            completed: jobs.filter((job) => included(job.state, 'completed'))
                .length,
            failed: jobs.filter((job) => included(job.state, 'failed')).length,
            total: jobs.length,
        },
        updated: url.searchParams.get('updated'),
    };
}

export async function action({ context, request }: Route.ActionArgs) {
    const { authentication, effect, env } = context.get(
        cloudflareRequestContext,
    );
    requireAuthentication(authentication);
    await requireAuthenticatedMutation({
        authentication,
        expectedOrigin: env.RP_ORIGIN,
        request,
        requireWritable: true,
        runner: effect,
    });
    const formData = await request.formData();
    const jobId = formData.get('job_id');
    const intent = formData.get('intent');
    if (typeof jobId !== 'string' || jobId === '') {
        return data({ error: '请选择一个任务。' }, { status: 400 });
    }
    const changed = await effect.runPromise(
        Effect.gen(function* () {
            const repository = yield* WorkRepository;
            const now = Date.now() * 1_000;
            return intent === 'mark_delivered'
                ? yield* repository.resolveReviewedTwitter(jobId, now)
                : yield* repository.retryJob(jobId, now);
        }),
    );
    if (!changed) {
        return data(
            { error: '当前状态下此任务无法恢复。' },
            { status: 409 },
        );
    }
    return redirect(
        `/admin/jobs?updated=${intent === 'mark_delivered' ? 'delivered' : 'retried'}`,
    );
}

function TwitterReviewChoices({
    csrfToken,
    disabled,
    jobId,
    pendingIntent,
}: {
    readonly csrfToken: string;
    readonly disabled: boolean;
    readonly jobId: string;
    readonly pendingIntent: string | null;
}) {
    return (
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Form method="post">
                <input name="_csrf" type="hidden" value={csrfToken} />
                <input name="job_id" type="hidden" value={jobId} />
                <input name="intent" type="hidden" value="mark_delivered" />
                <Button
                    className="w-full"
                    disabled={disabled}
                    icon={CheckCircleIcon}
                    loading={pendingIntent === 'mark_delivered'}
                    type="submit"
                    variant="secondary"
                >
                    标记为已投递
                </Button>
            </Form>
            <Form method="post">
                <input name="_csrf" type="hidden" value={csrfToken} />
                <input name="job_id" type="hidden" value={jobId} />
                <input name="intent" type="hidden" value="retry" />
                <Button
                    className="w-full"
                    disabled={disabled}
                    icon={ArrowClockwiseIcon}
                    loading={pendingIntent === 'retry'}
                    type="submit"
                    variant="destructive"
                >
                    仍要重试
                </Button>
            </Form>
        </div>
    );
}

function RecoveryActions({
    csrfToken,
    disabled,
    job,
    pendingIntent,
    pendingJobId,
}: {
    readonly csrfToken: string;
    readonly disabled: boolean;
    readonly job: {
        readonly id: string;
        readonly state: string;
    };
    readonly pendingIntent: string | null;
    readonly pendingJobId: string | null;
}) {
    const processingIntent = pendingJobId === job.id ? pendingIntent : null;
    if (job.state === 'needs_review') {
        return (
            <>
                <HydratedOnly>
                    <Dialog.Root role="alertdialog">
                        <Dialog.Trigger
                            render={
                                <Button
                                    disabled={disabled}
                                    icon={WarningIcon}
                                    size="sm"
                                    variant="secondary"
                                />
                            }
                        >
                            审核
                        </Dialog.Trigger>
                        <Dialog className="space-y-5 p-6" size="lg">
                            <div className="space-y-2">
                                <Dialog.Title>
                                    Twitter 投递结果不明确
                                </Dialog.Title>
                                <Dialog.Description>
                                    请求失败前 Twitter
                                    可能已接收了这条帖子。重试可能会造成重复发布。
                                </Dialog.Description>
                            </div>
                            <TwitterReviewChoices
                                csrfToken={csrfToken}
                                disabled={disabled}
                                jobId={job.id}
                                pendingIntent={processingIntent}
                            />
                        </Dialog>
                    </Dialog.Root>
                </HydratedOnly>
                <noscript>
                    <div className="space-y-3 rounded-lg border border-gongyu-line p-3">
                        <p className="text-sm leading-6 text-gongyu-default">
                            Twitter 可能已接收这条帖子。请选择标记为已投递，或冒着重复风险重试。
                        </p>
                        <TwitterReviewChoices
                            csrfToken={csrfToken}
                            disabled={false}
                            jobId={job.id}
                            pendingIntent={null}
                        />
                    </div>
                </noscript>
            </>
        );
    }
    return (
        <Form method="post">
            <input name="_csrf" type="hidden" value={csrfToken} />
            <input name="job_id" type="hidden" value={job.id} />
            <input name="intent" type="hidden" value="retry" />
            <Button
                disabled={disabled}
                icon={ArrowClockwiseIcon}
                loading={processingIntent === 'retry'}
                size="sm"
                type="submit"
                variant="secondary"
            >
                重试
            </Button>
        </Form>
    );
}

export default function AdminJobs({
    actionData,
    loaderData,
}: Route.ComponentProps) {
    const rootData = useRouteLoaderData<typeof rootLoader>('root');
    const csrfToken = rootData?.csrfToken ?? '';
    const navigation = useNavigation();
    const pendingJobId = submittedFormValue(
        navigation,
        { action: '/admin/jobs', method: 'POST' },
        'job_id',
    );
    const pendingIntent = submittedFormValue(
        navigation,
        { action: '/admin/jobs', method: 'POST' },
        'intent',
    );
    return (
        <AdminPage
            description="查看元数据、缩略图和社交分享任务。"
            title="后台任务"
        >
            {actionData?.error === undefined ? null : (
                <Banner
                    description={actionData.error}
                    title="任务更新失败"
                    variant="error"
                />
            )}
            {loaderData.updated === null ? null : (
                <Banner
                    description={
                        loaderData.updated === 'delivered'
                            ? '已在不再请求平台的情况下解决了不明确的投递。'
                            : '任务已排队等待重试。'
                    }
                    title="任务已更新"
                    variant="secondary"
                />
            )}

            <LayerCard className="overflow-hidden">
                <nav
                    aria-label="后台任务筛选"
                    className="flex gap-1 overflow-x-auto border-b border-gongyu-line"
                >
                    {[
                        ['全部', loaderData.summary.total, 'all'],
                        ['进行中', loaderData.summary.active, 'active'],
                        [
                            '需要关注',
                            loaderData.summary.failed,
                            'failed',
                        ],
                        [
                            '已完成',
                            loaderData.summary.completed,
                            'completed',
                        ],
                    ].map(([label, count, value]) => (
                        <Link
                            aria-current={
                                loaderData.filter === value ? 'page' : undefined
                            }
                            className={cn(
                                'flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm',
                                loaderData.filter === value
                                    ? 'border-gongyu-brand font-medium text-gongyu-default'
                                    : 'border-transparent text-gongyu-subtle hover:text-gongyu-default',
                            )}
                            key={value}
                            to={
                                value === 'all'
                                    ? '/admin/jobs'
                                    : `/admin/jobs?state=${value}`
                            }
                        >
                            {label}
                            <span className="rounded-full bg-gongyu-tint px-1.5 py-0.5 text-xs tabular-nums">
                                {count}
                            </span>
                        </Link>
                    ))}
                </nav>

                {loaderData.jobs.length === 0 ? (
                    <Empty
                        description="符合筛选条件的后台活动会显示在这里。"
                        icon={
                            <QueueIcon
                                aria-hidden="true"
                                size={42}
                                weight="duotone"
                            />
                        }
                        title="暂无后台任务"
                    />
                ) : (
                    <>
                        <div className="hidden grid-cols-[minmax(0,1fr)_7rem_4rem_9rem_8rem] gap-3 bg-gongyu-tint/45 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-gongyu-subtle md:grid">
                            <span>任务</span>
                            <span>状态</span>
                            <span>尝试</span>
                            <span>更新时间</span>
                            <span className="text-right">恢复</span>
                        </div>
                        <ol className="hidden divide-y divide-gongyu-line md:block">
                            {loaderData.jobs.map((job) => (
                                <li
                                    className="grid grid-cols-[minmax(0,1fr)_7rem_4rem_9rem_8rem] items-center gap-3 px-3 py-2"
                                    key={job.id}
                                >
                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-medium text-gongyu-default">
                                            {job.kind.replace(':', ' · ')}
                                            <span className="text-xs font-normal text-gongyu-subtle">
                                                {' '}
                                                · {job.bookmarkShortUrl}
                                            </span>
                                        </p>
                                        <Link
                                            className="block truncate text-xs text-gongyu-link"
                                            title={job.bookmarkUrl}
                                            to={`/b/${job.bookmarkShortUrl}`}
                                        >
                                            {job.bookmarkUrl}
                                        </Link>
                                        {job.lastErrorCode === null ? null : (
                                            <p className="mt-0.5 truncate font-mono text-xs text-gongyu-danger">
                                                {job.lastErrorCode}
                                            </p>
                                        )}
                                    </div>
                                    <StatusBadge state={job.state} />
                                    <span className="text-sm tabular-nums text-gongyu-subtle">
                                        {job.attempts}
                                    </span>
                                    <time className="whitespace-nowrap text-xs text-gongyu-subtle">
                                        {formatDate(job.updatedAt)}
                                    </time>
                                    <div className="flex justify-end">
                                        {job.recoverable === 1 &&
                                        ['failed', 'needs_review'].includes(
                                            job.state,
                                        ) ? (
                                            <RecoveryActions
                                                csrfToken={csrfToken}
                                                disabled={
                                                    pendingJobId === job.id
                                                }
                                                job={job}
                                                pendingIntent={pendingIntent}
                                                pendingJobId={pendingJobId}
                                            />
                                        ) : (
                                            <span className="text-xs text-gongyu-subtle">
                                                —
                                            </span>
                                        )}
                                    </div>
                                </li>
                            ))}
                        </ol>
                        <ol className="divide-y divide-gongyu-line md:hidden">
                            {loaderData.jobs.map((job) => (
                                <li className="space-y-3 p-3" key={job.id}>
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <p className="truncate font-medium text-gongyu-default">
                                                {job.kind.replace(':', ' · ')}
                                                <span className="text-xs font-normal text-gongyu-subtle">
                                                    {' '}
                                                    · {job.bookmarkShortUrl}
                                                </span>
                                            </p>
                                            <Link
                                                className="block truncate text-xs text-gongyu-link"
                                                title={job.bookmarkUrl}
                                                to={`/b/${job.bookmarkShortUrl}`}
                                            >
                                                {job.bookmarkUrl}
                                            </Link>
                                            <p className="mt-1 text-xs text-gongyu-subtle">
                                                {formatDate(job.updatedAt)} ·
                                                尝试 {job.attempts} 次
                                            </p>
                                        </div>
                                        <StatusBadge state={job.state} />
                                    </div>
                                    {job.lastErrorCode === null ? null : (
                                        <p className="font-mono text-xs text-gongyu-danger">
                                            {job.lastErrorCode}
                                        </p>
                                    )}
                                    {job.recoverable === 1 &&
                                    ['failed', 'needs_review'].includes(
                                        job.state,
                                    ) ? (
                                        <RecoveryActions
                                            csrfToken={csrfToken}
                                            disabled={pendingJobId === job.id}
                                            job={job}
                                            pendingIntent={pendingIntent}
                                            pendingJobId={pendingJobId}
                                        />
                                    ) : null}
                                </li>
                            ))}
                        </ol>
                    </>
                )}
            </LayerCard>
        </AdminPage>
    );
}
