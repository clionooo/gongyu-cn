import { SettingsRepository } from '@gongyu/data/settings-repository';
import { Settings, type TwitterDeliveryMode } from '@gongyu/domain/settings';
import {
    AtIcon,
    FloppyDiskIcon,
    GlobeHemisphereWestIcon,
    ShareNetworkIcon,
} from '@phosphor-icons/react';
import { Effect } from 'effect';
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
import { AdminPage } from '../components/admin-page';
import { adminPanelFooterClass } from '../components/admin-panel';
import { Badge, Banner, Button, Input, LayerCard } from '../components/ui';
import { matchesFormSubmission } from '../form-navigation';
import { cloudflareRequestContext } from '../platform-context';
import type { loader as rootLoader } from '../root';
import type { Route } from './+types/admin-settings';

const fields = [
    { key: 'twitterApiKey', label: 'Twitter API 密钥', name: 'twitter_api_key' },
    {
        key: 'twitterApiSecret',
        label: 'Twitter API Secret',
        name: 'twitter_api_secret',
        sensitive: true,
    },
    {
        key: 'twitterAccessToken',
        label: 'Twitter 访问令牌',
        name: 'twitter_access_token',
        sensitive: true,
    },
    {
        key: 'twitterAccessSecret',
        label: 'Twitter 访问密钥',
        name: 'twitter_access_secret',
        sensitive: true,
    },
    {
        key: 'mastodonInstance',
        label: 'Mastodon 实例 URL',
        name: 'mastodon_instance',
    },
    {
        key: 'mastodonAccessToken',
        label: 'Mastodon 访问令牌',
        name: 'mastodon_access_token',
        sensitive: true,
    },
    { key: 'blueskyHandle', label: 'Bluesky 用户名', name: 'bluesky_handle' },
    {
        key: 'blueskyAppPassword',
        label: 'Bluesky 应用密码',
        name: 'bluesky_app_password',
        sensitive: true,
    },
] satisfies ReadonlyArray<{
    readonly key: keyof Settings;
    readonly label: string;
    readonly name: string;
    readonly sensitive?: boolean;
}>;

export function meta(): Route.MetaDescriptors {
    return [{ title: '设置 · Gongyu' }];
}

export async function loader({ context, request }: Route.LoaderArgs) {
    const { authentication, effect } = context.get(cloudflareRequestContext);
    const location = new URL(request.url);
    if (!authentication.authenticated) {
        return redirect(
            `/login?returnTo=${encodeURIComponent(`${location.pathname}${location.search}`)}`,
        );
    }
    const settings = await effect.runPromise(
        Effect.gen(function* () {
            const repository = yield* SettingsRepository;
            return yield* repository.get;
        }),
    );
    return {
        saved: location.searchParams.get('saved') === '1',
        settings,
    };
}

function stringValue(formData: FormData, name: string): string {
    const value = formData.get(name);
    return typeof value === 'string' ? value.trim() : '';
}

function twitterDeliveryModeValue(
    formData: FormData,
): TwitterDeliveryMode | null {
    const value = formData.get('twitter_delivery_mode');
    return value === 'api' || value === 'manual' || value === 'disabled'
        ? value
        : null;
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
    const feedCount = Number.parseInt(stringValue(formData, 'feed_count'), 10);
    const twitterDeliveryMode = twitterDeliveryModeValue(formData);
    const values = {
        blueskyAppPassword: stringValue(formData, 'bluesky_app_password'),
        feedCount,
        blueskyHandle: stringValue(formData, 'bluesky_handle'),
        libraryName: stringValue(formData, 'library_name'),
        mastodonAccessToken: stringValue(formData, 'mastodon_access_token'),
        mastodonInstance: stringValue(formData, 'mastodon_instance'),
        twitterAccessSecret: stringValue(formData, 'twitter_access_secret'),
        twitterAccessToken: stringValue(formData, 'twitter_access_token'),
        twitterApiKey: stringValue(formData, 'twitter_api_key'),
        twitterApiSecret: stringValue(formData, 'twitter_api_secret'),
        twitterDeliveryMode: twitterDeliveryMode ?? 'disabled',
    };
    const errors: Record<string, string> = {};
    if (twitterDeliveryMode === null) {
        errors.twitter_delivery_mode = '请选择 Twitter 投递方式。';
    } else if (
        twitterDeliveryMode === 'api' &&
        fields.slice(0, 4).some((field) => values[field.key] === '')
    ) {
        errors.twitter_delivery_mode =
            '请填写全部四项 API 凭据，或选择手动或禁用。';
    }
    if (values.libraryName === '') {
        errors.library_name = '请输入书签库名称。';
    } else if (values.libraryName.length > 80) {
        errors.library_name = '不超过 80 个字符。';
    }
    for (const field of fields) {
        if (values[field.key].length > 255) {
            errors[field.name] = '不超过 255 个字符。';
        }
    }
    if (values.mastodonInstance !== '') {
        try {
            new URL(values.mastodonInstance);
        } catch {
            errors.mastodon_instance = '请输入有效的 Mastodon 实例 URL。';
        }
    }
    if (!Number.isSafeInteger(feedCount) || feedCount < 1) {
        errors.feed_count = '请输入正整数。';
    }
    if (Object.keys(errors).length > 0) {
        return data({ errors, values }, { status: 400 });
    }

    await effect.runPromise(
        Effect.gen(function* () {
            const repository = yield* SettingsRepository;
            yield* repository.save(
                Settings.make({ ...values, feedCount }),
                Date.now() * 1_000,
            );
        }),
    );
    return redirect('/admin/settings?saved=1');
}

