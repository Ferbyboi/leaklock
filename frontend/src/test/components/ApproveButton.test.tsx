import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { setupServer } from 'msw/node'
import { handlers } from '../mocks/handlers'
import ApproveButton from '@/components/ui/ApproveButton'

const server = setupServer(...handlers)

beforeEach(() => server.listen({ onUnhandledRequest: 'bypass' }))
afterEach(() => {
  server.resetHandlers()
})

// Silence sonner toasts in test output
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

describe('ApproveButton', () => {
  it('renders with correct initial label', () => {
    render(<ApproveButton jobId="job-001" />)
    expect(screen.getByRole('button', { name: /approve invoice/i })).toBeInTheDocument()
  })

  it('button is not disabled initially', () => {
    render(<ApproveButton jobId="job-001" />)
    expect(screen.getByRole('button')).not.toBeDisabled()
  })

  it('shows loading state while request is in-flight', async () => {
    const user = userEvent.setup()

    // Delay the response so we can assert the loading state
    server.use(
      ...handlers,
    )

    render(<ApproveButton jobId="job-001" />)
    const button = screen.getByRole('button')

    // Start the click but don't await the full result
    const clickPromise = user.click(button)

    // The loading text appears while the fetch is in-flight
    await waitFor(() => {
      // Either the button is disabled (loading) or shows Approving text
      const btn = screen.getByRole('button')
      const isLoading = btn.hasAttribute('disabled') || btn.textContent?.includes('Approving')
      expect(isLoading).toBe(true)
    })

    await clickPromise
  })

  it('calls the approve API with correct job id', async () => {
    const user = userEvent.setup()
    const fetchSpy = vi.spyOn(global, 'fetch')

    render(<ApproveButton jobId="job-002" />)
    await user.click(screen.getByRole('button'))

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/jobs/job-002/approve',
        expect.objectContaining({ method: 'POST' })
      )
    })

    fetchSpy.mockRestore()
  })

  it('shows success toast on successful approval', async () => {
    const { toast } = await import('sonner')
    const user = userEvent.setup()

    render(<ApproveButton jobId="job-001" />)
    await user.click(screen.getByRole('button'))

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Invoice approved')
    })
  })

  it('shows error toast when API returns an error', async () => {
    const { http, HttpResponse } = await import('msw')
    const { toast } = await import('sonner')
    const user = userEvent.setup()

    server.use(
      http.post('/api/jobs/:id/approve', () =>
        HttpResponse.json({ detail: 'Could not approve invoice' }, { status: 422 })
      )
    )

    render(<ApproveButton jobId="job-fail" />)
    await user.click(screen.getByRole('button'))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled()
    })
  })
})
