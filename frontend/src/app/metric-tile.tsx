import { cn } from '@/lib/cn'

/**
 * One figure with its label. Deliberately plain: the numbers are the content,
 * and a dashboard that decorates them makes them harder to read.
 */
export function MetricTile({
  label,
  value,
  hint,
  emphasis = false,
}: {
  label: string
  value: string
  hint?: string
  emphasis?: boolean
}) {
  return (
    <div
      className={cn(
        'rounded-lg border border-muted/20 p-4',
        emphasis && 'border-muted/40 bg-muted/5',
      )}
    >
      <dt className="text-xs font-medium tracking-wide text-muted uppercase">{label}</dt>
      <dd className={cn('mt-1 font-semibold tabular-nums', emphasis ? 'text-3xl' : 'text-2xl')}>
        {value}
      </dd>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  )
}
