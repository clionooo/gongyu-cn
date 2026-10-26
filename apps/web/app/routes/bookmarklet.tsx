import { BookmarkRepository } from '@gongyu/data/bookmark-repository';
import { SettingsRepository } from '@gongyu/data/settings-repository';
import {
    BookmarkValidationError,
    DuplicateBookmarkError,
    decodeBookmarkInput,
} from '@gongyu/domain/bookmarks';
import {
    configuredProviders,
    twitterWebIntentUrl,
} from '@gongyu/domain/social';
import { cleanMetadataTitle } from '@gongyu/integrations/metadata-client';
import { dispatchBookmarkOutboxBestEffort } from '@gongyu/jobs/outbox-dispatcher';
import {
    ArrowSquareOutIcon,
    BookmarkSimpleIcon,
    CheckCircleIcon,
    FloppyDiskIcon,
} from '@phosphor-icons/react';
import { Effect } from 'effect';
import { useEffect, useRef, useState } from 'react';
import {
    data,
    Form,
    redirect,
    useNavigation,
    useRouteLoaderData,
} from 'react-router';
import {
    requireAuthenticatedMutation,
    requireAuthentication,
} from '../auth/session.server';
import { bookmarkletCode } from '../bookmarklet-code';
import { MetadataPreview } from '../bookmarks/metadata-preview';
import { AdminPage } from '../components/admin-page';
import {
    adminPanelBodyClass,
    adminPanelFooterClass,
} from '../components/admin-panel';
import {
    Button,
    Checkbox,
    Input,
    InputArea,
    LayerCard,
    LinkButton,
} from '../components/ui';
import { failure, success } from '../effect/result';
import { matchesFormSubmission } from '../form-navigation';
import { cloudflareRequestContext } from '../platform-context';
import type { loader as rootLoader } from '../root';
import type { Route } from './+types/bookmarklet';

export function meta(): Route.MetaDescriptors {
    return [{ title: 'Bookmarklet · Gongyu' }];
}

