import { Badge, type BadgeVariant } from './ui';

const variants: Readonly<Record<string, BadgeVariant>> = {
    active: 'success',
    completed: 'success',
    delivered: 'success',
    expired: 'secondary',
    failed: 'error',
    needs_review: 'warning',
    pending: 'info',
    processing: 'info',
    queued: 'info',
    retrying: 'warning',
    running: 'info',
    waiting_metadata: 'secondary',
};

const labels: Readonly<Record<string, string>> = {
    active: '活跃',
    completed: '已完成',
    delivered: '已送达',
    expired: '已过期',
    failed: '失败',
    needs_review: '待审核',
    pending: '待处理',
    processing: '处理中',
    queued: '排队中',
    retrying: '重试中',
    running: '进行中',
    waiting_metadata: '等待元数据',
};

function label(value: string): string {
    const translated = labels[value];
    if (translated !== undefined) {
        return translated;
    }
    return value
        .split('_')
        .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
        .join(' ');
}

export function StatusBadge({ state }: { readonly state: string }) {
    return (
        <Badge appearance="dot" variant={variants[state] ?? 'secondary'}>
            {label(state)}
        </Badge>
    );
}
