import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VoiceRecorder } from '@/components/field/VoiceRecorder'

// ── MediaRecorder mock ────────────────────────────────────────────────────────
class MockMediaRecorder {
  static isTypeSupported = vi.fn().mockReturnValue(true)
  ondataavailable: ((e: { data: { size: number } }) => void) | null = null
  onstop: (() => void) | null = null
  state = 'inactive'

  start = vi.fn(() => {
    this.state = 'recording'
  })
  stop = vi.fn(() => {
    this.state = 'inactive'
    this.onstop?.()
  })
}

// ── AudioContext mock (jsdom doesn't support Web Audio API) ───────────────────
const mockAnalyser = {
  fftSize: 2048,
  frequencyBinCount: 1024,
  connect: vi.fn(),
  getByteTimeDomainData: vi.fn(),
}
const mockAudioSource = { connect: vi.fn() }
class MockAudioContext {
  createMediaStreamSource = vi.fn().mockReturnValue(mockAudioSource)
  createAnalyser = vi.fn().mockReturnValue(mockAnalyser)
  close = vi.fn().mockResolvedValue(undefined)
}

// ── WaveSurfer mock ───────────────────────────────────────────────────────────
vi.mock('wavesurfer.js', () => ({
  default: {
    create: vi.fn().mockReturnValue({
      loadBlob: vi.fn(),
      on: vi.fn(),
      play: vi.fn(),
      pause: vi.fn(),
      destroy: vi.fn(),
    }),
  },
}))

const mockGetUserMedia = vi.fn()

beforeEach(() => {
  Object.defineProperty(global, 'MediaRecorder', {
    writable: true,
    value: MockMediaRecorder,
  })
  Object.defineProperty(global.navigator, 'mediaDevices', {
    writable: true,
    value: { getUserMedia: mockGetUserMedia },
  })
  Object.defineProperty(global, 'AudioContext', {
    writable: true,
    value: MockAudioContext,
  })
  // Mock canvas getContext for waveform drawing
  HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
  }) as unknown as typeof HTMLCanvasElement.prototype.getContext
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('VoiceRecorder', () => {
  it('renders the Voice Note heading', () => {
    render(<VoiceRecorder jobId="job-001" />)
    expect(screen.getByText('Voice Note')).toBeInTheDocument()
  })

  it('renders the start recording button in idle state', () => {
    render(<VoiceRecorder jobId="job-001" />)
    expect(screen.getByRole('button', { name: /start recording/i })).toBeInTheDocument()
  })

  it('start recording button is enabled on initial render', () => {
    render(<VoiceRecorder jobId="job-001" />)
    expect(screen.getByRole('button', { name: /start recording/i })).not.toBeDisabled()
  })

  it('transitions to recording state and shows stop button when mic is granted', async () => {
    const user = userEvent.setup()
    const mockStream = {
      getTracks: () => [{ stop: vi.fn() }],
    }
    mockGetUserMedia.mockResolvedValue(mockStream)

    render(<VoiceRecorder jobId="job-001" />)
    await user.click(screen.getByRole('button', { name: /start recording/i }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /stop recording/i })).toBeInTheDocument()
    })
  })

  it('shows error state when microphone access is denied', async () => {
    const user = userEvent.setup()
    mockGetUserMedia.mockRejectedValue(new Error('Permission denied'))

    render(<VoiceRecorder jobId="job-001" />)
    await user.click(screen.getByRole('button', { name: /start recording/i }))

    await waitFor(() => {
      expect(screen.getByText(/microphone access denied/i)).toBeInTheDocument()
    })
  })

  it('shows Try again button after microphone error', async () => {
    const user = userEvent.setup()
    mockGetUserMedia.mockRejectedValue(new Error('Permission denied'))

    render(<VoiceRecorder jobId="job-001" />)
    await user.click(screen.getByRole('button', { name: /start recording/i }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
    })
  })

  it('returns to idle state after clicking Try again', async () => {
    const user = userEvent.setup()
    mockGetUserMedia.mockRejectedValue(new Error('Permission denied'))

    render(<VoiceRecorder jobId="job-001" />)
    await user.click(screen.getByRole('button', { name: /start recording/i }))

    await waitFor(() => screen.getByRole('button', { name: /try again/i }))
    await user.click(screen.getByRole('button', { name: /try again/i }))

    expect(screen.getByRole('button', { name: /start recording/i })).toBeInTheDocument()
  })

  it('accepts optional locationId and onComplete props without errors', () => {
    const onComplete = vi.fn()
    expect(() =>
      render(
        <VoiceRecorder jobId="job-001" locationId="loc-xyz" onComplete={onComplete} />
      )
    ).not.toThrow()
  })
})
