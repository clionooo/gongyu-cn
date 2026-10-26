import { ListBulletsIcon, SquaresFourIcon } from '@phosphor-icons/react';
import { LinkButton } from '../components/ui';

export type BookmarkView = 'gallery' | 'list';

export function parseBookmarkView(value: string | null): BookmarkView {
    return value === 'gallery' ? 'gallery' : 'list';
}

function viewHref({
    basePath,
    query,
    view,
}: {
    readonly basePath: string;
    readonly query: string;
    readonly view: BookmarkView;
}): string {
    const parameters = new URLSearchParams();
    if (query !== '') {
        parameters.set('q', query);
    }
    parameters.set('view', view);
    return `${basePath}?${parameters.toString()}`;
}

export function BookmarkViewSwitch({
    basePath,
    query,
    view,
}: {
    readonly basePath: string;
    readonly query: string;
    readonly view: BookmarkView;
}) {
    return (
        <nav
            aria-label="书签视图"
            className="flex shrink-0 gap-0.5 rounded-lg border border-gongyu-line bg-gongyu-recessed/70 p-0.5"
        >
            <LinkButton
                aria-current={view === 'list' ? 'page' : undefined}
                aria-label="列表视图"
                href={viewHref({ basePath, query, view: 'list' })}
                icon={ListBulletsIcon}
                shape="square"
                size="sm"
                title="列表视图"
                variant={view === 'list' ? 'secondary' : 'ghost'}
            />
            <LinkButton
                aria-current={view === 'gallery' ? 'page' : undefined}
                aria-label="画廊视图"
                href={viewHref({ basePath, query, view: 'gallery' })}
                icon={SquaresFourIcon}
                shape="square"
                size="sm"
                title="画廊视图"
                variant={view === 'gallery' ? 'secondary' : 'ghost'}
            />
        </nav>
    );
}
