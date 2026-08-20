import type { AnalyticsSummary } from '@onestack/shared'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

// The sign-out control uses the router, which is not mounted in a unit test.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}))

const { DashboardView } = await import('./dashboard-view')

/** The figures from the sketch this project started from. */
const sketch: AnalyticsSummary = {
  mrrMicroUsd: 2_100_000_000,
  customers: 18,
  activeCustomers: 18,
  activeSubscriptions: 1,
  aiCostMicroUsd: 280_000_000,
  recordedCostMicroUsd: 90_000_000,
  recordedRevenueMicroUsd: 0,
  revenueMicroUsd: 2_100_000_000,
  costMicroUsd: 370_000_000,
  grossProfitMicroUsd: 1_730_000_000,
  marginBasisPoints: 8238,
}

const empty: AnalyticsSummary = {
  mrrMicroUsd: 0,
  customers: 0,
  activeCustomers: 0,
  activeSubscriptions: 0,
  aiCostMicroUsd: 0,
  recordedCostMicroUsd: 0,
  recordedRevenueMicroUsd: 0,
  revenueMicroUsd: 0,
  costMicroUsd: 0,
  grossProfitMicroUsd: 0,
  marginBasisPoints: null,
}

const view = (metrics: AnalyticsSummary) =>
  render(
    <DashboardView
      organizationName="Acme Inc"
      workspaceName="General"
      role="owner"
      metrics={metrics}
    />,
  )

describe('DashboardView', () => {
  it('shows the organization and workspace', () => {
    view(sketch)

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Acme Inc')
    expect(screen.getByText(/General · owner/)).toBeInTheDocument()
  })

  it('renders the figures from the original sketch', () => {
    view(sketch)

    // Revenue and MRR are both $2,100 in the sketch, and both tiles show it.
    expect(screen.getAllByText('$2,100')).toHaveLength(2)
    expect(screen.getAllByText('18')).toHaveLength(2)
    expect(screen.getByText('$280.00')).toBeInTheDocument()
    expect(screen.getByText('$90')).toBeInTheDocument()
    expect(screen.getByText('$1,730')).toBeInTheDocument()
    expect(screen.getByText('82%')).toBeInTheDocument()
  })

  /** AI spend of a few dollars would read as $0 without the precise format. */
  it('shows AI cost with cents', () => {
    view({ ...sketch, aiCostMicroUsd: 17_500 })

    expect(screen.getByText('$0.02')).toBeInTheDocument()
  })

  it('renders an empty workspace as zeroes rather than breaking', () => {
    view(empty)

    expect(screen.getAllByText('$0').length).toBeGreaterThan(0)
    expect(screen.getAllByText('0').length).toBeGreaterThan(0)
  })

  /** A margin on no revenue has no answer; 0% would read as a total loss. */
  it('shows a dash and an explanation when there is no margin', () => {
    view(empty)

    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.getByText('no revenue yet')).toBeInTheDocument()
  })

  it('renders a loss', () => {
    view({
      ...empty,
      revenueMicroUsd: 100_000_000,
      grossProfitMicroUsd: -50_000_000,
      marginBasisPoints: -5000,
    })

    expect(screen.getByText('-$50')).toBeInTheDocument()
    expect(screen.getByText('-50%')).toBeInTheDocument()
  })

  it('offers a way to sign out', () => {
    view(sketch)

    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument()
  })
})
