import type { AnalyticsSummary } from '@onestack/shared'
import { formatCount, formatMargin, formatMoney, formatMoneyPrecise } from '@/lib/format'
import { MetricTile } from './metric-tile'
import { SignOut } from './sign-out'

/**
 * The dashboard as a pure function of its data.
 *
 * Split from the page so fetching and rendering can be wrong independently —
 * and so "renders zeroes for an empty workspace" is something a test can
 * actually assert without a server, a session and a database.
 */
export function DashboardView({
  organizationName,
  workspaceName,
  role,
  metrics,
}: {
  organizationName: string
  workspaceName: string
  role: string
  metrics: AnalyticsSummary
}) {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <header className="mb-10 flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{organizationName}</h1>
          <p className="text-sm text-muted">
            {workspaceName} · {role}
          </p>
        </div>
        <SignOut />
      </header>

      <section className="mb-10">
        <h2 className="mb-3 text-xs font-medium tracking-wide text-muted uppercase">Business</h2>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MetricTile label="Revenue" value={formatMoney(metrics.revenueMicroUsd)} />
          <MetricTile label="MRR" value={formatMoney(metrics.mrrMicroUsd)} />
          <MetricTile label="Customers" value={formatCount(metrics.customers)} />
          <MetricTile label="Active" value={formatCount(metrics.activeCustomers)} />
        </dl>
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-xs font-medium tracking-wide text-muted uppercase">Costs</h2>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {/* Precise, because AI spend is often a few dollars and would
              otherwise read as zero. */}
          <MetricTile label="AI cost" value={formatMoneyPrecise(metrics.aiCostMicroUsd)} />
          <MetricTile label="Infrastructure" value={formatMoney(metrics.recordedCostMicroUsd)} />
          <MetricTile
            label="Subscriptions"
            value={formatCount(metrics.activeSubscriptions)}
            hint="active"
          />
        </dl>
      </section>

      <section>
        <h2 className="mb-3 text-xs font-medium tracking-wide text-muted uppercase">Profit</h2>
        <dl className="grid grid-cols-2 gap-3">
          <MetricTile
            label="Gross profit"
            value={formatMoney(metrics.grossProfitMicroUsd)}
            emphasis
          />
          <MetricTile
            label="Margin"
            value={formatMargin(metrics.marginBasisPoints)}
            hint={metrics.marginBasisPoints === null ? 'no revenue yet' : undefined}
            emphasis
          />
        </dl>
      </section>
    </main>
  )
}
