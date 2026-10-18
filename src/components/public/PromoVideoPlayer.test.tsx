// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import LandingPage from '../../pages/LandingPage'
import { PromoVideoSection } from './PromoVideoPlayer'

/** Controllable IntersectionObserver stand-in; tests drive entries by hand. */
class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = []
  options?: IntersectionObserverInit
  targets = new Set<Element>()
  callback: IntersectionObserverCallback

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback
    this.options = options
    FakeIntersectionObserver.instances.push(this)
  }
  observe(target: Element) { this.targets.add(target) }
  unobserve(target: Element) { this.targets.delete(target) }
  disconnect() { this.targets.clear() }

  emit(state: { isIntersecting: boolean; intersectionRatio: number }) {
    const entries = [...this.targets].map(target => ({
      ...state,
      target,
      rootBounds: null,
      boundingClientRect: target.getBoundingClientRect(),
      intersectionRect: target.getBoundingClientRect(),
      time: Date.now()
    })) as unknown as IntersectionObserverEntry[]
    this.callback(entries, this as unknown as IntersectionObserver)
  }

  static loader() { return FakeIntersectionObserver.instances.find(observer => typeof observer.options?.rootMargin === 'string') }
  static visibility() { return FakeIntersectionObserver.instances.find(observer => observer.options?.rootMargin === undefined) }
}

function mockMedia() {
  vi.spyOn(window.HTMLMediaElement.prototype, 'load').mockImplementation(function () {})
  vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
    Object.defineProperty(this, 'paused', { configurable: true, value: false })
    this.dispatchEvent(new window.Event('play', { bubbles: true }))
    return Promise.resolve()
  })
  vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) {
    Object.defineProperty(this, 'paused', { configurable: true, value: true })
    this.dispatchEvent(new window.Event('pause', { bubbles: true }))
  })
}

beforeAll(() => {
  window.IntersectionObserver = FakeIntersectionObserver as unknown as typeof IntersectionObserver
  mockMedia()
})

beforeEach(() => {
  FakeIntersectionObserver.instances = []
  mockMedia()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.localStorage.removeItem('stracker-public-home-theme')
})

function renderPlayer() {
  const view = render(<PromoVideoSection />)
  const video = view.container.querySelector('video')!
  return { ...view, video }
}

