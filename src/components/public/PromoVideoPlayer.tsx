import { useCallback, useEffect, useRef, useState } from 'react'
import { Pause, Play, Volume2, VolumeX } from 'lucide-react'

/**
 * Public-homepage promotional player.
 *
 * The media lives in `public/videos` next to the untouched original edit:
 *  - `stracker-ad1-web.mp4` is a compressed H.264 web cut (same 720x1280 frame,
 *    fast-start moov, ~2.3 MB) that every visitor loads;
 *  - the original `Stracker Ad1.mp4` stays a `<source>` fallback only, so it is
 *    requested when — and only when — the web cut cannot be used;
 *  - `stracker-ad1-poster.jpg` is a 38 KB still shown until playback begins.
 *
 * Behaviour contract:
 *  - nothing downloads until the player approaches the viewport (the element
 *    carries `preload="none"` and no sources until an observer arms it);
 *  - once most of the frame is visible, playback starts muted and loops;
 *  - scrolling the frame out pauses it, scrolling back in resumes it — unless
 *    the visitor explicitly paused, in which case that choice wins;
 *  - a blocked autoplay attempt falls back to the poster plus the play button
 *    instead of retrying and spamming the console;
 *  - `prefers-reduced-motion` visitors get the poster and play button rather
 *    than ambient playback, but may still start the video themselves.
 */

const WEB_SOURCE = '/videos/stracker-ad1-web.mp4'
const ORIGINAL_SOURCE = '/videos/Stracker%20Ad1.mp4'
const POSTER = '/videos/stracker-ad1-poster.jpg'

/** The media starts warming while the frame is still this far from the viewport. */
const LOAD_ROOT_MARGIN = '320px 0px'
/** Share of the frame that must be on screen before ambient playback starts. */
const PLAY_VISIBILITY = 0.55

export function PromoVideoSection() {
  const frameRef = useRef<HTMLDivElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const userPaused = useRef(false)
  const userOptedIn = useRef(false)
  const playRequest = useRef(0)

  const [armed, setArmed] = useState(false)
  const [visible, setVisible] = useState(false)
  const [documentVisible, setDocumentVisible] = useState<boolean>(() => typeof document === 'undefined' || !document.hidden)
  const [reducedMotion, setReducedMotion] = useState<boolean>(() => typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(true)
  const [autoplayBlocked, setAutoplayBlocked] = useState(false)
  const [failed, setFailed] = useState(false)

  /* Track the visitor's motion preference live, not just at mount. */
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = (event: MediaQueryListEvent) => setReducedMotion(event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  /* A hidden tab pauses; the playback effect below resumes on return. */
  useEffect(() => {
    const onVisibilityChange = () => setDocumentVisible(!document.hidden)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [])

  /* One observer arms the media shortly before the frame scrolls in; a second
     tracks how much of the frame is actually on screen. */
  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return undefined
    if (typeof IntersectionObserver === 'undefined') {
      /* Without observers the media still arms (so a tap can play it) but
         nothing autoplays — the poster and play button carry the page. */
      setArmed(true)
      return undefined
    }

    const loader = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setArmed(true)
        loader.disconnect()
      }
    }, { rootMargin: LOAD_ROOT_MARGIN, threshold: 0 })

    const visibility = new IntersectionObserver(entries => {
      const entry = entries[entries.length - 1]
      if (!entry) return
      setVisible(entry.isIntersecting && entry.intersectionRatio >= PLAY_VISIBILITY)
    }, { threshold: [0, PLAY_VISIBILITY] })

    loader.observe(frame)
    visibility.observe(frame)
    return () => {
      loader.disconnect()
      visibility.disconnect()
    }
  }, [])

  /* A refused gesture policy (NotAllowedError) stops ambient attempts until
     the visitor presses play; a transient AbortError from rapid play/pause
     interleaving while scrolling is simply retried on the next change, and
     results superseded by a newer request are dropped. */
  const attemptPlay = useCallback((video: HTMLVideoElement) => {
    const id = ++playRequest.current
    Promise.resolve(video.play()).catch((error: unknown) => {
      if (id !== playRequest.current) return
      if (error instanceof DOMException && error.name === 'NotAllowedError') {
        setAutoplayBlocked(true)
        setPlaying(false)
      }
    })
  }, [])

  /* Ambient playback follows visibility; explicit choices always win.
     (`Promise.resolve` tolerates engines whose play() does not return a
     promise; inserting the sources already runs resource selection.) */
  useEffect(() => {
    const video = videoRef.current
    if (!video || !armed || failed) return
    const mayAmbientPlay = !reducedMotion || userOptedIn.current
    const shouldPlay = visible && documentVisible && mayAmbientPlay && !userPaused.current && !autoplayBlocked
    if (shouldPlay) {
      if (video.paused) attemptPlay(video)
    } else if (!video.paused) {
      playRequest.current += 1
      video.pause()
    }
  }, [armed, visible, documentVisible, failed, autoplayBlocked, reducedMotion, attemptPlay])

  /* React sets `muted` as a property, but a few engines reset it on load();
     re-assert it so the default stays silent until the visitor opts in. */
  useEffect(() => {
    const video = videoRef.current
    if (video) video.muted = muted
  }, [muted, armed])

  const togglePlay = () => {
    const video = videoRef.current
    if (!video || failed) return
    if (video.paused) {
      userPaused.current = false
      userOptedIn.current = true
      setAutoplayBlocked(false)
      attemptPlay(video)
    } else {
      userPaused.current = true
      playRequest.current += 1
      video.pause()
    }
  }

  const toggleMute = () => setMuted(current => !current)

  return (
    <section className="pub-section pub-section-promo" aria-labelledby="promo-title">
      <h2 id="promo-title" className="visually-hidden">Stracker in motion — a ten second product preview</h2>
      <div className="pub-shell promo-shell">
        <div className="promo-video-frame" ref={frameRef}>
          <video
            ref={videoRef}
            className="promo-video-media"
            poster={POSTER}
            preload={armed ? 'auto' : 'none'}
            playsInline
            muted={muted}
            loop
            disablePictureInPicture
            onPlay={() => { setPlaying(true); setAutoplayBlocked(false) }}
            onPause={() => setPlaying(false)}
            onError={() => setFailed(true)}
          >
            {armed && <source src={WEB_SOURCE} type="video/mp4" />}
            {armed && <source src={ORIGINAL_SOURCE} type="video/mp4" />}
          </video>
          <div className="promo-veil" aria-hidden="true" />
          {failed ? (
            <p className="promo-fallback">The preview video couldn’t load on this connection.</p>
          ) : (
            <>
              <button
                type="button"
                className={`promo-play-toggle${playing ? ' is-playing' : ''}`}
                onClick={togglePlay}
                aria-label={playing ? 'Pause the preview video' : 'Play the preview video'}
              >
                {playing
                  ? <Pause size={27} fill="currentColor" strokeWidth={0} aria-hidden="true" />
                  : <Play size={27} fill="currentColor" strokeWidth={0} aria-hidden="true" />}
              </button>
              <button
                type="button"
                className="promo-mute-toggle"
                onClick={toggleMute}
                aria-pressed={!muted}
                aria-label={muted ? 'Turn the preview sound on' : 'Turn the preview sound off'}
              >
                {muted ? <VolumeX size={22} aria-hidden="true" /> : <Volume2 size={22} aria-hidden="true" />}
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
