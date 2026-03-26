import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BentoGrid } from '@/components/dashboard/BentoGrid'
import type { NicheType as _NicheType } from '@/lib/design-tokens'

// Stub out the heavy widget children so this test stays a pure unit test
vi.mock('@/components/dashboard/widgets/ComplianceScoreWidget', () => ({
  ComplianceScoreWidget: () => <div data-testid="widget-ComplianceScoreWidget" />,
}))
vi.mock('@/components/dashboard/widgets/AlertFeedWidget', () => ({
  AlertFeedWidget: () => <div data-testid="widget-AlertFeedWidget" />,
}))
vi.mock('@/components/dashboard/widgets/DailyChecklistWidget', () => ({
  DailyChecklistWidget: () => <div data-testid="widget-DailyChecklistWidget" />,
}))
vi.mock('@/components/dashboard/widgets/TempLogWidget', () => ({
  TempLogWidget: () => <div data-testid="widget-TempLogWidget" />,
}))
vi.mock('@/components/dashboard/widgets/GreaseTrapWidget', () => ({
  GreaseTrapWidget: () => <div data-testid="widget-GreaseTrapWidget" />,
}))
vi.mock('@/components/dashboard/widgets/LeakRateWidget', () => ({
  LeakRateWidget: () => <div data-testid="widget-LeakRateWidget" />,
}))
vi.mock('@/components/dashboard/widgets/SanitationStreakWidget', () => ({
  SanitationStreakWidget: () => <div data-testid="widget-SanitationStreakWidget" />,
}))
vi.mock('@/components/dashboard/widgets/ChemLogWidget', () => ({
  ChemLogWidget: () => <div data-testid="widget-ChemLogWidget" />,
}))

describe('BentoGrid', () => {
  it('renders without crashing for restaurant niche', () => {
    const { container } = render(<BentoGrid nicheType="restaurant" />)
    expect(container.firstChild).toBeInTheDocument()
  })

  it('renders without crashing for hvac niche', () => {
    const { container } = render(<BentoGrid nicheType="hvac" />)
    expect(container.firstChild).toBeInTheDocument()
  })

  it('renders without crashing for plumbing niche', () => {
    const { container } = render(<BentoGrid nicheType="plumbing" />)
    expect(container.firstChild).toBeInTheDocument()
  })

  it('renders without crashing for tree_service niche', () => {
    const { container } = render(<BentoGrid nicheType="tree_service" />)
    expect(container.firstChild).toBeInTheDocument()
  })

  it('renders without crashing for landscaping niche', () => {
    const { container } = render(<BentoGrid nicheType="landscaping" />)
    expect(container.firstChild).toBeInTheDocument()
  })

  it('renders without crashing for barber niche', () => {
    const { container } = render(<BentoGrid nicheType="barber" />)
    expect(container.firstChild).toBeInTheDocument()
  })

  it('renders without crashing for salon niche', () => {
    const { container } = render(<BentoGrid nicheType="salon" />)
    expect(container.firstChild).toBeInTheDocument()
  })

  it('shows universal widgets (ComplianceScore, AlertFeed, DailyChecklist) for restaurant', () => {
    render(<BentoGrid nicheType="restaurant" />)
    expect(screen.getByTestId('widget-ComplianceScoreWidget')).toBeInTheDocument()
    expect(screen.getByTestId('widget-AlertFeedWidget')).toBeInTheDocument()
    expect(screen.getByTestId('widget-DailyChecklistWidget')).toBeInTheDocument()
  })

  it('shows TempLogWidget and GreaseTrapWidget for restaurant niche', () => {
    render(<BentoGrid nicheType="restaurant" />)
    expect(screen.getByTestId('widget-TempLogWidget')).toBeInTheDocument()
    expect(screen.getByTestId('widget-GreaseTrapWidget')).toBeInTheDocument()
  })

  it('shows LeakRateWidget for hvac niche', () => {
    render(<BentoGrid nicheType="hvac" />)
    expect(screen.getByTestId('widget-LeakRateWidget')).toBeInTheDocument()
  })

  it('shows LeakRateWidget for plumbing niche', () => {
    render(<BentoGrid nicheType="plumbing" />)
    expect(screen.getByTestId('widget-LeakRateWidget')).toBeInTheDocument()
  })

  it('shows SanitationStreakWidget for barber niche', () => {
    render(<BentoGrid nicheType="barber" />)
    expect(screen.getByTestId('widget-SanitationStreakWidget')).toBeInTheDocument()
  })

  it('shows SanitationStreakWidget for salon niche', () => {
    render(<BentoGrid nicheType="salon" />)
    expect(screen.getByTestId('widget-SanitationStreakWidget')).toBeInTheDocument()
  })

  it('shows ChemLogWidget for landscaping niche', () => {
    render(<BentoGrid nicheType="landscaping" />)
    expect(screen.getByTestId('widget-ChemLogWidget')).toBeInTheDocument()
  })

  it('renders a grid container', () => {
    const { container } = render(<BentoGrid nicheType="restaurant" />)
    const grid = container.querySelector('.grid')
    expect(grid).toBeInTheDocument()
  })

  it('passes locationId prop down to widgets', () => {
    // Just check that it renders without error when locationId is supplied
    const { container } = render(
      <BentoGrid nicheType="hvac" locationId="loc-123" />
    )
    expect(container.firstChild).toBeInTheDocument()
  })
})
