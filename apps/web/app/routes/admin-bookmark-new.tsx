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
import { dispatchBookmarkOutboxBestEffort } from '@gongyu/jobs/outbox-dispatcher';
import {
    ArrowSquareOutIcon,
    CheckCircleIcon,
    FloppyDiskIcon,
} from '@phosphor-icons/react';
import { Effect } from 'effect';
import { useState } from 'react';
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
import type { Route } from './+types/admin-bookmark-new';

export function meta(): Route.MetaDescriptors {
    return [{ title: '新建书签 · Gongyu' }];
}

export async function loader({ context, request }: Route.LoaderArgs) {
    const { authentication, effect } = context.get(cloudflareRequestContext);
    const location = new URL(request.url);
    if (!authentication.authenticated) {
        return redirect(
            `/login?returnTo=${encodeURIComponent(`${location.pathname}${location.search}`)}`,
        );
    }
    const shareShortUrl = location.searchParams.get('share');
    return effect.runPromise(
        Effect.gen(function* () {
            const settings = yield* SettingsRepository;
            const bookmarks = yield* BookmarkRepository;
            const current = yield* settings.get;
            const bookmark =
                shareShortUrl === null
                    ? null
                    : yield* bookmarks.findByShortUrl(shareShortUrl);
            return {
                providers: [
                    ...configuredProviders(current),
                    ...(current.twitterDeliveryMode === 'manual'
                        ? ['X（手动）']
                        : []),
                ],
                twitterIntentUrl:
                    current.twitterDeliveryMode === 'manual' &&
                    bookmark !== null
                        ? twitterWebIntentUrl({
                              originalUrl: bookmark.url,
                              title: bookmark.title,
                          })
                        : null,
            };
        }),
    );
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
    const url = formData.get('url');
    const title = formData.get('title');
    const description = formData.get('description');
    const shareSocial = formData.get('share_social') === 'on';
    const input = {
        description:
            typeof description === 'string' && description !== ''
                ? description
                : null,
        title: typeof title === 'string' ? title.trim() : '',
        url: typeof url === 'string' ? url : '',
    };
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
        }).pipe(
            Effect.match({
                onFailure: failure,
                onSuccess: success,
            }),
        ),
    );
    if (result.ok) {
        return result.value.twitterIntentUrl === null
            ? redirect('/admin/bookmarks')
            : redirect(
                  `/admin/bookmarks/new?share=${encodeURIComponent(result.value.bookmark.shortUrl)}`,
              );
    }
    if (result.error instanceof DuplicateBookmarkError) {
        return data(
            { errors: { url: '该 URL 已被收藏。' }, input },
            { status: 409 },
        );
    }
    if (result.error instanceof BookmarkValidationError) {
        return data(
            {
                errors: { [result.error.field]: result.error.message },
                input,
            },
            { status: 400 },
        );
    }
    throw result.error;
}

export default function AdminBookmarkNew({
    actionData,
    loaderData,
}: Route.ComponentProps) {
    const rootData = useRouteLoaderData<typeof rootLoader>('root');
    const csrfToken = rootData?.csrfToken ?? '';
    const isSubmitting = matchesFormSubmission(useNavigation(), {
        action: '/admin/bookmarks/new',
        method: 'POST',
    });
    const values =
        actionData !== undefined && 'input' in actionData
            ? actionData.input
            : {
                  description: '',
                  title: '',
                  url: '',
              };
    const errors =
        actionData !== undefined && 'errors' in actionData
            ? actionData.errors
            : {};
    const twitterIntentUrl = loaderData.twitterIntentUrl;
    const titleError = 'title' in errors ? errors.title : undefined;
    const [url, setUrl] = useState(values.url);
    const [title, setTitle] = useState(values.title);
    const [description, setDescription] = useState(values.description ?? '');
    const [shareSocial, setShareSocial] = useState(true);
    if (twitterIntentUrl !== null) {
        return (
            <AdminPage
                description="选择是否将已保存的书签发布到 X。"
                section="书签"
                sectionHref="/admin/bookmarks"
                title="书签已保存"
            >
                <div className="max-w-2xl">
                    <LayerCard>
                        <div className="space-y-4 p-5 text-center">
                            <CheckCircleIcon
                                aria-hidden="true"
                                className="mx-auto text-gongyu-success"
                                size={48}
                                weight="duotone"
                            />
                            <p className="text-sm text-gongyu-subtle">
                                X 需要你手动检查并发布预填的帖子。
                            </p>
                            <div className="flex flex-wrap justify-center gap-2">
                                <LinkButton
                                    external
                                    href={twitterIntentUrl}
                                    icon={ArrowSquareOutIcon}
                                    variant="primary"
                                >
                                    打开 X 编辑器
                                </LinkButton>
                                <LinkButton
                                    href="/admin/bookmarks"
                                    variant="secondary"
                                >
                                    返回书签
                                </LinkButton>
                            </div>
                        </div>
                    </LayerCard>
                </div>
            </AdminPage>
        );
    }

    return (
        <AdminPage
            description="保存 URL 并附上有用的备注。"
            section="书签"
            sectionHref="/admin/bookmarks"
            title="新建书签"
        >
            <div className="max-w-2xl">
                <LayerCard>
                    <Form method="post">
                        <div className={adminPanelBodyClass}>
                            <input
                                name="_csrf"
                                type="hidden"
                                value={csrfToken}
                            />
                            <Input
                                autoFocus
                                description="请填写你希望 Gongyu 完整保留的 URL。"
                                error={errors.url}
                                label="URL"
                                maxLength={2048}
                                name="url"
                                onChange={(event) =>
                                    setUrl(event.currentTarget.value)
                                }
                                placeholder="https://example.com/article"
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
                                placeholder="为这个链接起个清晰的标题"
                                required
                                value={title}
                            />
                            <InputArea
                                className="min-h-28"
                                description="可选的备注、引文，或这个链接为何重要。"
                                label="描述"
                                name="description"
                                onChange={(event) =>
                                    setDescription(event.currentTarget.value)
                                }
                                placeholder="为未来的自己留下一点上下文…"
                                value={description}
                            />
                            {loaderData.providers.length === 0 ? null : (
                                <Checkbox
                                    checked={shareSocial}
                                    label={`通过 ${loaderData.providers.join('、')} 分享`}
                                    name="share_social"
                                    onCheckedChange={(checked) =>
                                        setShareSocial(checked)
                                    }
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
                            <p className="text-xs text-gongyu-subtle">
                                元数据和缩略图将在后台继续处理。
                            </p>
                        </div>
                    </Form>
                </LayerCard>
            </div>
        </AdminPage>
    );
}
