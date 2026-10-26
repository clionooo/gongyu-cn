import { BookmarkRepository } from '@gongyu/data/bookmark-repository';
import {
    ArrowSquareOutIcon,
    BookmarkSimpleIcon,
    MagnifyingGlassIcon,
    PencilSimpleIcon,
    PlusIcon,
    TrashIcon,
} from '@phosphor-icons/react';
import { Effect } from 'effect';
import {
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
import {
    type BookmarkView,
    BookmarkViewSwitch,
    parseBookmarkView,
} from '../bookmarks/bookmark-view-switch';
import { AdminPage } from '../components/admin-page';
import { adminNativeControlClass } from '../components/admin-panel';
import {
    Banner,
    Button,
    cn,
    Dialog,
    Empty,
    HydratedOnly,
    Input,
    LayerCard,
    LinkButton,
} from '../components/ui';
import { matchesFormSubmission } from '../form-navigation';
import { cloudflareRequestContext } from '../platform-context';
import type { loader as rootLoader } from '../root';
import type { Route } from './+types/admin-bookmarks';

export function meta(): Route.MetaDescriptors {
    return [{ title: '书签 · Gongyu' }];
}

export async function loader({ context, request }: Route.LoaderArgs) {
    const { authentication, effect } = context.get(cloudflareRequestContext);
    const location = new URL(request.url);
    if (!authentication.authenticated) {
        return redirect(
            `/login?returnTo=${encodeURIComponent(`${location.pathname}${location.search}`)}`,
        );
    }
    const query = location.searchParams.get('q')?.trim() ?? '';
    const view = parseBookmarkView(location.searchParams.get('view'));
    const pageValue = Number.parseInt(
        location.searchParams.get('page') ?? '1',
        10,
    );
    const page = Number.isFinite(pageValue) ? Math.max(1, pageValue) : 1;
    const result = await effect.runPromise(
        Effect.gen(function* () {
            const bookmarks = yield* BookmarkRepository;
            return yield* bookmarks.list({
                page,
                perPage: view === 'list' ? 30 : 24,
                query,
            });
        }),
    );
    return {
        deletedAll: location.searchParams.get('deleted') === 'all',
        query,
        result,
        view,
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
    if (formData.get('confirmation') !== 'DELETE ALL BOOKMARKS') {
        return { error: '请准确输入 DELETE ALL BOOKMARKS 以确认。' };
    }
    await effect.runPromise(
        Effect.gen(function* () {
            const bookmarks = yield* BookmarkRepository;
            yield* bookmarks.removeAll(Date.now() * 1_000);
        }),
    );
    return redirect('/admin/bookmarks?deleted=all');
}

function formatDate(microseconds: number): string {
    return new Intl.DateTimeFormat('zh-CN', {
        dateStyle: 'medium',
        timeZone: 'UTC',
    }).format(new Date(microseconds / 1_000));
}

function paginationHref(
    query: string,
    page: number,
    view: BookmarkView,
): string {
    const parameters = new URLSearchParams();
    if (query !== '') {
        parameters.set('q', query);
    }
    parameters.set('page', String(page));
    parameters.set('view', view);
    return `/admin/bookmarks?${parameters.toString()}`;
}

interface AdminBookmark {
    readonly createdAt: number;
    readonly description: string | null;
    readonly id: number;
    readonly shortUrl: string;
    readonly thumbnailSha256: string | null;
    readonly title: string;
    readonly url: string;
}

function AdminBookmarkList({
    bookmarks,
}: {
    readonly bookmarks: ReadonlyArray<AdminBookmark>;
}) {
    return (
        <>
            <div className="hidden grid-cols-[minmax(0,1fr)_minmax(8rem,12rem)_7.5rem_4.5rem] gap-3 bg-gongyu-tint/45 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-gongyu-subtle md:grid">
                <span>书签</span>
                <span>来源</span>
                <span>保存时间</span>
                <span className="text-right">操作</span>
            </div>
            <ol
                aria-label="列表视图中的书签"
                className="divide-y divide-gongyu-line"
            >
                {bookmarks.map((bookmark) => {
                    const hostname = new URL(bookmark.url).hostname.replace(
                        /^www\./u,
                        '',
                    );
                    return (
                        <li
                            className="group px-3 py-1.5 transition-colors hover:bg-gongyu-tint/35"
                            key={bookmark.id}
                        >
                            <div
                                className="hidden grid-cols-[minmax(0,1fr)_minmax(8rem,12rem)_7.5rem_4.5rem] items-center gap-3 md:grid"
                                data-bookmark-row=""
                            >
                                <div
                                    className="min-w-0"
                                    data-bookmark-column="bookmark"
                                >
                                    <Link
                                        className="block truncate text-sm font-medium text-gongyu-default hover:text-gongyu-link"
                                        to={`/admin/bookmarks/${bookmark.shortUrl}/edit`}
                                    >
                                        {bookmark.title}
                                    </Link>
                                    {bookmark.description === null ? null : (
                                        <p className="truncate text-[11px] text-gongyu-subtle">
                                            {bookmark.description}
                                        </p>
                                    )}
                                </div>
                                <span
                                    className="truncate text-xs text-gongyu-subtle"
                                    data-bookmark-column="source"
                                    title={hostname}
                                >
                                    {hostname}
                                </span>
                                <time
                                    className="whitespace-nowrap text-xs tabular-nums text-gongyu-subtle"
                                    data-bookmark-column="saved"
                                >
                                    {formatDate(bookmark.createdAt)}
                                </time>
                                <div
                                    className="flex justify-end gap-0.5"
                                    data-bookmark-column="actions"
                                >
                                    <LinkButton
                                        aria-label={`打开 ${bookmark.title}`}
                                        external
                                        href={bookmark.url}
                                        icon={ArrowSquareOutIcon}
                                        shape="square"
                                        size="sm"
                                        variant="ghost"
                                    />
                                    <LinkButton
                                        aria-label={`编辑 ${bookmark.title}`}
                                        href={`/admin/bookmarks/${bookmark.shortUrl}/edit`}
                                        icon={PencilSimpleIcon}
                                        shape="square"
                                        size="sm"
                                        variant="ghost"
                                    />
                                </div>
                            </div>
                            <div className="flex items-start justify-between gap-3 md:hidden">
                                <div className="min-w-0">
                                    <Link
                                        className="line-clamp-2 text-sm font-medium text-gongyu-default"
                                        to={`/admin/bookmarks/${bookmark.shortUrl}/edit`}
                                    >
                                        {bookmark.title}
                                    </Link>
                                    <p className="mt-0.5 truncate text-[11px] text-gongyu-subtle">
                                        {hostname} ·{' '}
                                        {formatDate(bookmark.createdAt)}
                                    </p>
                                </div>
                                <LinkButton
                                    aria-label={`编辑 ${bookmark.title}`}
                                    href={`/admin/bookmarks/${bookmark.shortUrl}/edit`}
                                    icon={PencilSimpleIcon}
                                    shape="square"
                                    size="sm"
                                    variant="ghost"
                                />
                            </div>
                        </li>
                    );
                })}
            </ol>
        </>
    );
}

function AdminBookmarkGallery({
    bookmarks,
}: {
    readonly bookmarks: ReadonlyArray<AdminBookmark>;
}) {
    return (
        <ol
            aria-label="画廊视图中的书签"
            className="grid gap-2 p-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        >
            {bookmarks.map((bookmark) => {
                const hostname = new URL(bookmark.url).hostname.replace(
                    /^www\./u,
                    '',
                );
                return (
                    <li
                        className="group overflow-hidden rounded-lg border border-gongyu-line bg-gongyu-base"
                        key={bookmark.id}
                    >
                        <Link
                            aria-label={`编辑 ${bookmark.title}`}
                            className="block aspect-[16/9] overflow-hidden bg-gongyu-tint"
                            to={`/admin/bookmarks/${bookmark.shortUrl}/edit`}
                        >
                            {bookmark.thumbnailSha256 === null ? (
                                <span className="flex size-full items-center justify-center">
                                    <BookmarkSimpleIcon
                                        aria-hidden="true"
                                        className="text-gongyu-subtle/45"
                                        size={30}
                                        weight="duotone"
                                    />
                                </span>
                            ) : (
                                <img
                                    alt=""
                                    className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                                    loading="lazy"
                                    src={`/thumbnails/${bookmark.shortUrl}/${bookmark.thumbnailSha256}`}
                                />
                            )}
                        </Link>
                        <div className="p-2.5">
                            <Link
                                className="block truncate text-sm font-semibold text-gongyu-default hover:text-gongyu-link"
                                to={`/admin/bookmarks/${bookmark.shortUrl}/edit`}
                            >
                                {bookmark.title}
                            </Link>
                            <p className="mt-1 truncate text-[11px] text-gongyu-subtle">
                                {hostname} · {formatDate(bookmark.createdAt)}
                            </p>
                            <div className="mt-2 flex justify-end gap-0.5 border-t border-gongyu-line pt-1.5">
                                <LinkButton
                                    aria-label={`打开 ${bookmark.title}`}
                                    external
                                    href={bookmark.url}
                                    icon={ArrowSquareOutIcon}
                                    shape="square"
                                    size="sm"
                                    variant="ghost"
                                />
                                <LinkButton
                                    aria-label={`编辑 ${bookmark.title}`}
                                    href={`/admin/bookmarks/${bookmark.shortUrl}/edit`}
                                    icon={PencilSimpleIcon}
                                    shape="square"
                                    size="sm"
                                    variant="ghost"
                                />
                            </div>
                        </div>
                    </li>
                );
            })}
        </ol>
    );
}

export default function AdminBookmarks({
    actionData,
    loaderData,
}: Route.ComponentProps) {
    const rootData = useRouteLoaderData<typeof rootLoader>('root');
    const csrfToken = rootData?.csrfToken ?? '';
    const navigation = useNavigation();
    const isSearching = matchesFormSubmission(navigation, {
        action: '/admin/bookmarks',
        method: 'GET',
    });
    const isDeleting = matchesFormSubmission(navigation, {
        action: '/admin/bookmarks',
        method: 'POST',
    });
    const isSubmitting = isSearching || isDeleting;
    const { result } = loaderData;
    return (
        <AdminPage
            actions={
                <LinkButton
                    href="/admin/bookmarks/new"
                    icon={PlusIcon}
                    size="sm"
                    variant="primary"
                >
                    新建书签
                </LinkButton>
            }
            description={`个人书签库中共有 ${result.total.toLocaleString('zh-CN')} 个书签。`}
            title="书签"
        >
            {loaderData.deletedAll ? (
                <Banner
                    description="后台清理会安全移除已镜像的缩略图。"
                    title="所有书签已加入删除队列"
                    variant="secondary"
                />
            ) : null}

            <LayerCard className="overflow-hidden">
                <div className="flex flex-col gap-2 border-b border-gongyu-line p-2 sm:flex-row sm:items-center sm:justify-between">
                    <Form
                        className="flex w-full min-w-0 gap-2 sm:max-w-lg"
                        method="get"
                    >
                        <input
                            name="view"
                            type="hidden"
                            value={loaderData.view}
                        />
                        <Input
                            aria-label="搜索书签"
                            className="min-w-0 flex-1"
                            defaultValue={loaderData.query}
                            name="q"
                            placeholder="搜索标题、备注或 URL…"
                            type="search"
                        />
                        <Button
                            disabled={isSubmitting}
                            icon={MagnifyingGlassIcon}
                            loading={isSearching}
                            size="sm"
                            type="submit"
                            variant="secondary"
                        >
                            搜索
                        </Button>
                    </Form>
                    <div className="flex items-center gap-1.5">
                        {loaderData.query === '' ? null : (
                            <LinkButton
                                href={`/admin/bookmarks?view=${loaderData.view}`}
                                size="sm"
                                variant="ghost"
                            >
                                清除
                            </LinkButton>
                        )}
                        <BookmarkViewSwitch
                            basePath="/admin/bookmarks"
                            query={loaderData.query}
                            view={loaderData.view}
                        />
                    </div>
                </div>

                {result.bookmarks.length === 0 ? (
                    <Empty
                        contents={
                            loaderData.query === '' ? (
                                <LinkButton
                                    href="/admin/bookmarks/new"
                                    icon={PlusIcon}
                                    variant="primary"
                                >
                                    保存你的第一个链接
                                </LinkButton>
                            ) : (
                                <LinkButton
                                    href={`/admin/bookmarks?view=${loaderData.view}`}
                                    variant="secondary"
                                >
                                    清除搜索
                                </LinkButton>
                            )
                        }
                        description={
                            loaderData.query === ''
                                ? '创建书签，开始建立你的书签库。'
                                : '试试更宽泛的关键词，或按来源域名搜索。'
                        }
                        icon={
                            <BookmarkSimpleIcon
                                aria-hidden="true"
                                size={36}
                                weight="duotone"
                            />
                        }
                        title={
                            loaderData.query === ''
                                ? '还没有书签'
                                : '没有匹配的书签'
                        }
                    />
                ) : loaderData.view === 'gallery' ? (
                    <AdminBookmarkGallery bookmarks={result.bookmarks} />
                ) : (
                    <AdminBookmarkList bookmarks={result.bookmarks} />
                )}
                {result.pageCount > 1 ? (
                    <nav
                        aria-label="书签分页"
                        className="flex items-center justify-between border-t border-gongyu-line px-3 py-2"
                    >
                        <p className="text-xs text-gongyu-subtle">
                            第 {result.page} / {result.pageCount} 页
                        </p>
                        <div className="flex gap-1.5">
                            <LinkButton
                                aria-disabled={result.page <= 1}
                                className={cn(
                                    result.page <= 1 &&
                                        'pointer-events-none opacity-50',
                                )}
                                href={paginationHref(
                                    loaderData.query,
                                    result.page - 1,
                                    loaderData.view,
                                )}
                                size="sm"
                                tabIndex={result.page <= 1 ? -1 : undefined}
                                variant="secondary"
                            >
                                上一页
                            </LinkButton>
                            <LinkButton
                                aria-disabled={result.page >= result.pageCount}
                                className={cn(
                                    result.page >= result.pageCount &&
                                        'pointer-events-none opacity-50',
                                )}
                                href={paginationHref(
                                    loaderData.query,
                                    result.page + 1,
                                    loaderData.view,
                                )}
                                size="sm"
                                tabIndex={
                                    result.page >= result.pageCount
                                        ? -1
                                        : undefined
                                }
                                variant="secondary"
                            >
                                下一页
                            </LinkButton>
                        </div>
                    </nav>
                ) : null}
            </LayerCard>

            <details
                className="border-t border-gongyu-line pt-2"
                open={actionData?.error !== undefined}
            >
                <summary className="cursor-pointer text-sm text-gongyu-danger hover:underline">
                    危险操作区
                </summary>
                {actionData?.error === undefined ? null : (
                    <div className="mt-3">
                        <Banner
                            description={actionData.error}
                            title="书签库未删除"
                            variant="error"
                        />
                    </div>
                )}
                <div className="mt-3 flex flex-col gap-3 rounded-lg bg-gongyu-danger-tint/30 p-3 ring ring-gongyu-danger/20 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h2 className="font-medium text-gongyu-default">
                            删除整个书签库
                        </h2>
                        <p className="mt-1 text-sm text-gongyu-subtle">
                            永久删除所有书签和镜像缩略图。
                        </p>
                    </div>
                    <HydratedOnly>
                        <Dialog.Root
                            defaultOpen={actionData?.error !== undefined}
                            role="alertdialog"
                        >
                            <Dialog.Trigger
                                render={
                                    <Button
                                        icon={TrashIcon}
                                        size="sm"
                                        variant="secondary-destructive"
                                    />
                                }
                            >
                                删除所有书签
                            </Dialog.Trigger>
                            <Dialog className="space-y-5 p-6" size="lg">
                                <div className="space-y-2">
                                    <Dialog.Title>
                                        删除所有书签？
                                    </Dialog.Title>
                                    <Dialog.Description>
                                        此操作无法撤销。输入 DELETE ALL
                                        BOOKMARKS 以确认。
                                    </Dialog.Description>
                                </div>
                                <Form className="space-y-4" method="post">
                                    <input
                                        name="_csrf"
                                        type="hidden"
                                        value={csrfToken}
                                    />
                                    <Input
                                        autoComplete="off"
                                        error={actionData?.error}
                                        label="确认短语"
                                        name="confirmation"
                                        placeholder="DELETE ALL BOOKMARKS"
                                    />
                                    <div className="flex justify-end gap-2">
                                        <Dialog.Close
                                            render={
                                                <Button variant="secondary" />
                                            }
                                        >
                                            取消
                                        </Dialog.Close>
                                        <Button
                                            disabled={isSubmitting}
                                            loading={isDeleting}
                                            type="submit"
                                            variant="destructive"
                                        >
                                            全部删除
                                        </Button>
                                    </div>
                                </Form>
                            </Dialog>
                        </Dialog.Root>
                    </HydratedOnly>
                </div>
                <noscript>
                    <Form className="mt-5 max-w-lg space-y-3" method="post">
                        <input name="_csrf" type="hidden" value={csrfToken} />
                        <label className="block space-y-2 text-sm font-medium text-gongyu-default">
                            <span>输入 DELETE ALL BOOKMARKS 以确认</span>
                            <input
                                className={adminNativeControlClass}
                                name="confirmation"
                            />
                        </label>
                        <Button type="submit" variant="destructive">
                            全部删除
                        </Button>
                    </Form>
                </noscript>
            </details>
        </AdminPage>
    );
}