export async function loader({ context, request }: Route.LoaderArgs) {
    const { authentication, effect } = context.get(cloudflareRequestContext);
    const location = new URL(request.url);
    if (!authentication.authenticated) {
        return redirect(
            `/login?returnTo=${encodeURIComponent(`${location.pathname}${location.search}`)}`,
        );
    }
    const url = location.searchParams.get('url') ?? '';
    const providers = await effect.runPromise(
        Effect.gen(function* () {
            const settings = yield* SettingsRepository;
            const current = yield* settings.get;
            return [
                ...configuredProviders(current),
                ...(current.twitterDeliveryMode === 'manual'
                    ? ['X（手动）']
                    : []),
            ];
        }),
    );
    const existing =
        url === ''
            ? null
            : await effect.runPromise(
                  Effect.gen(function* () {
                      const bookmarks = yield* BookmarkRepository;
                      return yield* bookmarks.findByUrl(url);
                  }),
              );
    return {
        existing,
        installCode: bookmarkletCode(location.origin),
        prefill: {
            description: location.searchParams.get('description') ?? '',
            source: location.searchParams.get('source') ?? '',
            title: cleanMetadataTitle(location.searchParams.get('title') ?? ''),
            url,
        },
        providers,
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
    const value = (name: string) => {
        const field = formData.get(name);
        return typeof field === 'string' ? field : '';
    };
    const input = {
        description: value('description') === '' ? null : value('description'),
        title: value('title').trim(),
        url: value('url'),
    };
    const source = value('source');
    const shareSocial = formData.get('share_social') === 'on';
    const result = await effect.runPromise(
        Effect.gen(function* () {
            const decoded = yield* decodeBookmarkInput(input);
            const bookmarks = yield* BookmarkRepository;
            const settings = yield* SettingsRepository;
            const currentSettings = yield* settings.get;
            const socialProviders = shareSocial
                ? configuredProviders(currentSettings)
                : [];
            const twitterIntentUrl =
                shareSocial && currentSettings.twitterDeliveryMode === 'manual'
                    ? twitterWebIntentUrl({
                          originalUrl: decoded.url,
                          title: decoded.title,
                      })
                    : null;
            const bookmark = yield* bookmarks.create({
                ...decoded,
                createdAt: Date.now() * 1_000,
                socialProviders,
            });
            yield* dispatchBookmarkOutboxBestEffort({
                bookmarkShortUrl: bookmark.shortUrl,
                kind: 'metadata',
            });
            return { bookmark, twitterIntentUrl };
        }).pipe(Effect.match({ onFailure: failure, onSuccess: success })),
    );
    if (result.ok) {
        return data({
            saved: true,
            source,
            twitterIntentUrl: result.value.twitterIntentUrl,
        });
    }
    if (result.error instanceof DuplicateBookmarkError) {
        return data(
            {
                errors: { url: '该 URL 已被收藏。' },
                input,
                source,
            },
            { status: 409 },
        );
    }
    if (result.error instanceof BookmarkValidationError) {
        return data(
            {
                errors: { [result.error.field]: result.error.message },
                input,
                source,
            },
            { status: 400 },
        );
    }
    throw result.error;
}

export default function Bookmarklet({
    actionData,
    loaderData,
}: Route.ComponentProps) {
    const rootData = useRouteLoaderData<typeof rootLoader>('root');
    const csrfToken = rootData?.csrfToken ?? '';
    const isSubmitting = matchesFormSubmission(useNavigation(), {
        action: '/bookmarklet',
        method: 'POST',
    });
    const installLink = useRef<HTMLAnchorElement>(null);
    const values =
        actionData !== undefined && 'input' in actionData
            ? actionData.input
            : loaderData.prefill;
    const source = actionData?.source ?? loaderData.prefill.source;
    const errors =
        actionData !== undefined && 'errors' in actionData
            ? actionData.errors
            : {};
    const saved = actionData !== undefined && 'saved' in actionData;
    const twitterIntentUrl =
        actionData !== undefined && 'saved' in actionData
            ? actionData.twitterIntentUrl
            : null;
    const urlError = 'url' in errors ? errors.url : undefined;
    const titleError = 'title' in errors ? errors.title : undefined;
    const [url, setUrl] = useState(values.url ?? '');
    const [title, setTitle] = useState(values.title ?? '');
    const [description, setDescription] = useState(values.description ?? '');
    const [shareSocial, setShareSocial] = useState(true);

    useEffect(() => {
        if (installLink.current !== null) {
            installLink.current.href = loaderData.installCode;
        }
    }, [loaderData.installCode]);

    useEffect(() => {
        if (!saved || source !== 'bookmarklet' || twitterIntentUrl !== null) {
            return;
        }
        const timeout = window.setTimeout(() => window.close(), 1_500);
        return () => window.clearTimeout(timeout);
    }, [saved, source, twitterIntentUrl]);

    if (loaderData.prefill.url === '') {
        return (
            <AdminPage
                description="无需离开当前页面即可收藏它。"
                title="安装 Bookmarklet"
            >
                <div className="max-w-3xl">
                    <LayerCard>
                        <section className="space-y-4 p-4">
                            <div className="flex items-start gap-4">
                                <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-gongyu-tint text-gongyu-link">
                                    <BookmarkSimpleIcon
                                        aria-hidden="true"
                                        size={26}
                                        weight="duotone"
                                    />
                                </span>
                                <div>
                                    <h2 className="text-lg font-semibold text-gongyu-default">
                                        添加到书签栏
                                    </h2>
                                    <p className="mt-1 text-sm leading-6 text-gongyu-subtle">
                                        把下面的按钮拖到浏览器工具栏，之后在任意页面点击即可。
                                    </p>
                                </div>
                            </div>
                            <div className="rounded-lg border border-dashed border-gongyu-line p-5 text-center">
                                <a
                                    className="inline-flex h-11 items-center justify-center rounded-xl bg-gongyu-brand px-5 font-semibold text-gongyu-inverse shadow-sm transition-transform hover:-translate-y-0.5"
                                    href="#bookmarklet-code"
                                    ref={installLink}
                                >
                                    保存到 Gongyu
                                </a>
                                <p className="mt-3 text-xs text-gongyu-subtle">
                                    拖动这个按钮——不要在本页点击它。
                                </p>
                            </div>
                            <details className="border-t border-gongyu-line pt-4">
                                <summary className="cursor-pointer text-sm text-gongyu-link">
                                    手动安装代码
                                </summary>
                                <InputArea
                                    className="mt-4 min-h-32 font-mono text-xs"
                                    description="无法拖拽 Bookmarklet 时可复制这段代码。"
                                    id="bookmarklet-code"
                                    label="Bookmarklet 代码"
                                    readOnly
                                    value={loaderData.installCode}
                                />
                            </details>
                        </section>
                    </LayerCard>
                </div>
            </AdminPage>
        );
    }

    if (loaderData.existing !== null && !saved) {
        return (
            <AdminPage
                description="该 URL 已存在于你的书签库中。"
                title="已收藏过"
            >
                <LayerCard>
                    <div className="space-y-4 p-4">
                        <div className="flex items-start gap-4">
                            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-gongyu-tint text-gongyu-link">
                                <BookmarkSimpleIcon
                                    aria-hidden="true"
                                    size={23}
                                />
                            </span>
                            <div className="min-w-0">
                                <p className="font-semibold text-gongyu-default">
                                    {loaderData.existing.title}
                                </p>
                                <p className="mt-1 break-all text-sm text-gongyu-subtle">
                                    {loaderData.existing.url}
                                </p>
                            </div>
                        </div>
                        <div className="flex flex-wrap gap-2 border-t border-gongyu-line pt-3">
                            <LinkButton
                                href={`/admin/bookmarks/${loaderData.existing.shortUrl}/edit`}
                                variant="primary"
                            >
                                编辑已有书签
                            </LinkButton>
                            <Button
                                onClick={() => window.close()}
                                type="button"
                                variant="secondary"
                            >
                                关闭
                            </Button>
                        </div>
                    </div>
                </LayerCard>
            </AdminPage>
        );
    }

    return (
        <AdminPage
            description={
                saved
                    ? '收藏的页面已存入你的书签库。'
                    : '检查页面详情，保留你需要的上下文。'
            }
            title={saved ? '书签已保存' : '保存收藏的页面'}
        >
            <LayerCard className="max-w-2xl">
                {saved ? (
                    <div className="space-y-4 p-5 text-center">
                        <CheckCircleIcon
                            aria-hidden="true"
                            className="mx-auto text-gongyu-success"
                            size={48}
                            weight="duotone"
                        />
                        <p aria-live="polite" className="text-gongyu-default">
                            {twitterIntentUrl === null
                                ? '保存成功，此标签页即将关闭。'
                                : '保存成功。发布到 X 前请先检查预填的帖子。'}
                        </p>
                        <div className="flex flex-wrap items-center justify-center gap-2">
                            {twitterIntentUrl === null ? null : (
                                <LinkButton
                                    external
                                    href={twitterIntentUrl}
                                    icon={ArrowSquareOutIcon}
                                    variant="primary"
                                >
                                    打开 X 编辑器
                                </LinkButton>
                            )}
                            <Button
                                onClick={() => window.close()}
                                type="button"
                                variant="secondary"
                            >
                                立即关闭
                            </Button>
                        </div>
                    </div>
                ) : (
                    <Form method="post">
                        <div className={adminPanelBodyClass}>
                            <input
                                name="_csrf"
                                type="hidden"
                                value={csrfToken}
                            />
                            <input name="source" type="hidden" value={source} />
                            <Input
                                description="请填写你希望 Gongyu 完整保留的 URL。"
                                error={urlError}
                                label="URL"
                                maxLength={2048}
                                name="url"
                                onChange={(event) =>
                                    setUrl(event.currentTarget.value)
                                }
                                required
                                type="url"
                                value={url}
                            />
                            <MetadataPreview
                                csrfToken={csrfToken}
                                onCandidates={(candidates) => {
                                    setTitle((current) =>
                                        current === '' &&
                                        candidates.title !== null
                                            ? candidates.title
                                            : current,
                                    );
                                    setDescription((current) =>
                                        current === '' &&
                                        candidates.description !== null
                                            ? candidates.description
                                            : current,
                                    );
                                }}
                                url={url}
                            />
                            <Input
                                error={titleError}
                                label="标题"
                                maxLength={500}
                                name="title"
                                onChange={(event) =>
                                    setTitle(event.currentTarget.value)
                                }
                                required
                                value={title}
                            />
                            <InputArea
                                className="min-h-28"
                                label="描述"
                                name="description"
                                onChange={(event) =>
                                    setDescription(event.currentTarget.value)
                                }
                                value={description}
                            />
                            {loaderData.providers.length === 0 ? null : (
                                <Checkbox
                                    checked={shareSocial}
                                    label={`通过 ${loaderData.providers.join('、')} 分享`}
                                    name="share_social"
                                    onCheckedChange={setShareSocial}
                                />
                            )}
                        </div>
                        <div className={adminPanelFooterClass}>
                            <Button
                                icon={FloppyDiskIcon}
                                loading={isSubmitting}
                                type="submit"
                                variant="primary"
                            >
                                保存书签
                            </Button>
                            <Button
                                onClick={() => window.close()}
                                type="button"
                                variant="secondary"
                            >
                                取消
                            </Button>
                        </div>
                    </Form>
                )}
            </LayerCard>
        </AdminPage>
    );
}
