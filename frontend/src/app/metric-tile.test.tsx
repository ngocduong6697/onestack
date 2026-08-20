import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MetricTile } from './metric-tile'

describe('MetricTile', () => {
  it('shows its label and value', () => {
    render(
      <dl>
        <MetricTile label="MRR" value="$2,100" />
      </dl>,
    )

    expect(screen.getByText('MRR')).toBeInTheDocument()
    expect(screen.getByText('$2,100')).toBeInTheDocument()
  })

  it('shows a hint when there is one', () => {
    render(
      <dl>
        <MetricTile label="Margin" value="—" hint="no revenue yet" />
      </dl>,
    )

    expect(screen.getByText('no revenue yet')).toBeInTheDocument()
  })

  it('omits the hint when there is none', () => {
    const { container } = render(
      <dl>
        <MetricTile label="MRR" value="$0" />
      </dl>,
    )

    expect(container.querySelectorAll('p')).toHaveLength(0)
  })

  it('renders a dash without breaking', () => {
    render(
      <dl>
        <MetricTile label="Margin" value="—" />
      </dl>,
    )

    expect(screen.getByText('—')).toBeInTheDocument()
  })
})