describe('homepage placement', () => {
  it('renders the player between the DYPOL LABS band and the final CTA', () => {
    const { container } = render(<MemoryRouter initialEntries={['/']}><LandingPage /></MemoryRouter>)
    const main = container.querySelector('main')!
    const dypol = main.querySelector('.pub-section-dypol')!
    const promo = main.querySelector('.pub-section-promo')!
    const final = main.querySelector('.pub-final')!

    expect(dypol).not.toBeNull()
    expect(promo).not.toBeNull()
    expect(final).not.toBeNull()
    expect(dypol.compareDocumentPosition(promo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(promo.compareDocumentPosition(final) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe('promo video player behaviour', () => {
  it('holds all media until the frame approaches, then warms the compressed cut first', async () => {
    const { video } = renderPlayer()

    expect(video.getAttribute('preload')).toBe('none')
    expect(video.getAttribute('poster')).toBe('/videos/stracker-ad1-poster.jpg')
    expect(video.querySelectorAll('source')).toHaveLength(0)
    expect(video.muted).toBe(true)
    expect(video.getAttribute('playsinline')).not.toBeNull()

    await act(async () => { FakeIntersectionObserver.loader()?.emit({ isIntersecting: true, intersectionRatio: 0 }) })

    const sources = [...video.querySelectorAll('source')]
    expect(video.getAttribute('preload')).toBe('auto')
    expect(sources).toHaveLength(2)
    expect(sources[0]?.getAttribute('src')).toBe('/videos/stracker-ad1-web.mp4')
    expect(sources[1]?.getAttribute('src')).toBe('/videos/Stracker%20Ad1.mp4')
  })

  it('starts muted looping playback when sufficiently visible and pauses off-screen', async () => {
    const { video } = renderPlayer()
    await act(async () => { FakeIntersectionObserver.loader()?.emit({ isIntersecting: true, intersectionRatio: 0 }) })

    expect(video.loop).toBe(true)
    expect(video.paused).toBe(true)

    await act(async () => { FakeIntersectionObserver.visibility()?.emit({ isIntersecting: true, intersectionRatio: 0.6 }) })
    expect(video.paused).toBe(false)
    expect(screen.getByRole('button', { name: 'Pause the preview video' })).toBeTruthy()

    await act(async () => { FakeIntersectionObserver.visibility()?.emit({ isIntersecting: false, intersectionRatio: 0 }) })
    expect(video.paused).toBe(true)
    expect(screen.getByRole('button', { name: 'Play the preview video' })).toBeTruthy()

    await act(async () => { FakeIntersectionObserver.visibility()?.emit({ isIntersecting: true, intersectionRatio: 0.6 }) })
    expect(video.paused).toBe(false)
  })

  it('does not resume after an explicit pause, until the visitor presses play', async () => {
    const { video } = renderPlayer()
    const playSpy = vi.mocked(window.HTMLMediaElement.prototype.play)
    await act(async () => { FakeIntersectionObserver.loader()?.emit({ isIntersecting: true, intersectionRatio: 0 }) })
    await act(async () => { FakeIntersectionObserver.visibility()?.emit({ isIntersecting: true, intersectionRatio: 0.6 }) })
    expect(video.paused).toBe(false)
    const callsAfterAutoplay = playSpy.mock.calls.length

    fireEvent.click(screen.getByRole('button', { name: 'Pause the preview video' }))
    expect(video.paused).toBe(true)

    await act(async () => { FakeIntersectionObserver.visibility()?.emit({ isIntersecting: false, intersectionRatio: 0 }) })
    await act(async () => { FakeIntersectionObserver.visibility()?.emit({ isIntersecting: true, intersectionRatio: 0.6 }) })
    expect(video.paused).toBe(true)
    expect(playSpy.mock.calls.length).toBe(callsAfterAutoplay)

    fireEvent.click(screen.getByRole('button', { name: 'Play the preview video' }))
    expect(video.paused).toBe(false)
  })

  it('toggles sound with the speaker button and reports it to assistive tech', async () => {
    const { video } = renderPlayer()
    const speaker = screen.getByRole('button', { name: 'Turn the preview sound on' })
    expect(speaker.getAttribute('aria-pressed')).toBe('false')
    expect(video.muted).toBe(true)

    fireEvent.click(speaker)
    expect(video.muted).toBe(false)
    const unmuted = screen.getByRole('button', { name: 'Turn the preview sound off' })
    expect(unmuted.getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(unmuted)
    expect(video.muted).toBe(true)
  })

  it('keeps the poster and a manual play control when autoplay is refused', async () => {
    const { video } = renderPlayer()
    vi.mocked(window.HTMLMediaElement.prototype.play).mockRejectedValueOnce(new DOMException('not allowed', 'NotAllowedError'))
    await act(async () => { FakeIntersectionObserver.loader()?.emit({ isIntersecting: true, intersectionRatio: 0 }) })
    await act(async () => { FakeIntersectionObserver.visibility()?.emit({ isIntersecting: true, intersectionRatio: 0.6 }) })

    expect(video.paused).toBe(true)
    const play = screen.getByRole('button', { name: 'Play the preview video' })

    const playSpy = vi.mocked(window.HTMLMediaElement.prototype.play)
    const callsWhileBlocked = playSpy.mock.calls.length
    await act(async () => { FakeIntersectionObserver.visibility()?.emit({ isIntersecting: false, intersectionRatio: 0 }) })
    await act(async () => { FakeIntersectionObserver.visibility()?.emit({ isIntersecting: true, intersectionRatio: 0.6 }) })
    expect(playSpy.mock.calls.length).toBe(callsWhileBlocked)

    fireEvent.click(play)
    expect(video.paused).toBe(false)
  })

  it('leaves reduced-motion visitors a static poster they can start themselves', async () => {
    const realMatchMedia = window.matchMedia
    window.matchMedia = ((query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false
    })) as typeof window.matchMedia

    try {
      const { video } = renderPlayer()
      await act(async () => { FakeIntersectionObserver.loader()?.emit({ isIntersecting: true, intersectionRatio: 0 }) })
      await act(async () => { FakeIntersectionObserver.visibility()?.emit({ isIntersecting: true, intersectionRatio: 0.6 }) })
      expect(video.paused).toBe(true)

      fireEvent.click(screen.getByRole('button', { name: 'Play the preview video' }))
      expect(video.paused).toBe(false)
    } finally {
      window.matchMedia = realMatchMedia
    }
  })

  it('shows a quiet fallback line instead of dead controls when the media fails', async () => {
    const { video } = renderPlayer()
    await act(async () => {
      video.dispatchEvent(new window.Event('error', { bubbles: true }))
    })

    expect(screen.getByText(/couldn’t load/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /preview video|preview sound/ })).toBeNull()
  })
})
