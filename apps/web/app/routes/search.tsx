import { loadPublicBookmarks } from '../bookmarks/public.server';
import { PublicBookmarkPage } from '../bookmarks/public-bookmark-page';
import { cloudflareRequestContext } from '../platform-context';
import type { Route } from './+types/search';

export function meta({ location }: Route.MetaArgs): Route.MetaDescriptors {
    const query = new URLSearchParams(location.search).get('q')?.trim() ?? '';
    return [
        { title: query === '' ? '搜索 · Gongyu' : `${query} · Gongyu` },
        {
            name: 'description',
            content: '搜索已保存的链接、备注和来源 URL。',
        },
    ];
}

export async function loader({ context, request }: Route.LoaderArgs) {
    const { authentication, effect } = context.get(cloudflareRequestContext);
    return {
        ...(await loadPublicBookmarks(effect, request)),
        authenticated: authentication.authenticated,
    };
}

export default function Search({ loaderData }: Route.ComponentProps) {
    return <PublicBookmarkPage {...loaderData} />;
}
