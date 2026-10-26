import { loadPublicBookmarks } from '../bookmarks/public.server';
import { PublicBookmarkPage } from '../bookmarks/public-bookmark-page';
import { cloudflareRequestContext } from '../platform-context';
import type { Route } from './+types/home';

const title = 'Gongyu · 值得回访的链接';
const description =
    '一个安静、可搜索的收藏库，保存你想留存的页面、想法与参考资料。';
const canonicalUrl = 'https://bookmarks.stanislas.blog/';
const socialImageUrl = 'https://bookmarks.stanislas.blog/og-image.png';
const socialImageAlt =
    'Gongyu 个人书签库，展示一批已保存的链接';

export function meta(): Route.MetaDescriptors {
    return [
        { title },
        { name: 'description', content: description },
        { name: 'robots', content: 'index, follow, max-image-preview:large' },
        { property: 'og:type', content: 'website' },
        { property: 'og:site_name', content: 'Gongyu' },
        { property: 'og:title', content: title },
        { property: 'og:description', content: description },
        { property: 'og:url', content: canonicalUrl },
        { property: 'og:image', content: socialImageUrl },
        { property: 'og:image:type', content: 'image/png' },
        { property: 'og:image:width', content: '1200' },
        { property: 'og:image:height', content: '630' },
        { property: 'og:image:alt', content: socialImageAlt },
        { name: 'twitter:card', content: 'summary_large_image' },
        { name: 'twitter:title', content: title },
        { name: 'twitter:description', content: description },
        { name: 'twitter:image', content: socialImageUrl },
        { name: 'twitter:image:alt', content: socialImageAlt },
        { tagName: 'link', rel: 'canonical', href: canonicalUrl },
    ];
}

export async function loader({ context, request }: Route.LoaderArgs) {
    const { authentication, effect } = context.get(cloudflareRequestContext);
    return {
        ...(await loadPublicBookmarks(effect, request)),
        authenticated: authentication.authenticated,
    };
}

export default function Home({ loaderData }: Route.ComponentProps) {
    return <PublicBookmarkPage {...loaderData} />;
}
