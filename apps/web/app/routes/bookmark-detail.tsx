import { BookmarkRepository } from '@gongyu/data/bookmark-repository';
import { PageShell } from '@gongyu/ui/page-shell';
import {
    ArrowLeftIcon,
    ArrowSquareOutIcon,
    BookmarkSimpleIcon,
    CalendarBlankIcon,
    PencilSimpleIcon,
} from '@phosphor-icons/react';
import { Effect } from 'effect';
import { useRouteLoaderData } from 'react-router';
import { Badge, Breadcrumbs, LayerCard, LinkButton } from '../components/ui';
import { cloudflareRequestContext } from '../platform-context';
import type { loader as rootLoader } from '../root';
import type { Route } from './+types/bookmark-detail';

export async function loader({ context, params, request }: Route.LoaderArgs) {
    const { effect } = context.get(cloudflareRequestContext);
    const bookmark = await effect.runPromise(
        Effect.gen(function* () {
            const bookmarks = yield* BookmarkRepository;
            return yield* bookmarks.findByShortUrl(params.shortUrl ?? '');
        }),
    );
    if (bookmark === null) {
        throw new Response('书签不存在', { status: 404 });
    }
    const canonicalUrl = new URL(`/b/${bookmark.shortUrl}`, request.url).href;
    return { bookmark, canonicalUrl };
}

export function meta({ loaderData }: Route.MetaArgs): Route.MetaDescriptors {
    if (loaderData === undefined) {
        return [{ title: '书签不存在 · Gongyu' }];
    }
    const description =
        loaderData.bookmark.description ?? loaderData.bookmark.url;
    return [
        { title: `${loaderData.bookmark.title} · Gongyu` },
        { name: 'description', content: description },
        { property: 'og:title', content: loaderData.bookmark.title },
        { property: 'og:description', content: description },
        { property: 'og:url', content: loaderData.canonicalUrl },
        { property: 'og:type', content: 'article' },
        { name: 'twitter:card', content: 'summary' },
        { name: 'twitter:title', content: loaderData.bookmark.title },
        { name: 'twitter:description', content: description },
        { tagName: 'link', rel: 'canonical', href: loaderData.canonicalUrl },
    ];
}

export default function BookmarkDetail({ loaderData }: Route.ComponentProps) {
    const { bookmark } = loaderData;
    const rootData = useRouteLoaderData<typeof rootLoader>('root');
    const date = new Intl.DateTimeFormat('zh-CN', {
        dateStyle: 'medium',
        timeZone: 'UTC',
    }).format(new Date(bookmark.createdAt / 1_000));
    const hostname = new URL(bookmark.url).hostname.replace(/^www\./u, '');
    return (
        <PageShell
            actions={
                <>
                    <LinkButton
                        external
                        href={bookmark.url}
                        icon={ArrowSquareOutIcon}
                        variant="primary"
                    >
                        打开原文
                    </LinkButton>
                    {rootData?.authenticated === true ? (
                        <LinkButton
                            href={`/admin/bookmarks/${bookmark.shortUrl}/edit`}
                            icon={PencilSimpleIcon}
                            variant="secondary"
                        >
                            编辑
                        </LinkButton>
                    ) : null}
                </>
            }
            breadcrumbs={
                <Breadcrumbs size="sm">
                    <Breadcrumbs.Link href="/">书签库</Breadcrumbs.Link>
                    <Breadcrumbs.Current>书签</Breadcrumbs.Current>
                </Breadcrumbs>
            }
            description="收录进书签库时附带的上下文信息。"
            eyebrow="书签详情"
            footer={
                <LinkButton
                    href="/"
                    icon={ArrowLeftIcon}
                    size="sm"
                    variant="ghost"
                >
                    返回书签库
                </LinkButton>
            }
            title={bookmark.title}
            width="wide"
        >
            <LayerCard className="overflow-hidden">
                <article className="grid lg:grid-cols-[minmax(18rem,32rem)_minmax(18rem,1fr)]">
                    <div className="min-h-64 bg-gongyu-tint lg:min-h-[30rem]">
                        {bookmark.thumbnailSha256 === null ? (
                            <div className="flex size-full min-h-64 items-center justify-center lg:min-h-[30rem]">
                                <BookmarkSimpleIcon
                                    aria-hidden="true"
                                    className="text-gongyu-subtle/40"
                                    size={72}
                                    weight="duotone"
                                />
                            </div>
                        ) : (
                            <img
                                alt=""
                                className="size-full max-h-[42rem] object-cover"
                                src={`/thumbnails/${bookmark.shortUrl}/${bookmark.thumbnailSha256}`}
                            />
                        )}
                    </div>
                    <div className="flex flex-col gap-7 border-t border-gongyu-line p-6 sm:p-8 lg:border-l lg:border-t-0">
                        <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="secondary">{hostname}</Badge>
                            <Badge appearance="dot" variant="info">
                                已保存的链接
                            </Badge>
                        </div>
                        {bookmark.description === null ? (
                            <p className="text-sm leading-6 text-gongyu-subtle">
                                这个书签没有附加备注。
                            </p>
                        ) : (
                            <p className="whitespace-pre-wrap text-base leading-7 text-gongyu-default">
                                {bookmark.description}
                            </p>
                        )}
                        <dl className="mt-auto space-y-4 border-t border-gongyu-line pt-6 text-sm">
                            <div className="flex items-start gap-3">
                                <CalendarBlankIcon
                                    aria-hidden="true"
                                    className="mt-0.5 shrink-0 text-gongyu-subtle"
                                    size={18}
                                />
                                <div>
                                    <dt className="font-medium text-gongyu-default">
                                        保存时间
                                    </dt>
                                    <dd className="text-gongyu-subtle">
                                        {date}
                                    </dd>
                                </div>
                            </div>
                            <div>
                                <dt className="mb-1 font-medium text-gongyu-default">
                                    原始 URL
                                </dt>
                                <dd>
                                    <a
                                        className="break-all text-gongyu-link"
                                        href={bookmark.url}
                                        rel="noreferrer"
                                        target="_blank"
                                    >
                                        {bookmark.url}
                                    </a>
                                </dd>
                            </div>
                        </dl>
                    </div>
                </article>
            </LayerCard>
        </PageShell>
    );
}