export default function AdminSettings({
    actionData,
    loaderData,
}: Route.ComponentProps) {
    const rootData = useRouteLoaderData<typeof rootLoader>('root');
    const csrfToken = rootData?.csrfToken ?? '';
    const values = actionData?.values ?? loaderData.settings;
    const errors = actionData?.errors ?? {};
    const isSubmitting = matchesFormSubmission(useNavigation(), {
        action: '/admin/settings',
        method: 'POST',
    });
    const providerGroups = [
        {
            description:
                '选择 API 自动投递、手动 X 编辑器，或不投递。',
            fields: fields.slice(0, 4),
            icon: ShareNetworkIcon,
            name: 'Twitter',
        },
        {
            description: '实例 URL 和个人访问令牌。',
            fields: fields.slice(4, 6),
            icon: GlobeHemisphereWestIcon,
            name: 'Mastodon',
        },
        {
            description: '用户名和应用专属密码。',
            fields: fields.slice(6, 8),
            icon: AtIcon,
            name: 'Bluesky',
        },
    ] as const;
    return (
        <AdminPage
            description="配置公开书签库、社交分享和 Atom 订阅源。"
            title="设置"
        >
            {loaderData.saved ? (
                <Banner
                    description="公开书签库和投递设置已更新。"
                    title="设置已保存"
                    variant="secondary"
                />
            ) : null}
            <Form method="post">
                <input name="_csrf" type="hidden" value={csrfToken} />
                <LayerCard className="overflow-hidden">
                    <div className="divide-y divide-gongyu-line">
                        <section className="p-4">
                            <div className="mb-3">
                                <h2 className="font-semibold text-gongyu-default">
                                    公开书签库
                                </h2>
                                <p className="mt-0.5 text-sm text-gongyu-subtle">
                                    显示为公开首页标题的名称。
                                </p>
                            </div>
                            <Input
                                className="max-w-sm"
                                defaultValue={values.libraryName}
                                error={errors.library_name}
                                label="书签库名称"
                                maxLength={80}
                                name="library_name"
                            />
                        </section>
                        {providerGroups.map((provider) => {
                            const credentialsConfigured = provider.fields.every(
                                (field) =>
                                    String(values[field.key]).trim() !== '',
                            );
                            const isTwitter = provider.name === 'Twitter';
                            const configured = isTwitter
                                ? values.twitterDeliveryMode === 'manual' ||
                                  (values.twitterDeliveryMode === 'api' &&
                                      credentialsConfigured)
                                : credentialsConfigured;
                            const status = isTwitter
                                ? values.twitterDeliveryMode === 'manual'
                                    ? '手动编辑器'
                                    : values.twitterDeliveryMode === 'disabled'
                                      ? '已禁用'
                                      : credentialsConfigured
                                        ? 'API 已配置'
                                        : 'API 未配置完整'
                                : configured
                                  ? '已配置'
                                  : '未配置';
                            const Icon = provider.icon;
                            return (
                                <section className="p-4" key={provider.name}>
                                    <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                        <div className="flex items-center gap-2.5">
                                            <Icon
                                                aria-hidden="true"
                                                className="text-gongyu-subtle"
                                                size={18}
                                            />
                                            <div>
                                                <h2 className="font-semibold text-gongyu-default">
                                                    {provider.name}
                                                </h2>
                                                <p className="mt-0.5 text-sm text-gongyu-subtle">
                                                    {provider.description}
                                                </p>
                                            </div>
                                        </div>
                                        <Badge
                                            appearance="dot"
                                            variant={
                                                configured
                                                    ? 'success'
                                                    : 'secondary'
                                            }
                                        >
                                            {status}
                                        </Badge>
                                    </div>
                                    {isTwitter ? (
                                        <fieldset
                                            aria-describedby={
                                                errors.twitter_delivery_mode ===
                                                undefined
                                                    ? undefined
                                                    : 'twitter-delivery-mode-error'
                                            }
                                            className="mb-4"
                                        >
                                            <legend className="mb-2 text-sm font-medium text-gongyu-default">
                                                投递方式
                                            </legend>
                                            <div className="grid gap-2 sm:grid-cols-3">
                                                {[
                                                    {
                                                        description:
                                                            '通过付费的 X API 排队发送帖子。',
                                                        label: 'API 自动投递',
                                                        value: 'api',
                                                    },
                                                    {
                                                        description:
                                                            '保存后提供预填的 X 编辑器。',
                                                        label: '手动编辑器',
                                                        value: 'manual',
                                                    },
                                                    {
                                                        description:
                                                            '不提供也不发送帖子到 X。',
                                                        label: '禁用',
                                                        value: 'disabled',
                                                    },
                                                ].map((option) => (
                                                    <label
                                                        className="flex cursor-pointer gap-2 rounded-lg border border-gongyu-line p-3"
                                                        key={option.value}
                                                    >
                                                        <input
                                                            defaultChecked={
                                                                values.twitterDeliveryMode ===
                                                                option.value
                                                            }
                                                            name="twitter_delivery_mode"
                                                            type="radio"
                                                            value={option.value}
                                                        />
                                                        <span>
                                                            <span className="block text-sm font-medium text-gongyu-default">
                                                                {option.label}
                                                            </span>
                                                            <span className="mt-0.5 block text-xs leading-5 text-gongyu-subtle">
                                                                {
                                                                    option.description
                                                                }
                                                            </span>
                                                        </span>
                                                    </label>
                                                ))}
                                            </div>
                                            {errors.twitter_delivery_mode ===
                                            undefined ? null : (
                                                <p
                                                    className="mt-2 text-sm text-gongyu-danger"
                                                    id="twitter-delivery-mode-error"
                                                >
                                                    {
                                                        errors.twitter_delivery_mode
                                                    }
                                                </p>
                                            )}
                                            <p className="mt-3 text-xs text-gongyu-subtle">
                                                下方凭据仅用于 API 自动投递。
                                            </p>
                                        </fieldset>
                                    ) : null}
                                    <div className="grid gap-3 sm:grid-cols-2">
                                        {provider.fields.map((field) => {
                                            const error = errors[field.name];
                                            return (
                                                <Input
                                                    autoComplete="off"
                                                    defaultValue={String(
                                                        values[field.key],
                                                    )}
                                                    error={error}
                                                    key={field.name}
                                                    label={field.label}
                                                    maxLength={255}
                                                    name={field.name}
                                                    type={
                                                        field.sensitive === true
                                                            ? 'password'
                                                            : 'text'
                                                    }
                                                />
                                            );
                                        })}
                                    </div>
                                </section>
                            );
                        })}
                        <section className="p-4">
                            <div className="mb-3">
                                <h2 className="font-semibold text-gongyu-default">
                                    公开订阅源
                                </h2>
                                <p className="mt-0.5 text-sm text-gongyu-subtle">
                                    Atom 订阅源中包含的最近书签数量。
                                </p>
                            </div>
                            <Input
                                className="max-w-xs"
                                defaultValue={values.feedCount}
                                error={errors.feed_count}
                                label="订阅源条目数"
                                min={1}
                                name="feed_count"
                                type="number"
                            />
                        </section>
                    </div>
                    <div className={adminPanelFooterClass}>
                        <Button
                            icon={FloppyDiskIcon}
                            loading={isSubmitting}
                            type="submit"
                            variant="primary"
                        >
                            保存设置
                        </Button>
                    </div>
                </LayerCard>
            </Form>
        </AdminPage>
    );
}
