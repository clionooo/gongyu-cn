interface OperationProgressProps {
    readonly label: string;
    readonly processed: number;
    readonly total: number;
}

export function hasRowProgress(kind: string): boolean {
    return kind === 'import' || kind === 'restore';
}

export function artifactOperationStatus(kind: string, state: string): string {
    const operation = kind === 'backup' ? '备份' : '导出';
    switch (state) {
        case 'completed':
            return `${operation}文件已生成，可以下载。`;
        case 'expired':
            return `${operation}已完成，但下载链接已过期。`;
        case 'failed':
            return `${operation}失败，请查看下方的操作错误。`;
        case 'running':
            return `正在生成${operation.toLowerCase()}文件…`;
        default:
            return `${operation}正在等待开始。`;
    }
}

export function OperationProgress({
    label,
    processed,
    total,
}: OperationProgressProps) {
    const percentage =
        total <= 0 ? 0 : Math.min(100, Math.round((processed / total) * 100));
    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between gap-4 text-xs">
                <span className="font-medium text-gongyu-default">{label}</span>
                <span className="text-gongyu-subtle">
                    {total <= 0 ? '等待中' : `${processed} / ${total}`}
                </span>
            </div>
            <div
                aria-label={label}
                aria-valuemax={Math.max(total, 1)}
                aria-valuemin={0}
                aria-valuenow={Math.min(processed, Math.max(total, 1))}
                className="h-2 overflow-hidden rounded-full bg-gongyu-fill"
                role="progressbar"
            >
                <div
                    className="h-full rounded-full bg-gongyu-brand transition-[width] duration-300"
                    style={{ width: `${percentage}%` }}
                />
            </div>
        </div>
    );
}
