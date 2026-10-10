import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Pause, Play, Volume2, VolumeX } from 'lucide-react'
import { useSiteValues } from '../../contexts/SiteContentContext'
import { ASPECT_PRESETS, controlSizes, resolvePromoVideoConfig } from '../../lib/promo-video-config'

/**
 * Public-homepage promotional player.
 *
 * Everything owner-configurable arrives through the site-content system
 * (`public.video.*` keys) and is re-clamped by resolvePromoVideoConfig, so a
 * saved value can never break the responsive layout, the aspect ratio or the
 * accessibility safeguards. With no saved configuration the defaults reproduce
 * the shipped player exactly.
 *
 * Media resolution:
 *  - the published `public.video.src` (an object in the `homepage-media`
 *    storage bucket) is the primary source once set;
 *  - the bundled, compressed web cut is the default primary and the fallback
 *    behind a custom upload; the untouched original edit remains the last
 *    resort when the built-in pair is used;
 *  - sources arm via IntersectionObserver shortly before the frame enters the
 *    viewport, so nothing downloads for visitors who never scroll here.
 *
 * Behaviour contract (unchanged by configuration):
 *  - muted, looping, inline autoplay once most of the frame is visible;
 *  - pause off-screen, resume on return unless the visitor explicitly paused;
 *  - a refused autoplay attempt falls back to the poster plus play button;
 *  - `prefers-reduced-motion` visitors get a manual start;
 *  - hidden tabs pause.
 */

const DEFAULT_WEB_SOURCE = '/videos/stracker-ad1-web.mp4'
const DEFAULT_ORIGINAL_SOURCE = '/videos/Stracker%20Ad1.mp4'
const DEFAULT_POSTER = '/videos/stracker-ad1-poster.jpg'

/** The media starts warming while the frame is still this far from the viewport. */
const LOAD_ROOT_MARGIN = '320px 0px'

/** Once this fraction of the frame is on screen, ambient playback may start. */
const PLAY_VISIBILITY = 0.55

export function PromoVideoSection() {
  const values = useSiteValues()
  const config = useMemo(() => resolvePromoVideoConfig(values), [values])

  const frameRef = useRef<HTMLDivElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const userPaused = useRef(false)
  const userOptedIn = useRef(false)
  const playRequest = useRef(0)

  const [armed, setArmed] = useState(false)
  const [visible, setVisible] = useState(false)
  const [documentVisible, setDocumentVisible] = useState(true)
  const [reducedMotion, setReducedMotion] = useState(
    typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [playing, setPlaying] = useState(false)
  const [started, setStarted] = useState(false)
  const [muted, setMuted] = useState(config.muted)
  const [measuredRatio, setMeasuredRatio] = useState<number | null>(null)
  const [autoplayBlocked, setAutoplayBlocked] = useState(false)
  const [failed, setFailed] = useState(false)

  /* The owner's playback switches apply on config changes (live preview). */
  useEffect(() => { setMuted(config.muted) }, [config.muted])

  /* Track the visitor's motion preference live, not just at mount. */
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReducedMotion(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  /* Arm sources once the frame approaches the viewport. */
  useEffect(() => {
    const frame = frameRef.current
    if (!frame || armed) return undefined
    if (typeof IntersectionObserver !== 'function') { setArmed(true); return undefined }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setArmed(true)
        observer.disconnect()
      }
    }, { rootMargin: LOAD_ROOT_MARGIN })
    observer.observe(frame)
    return () => observer.disconnect()
  }, [armed])

  /* Visibility for ambient play. */
  useEffect(() => {
    const frame = frameRef.current
    if (!frame || !armed) return undefined
    if (typeof IntersectionObserver !== 'function') { setVisible(true); return undefined }
    const observer = new IntersectionObserver(entries => {
      setVisible(entries.some(entry => entry.isIntersecting && entry.intersectionRatio >= PLAY_VISIBILITY))
    }, { threshold: [0, PLAY_VISIBILITY, 1] })
    observer.observe(frame)
    return () => observer.disconnect()
  }, [armed])

  useEffect(() => {
    const onVisibility = () => setDocumentVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  /* A refused gesture policy (NotAllowedError) stops ambient attempts until
     the visitor presses play; a transient AbortError from rapid play/pause
     interleaving while scrolling is retried on the next change, and results
     superseded by a newer request are dropped. */
  const attemptPlay = useCallback((video: HTMLVideoElement) => {
    const id = ++playRequest.current
    Promise.resolve(video.play()).catch((error: unknown) => {
      if (playRequest.current !== id) return
      if (error instanceof DOMException && error.name === 'NotAllowedError') {
        setAutoplayBlocked(true)
      }
    })
  }, [])

  /* Ambient playback follows visibility; explicit choices always win. */
  useEffect(() => {
    const video = videoRef.current
    if (!video || !armed || failed) return
    const mayAmbientPlay = config.autoplay && (!reducedMotion || userOptedIn.current)
    const shouldPlay = visible && documentVisible && mayAmbientPlay && !userPaused.current && !autoplayBlocked
    if (shouldPlay) {
      if (video.paused) attemptPlay(video)
    } else {
      playRequest.current += 1
      video.pause()
    }
  }, [armed, visible, documentVisible, failed, autoplayBlocked, reducedMotion, config.autoplay, attemptPlay])

  /* React sets `muted` as a property, but a few engines reset it on load();
     re-assert it so the default stays silent until the visitor opts in. */
  useEffect(() => {
    const video = videoRef.current
    if (video) video.muted = muted
  }, [muted, armed])

  const onPlayClick = () => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      userPaused.current = false
      userOptedIn.current = true
      setAutoplayBlocked(false)
      void video.play()
    } else {
      userPaused.current = true
      video.pause()
    }
  }

  const toggleMute = () => setMuted(current => !current)

  const onLoadedMetadata = () => {
    const video = videoRef.current
    if (!video || !video.videoWidth || !video.videoHeight) return
    const ratio = video.videoWidth / video.videoHeight
    if (Number.isFinite(ratio)) setMeasuredRatio(Math.min(2.4, Math.max(0.4, ratio)))
  }

  if (!config.enabled) return null

  const ratio = config.aspect === 'auto'
    ? (measuredRatio ?? 9 / 16)
    : ASPECT_PRESETS[config.aspect]
  const sizes = controlSizes(config.controlScale)

  const sources = config.src
    ? [config.src, DEFAULT_WEB_SOURCE]
    : [DEFAULT_WEB_SOURCE, DEFAULT_ORIGINAL_SOURCE]

  const frameStyle = {
    '--promo-ar': ratio.toFixed(4),
    '--promo-dh-n': String(config.desktopVh),
    '--promo-th-n': String(config.tabletVh),
    '--promo-mh-n': String(config.mobileVh),
    '--promo-max-w': `${config.maxWidth}px`,
    '--promo-radius': `${config.radius}px`,
    '--promo-fade-opacity': config.fade ? (config.fadeStrength / 100).toFixed(2) : '0',
    '--promo-play': `${sizes.play}px`,
    '--promo-play-m': `${sizes.playMobile}px`,
    '--promo-speaker': `${sizes.speaker}px`,
    '--promo-speaker-m': `${sizes.speakerMobile}px`
  } as CSSProperties

  const sectionStyle = {
    '--promo-spacing': `${config.spacing}px`,
    '--promo-spacing-m': `${config.spacingMobile}px`
  } as CSSProperties

  return (
    <section className="pub-section pub-section-promo" style={sectionStyle} aria-labelledby="promo-title">
      <h2 id="promo-title" className="visually-hidden">Stracker in motion — a ten second product preview</h2>
      <div className="pub-shell promo-shell">
        <div
          className="promo-video-frame"
          ref={frameRef}
          style={frameStyle}
          data-shadow={config.shadow}
          data-theme={config.theme === 'auto' ? undefined : config.theme}
        >
          <video
            ref={videoRef}
            className="promo-video-media"
            poster={config.poster || DEFAULT_POSTER}
            preload={armed ? 'auto' : 'none'}
            playsInline
            muted={muted}
            loop={config.loop}
            disablePictureInPicture
            onPlay={() => { setPlaying(true); setStarted(true); setAutoplayBlocked(false) }}
            onPause={() => setPlaying(false)}
            onLoadedMetadata={onLoadedMetadata}
            onError={() => setFailed(true)}
          >
            {armed && sources.map(src => <source key={src} src={src} type="video/mp4" />)}
          </video>
          {!failed && !started && (
            <img
              className="promo-poster"
              src={config.poster || DEFAULT_POSTER}
              alt=""
              loading="lazy"
              decoding="async"
              style={{ objectFit: config.posterFit }}
            />
          )}
          <div className="promo-veil" aria-hidden="true" />
          {failed ? (
            <p className="promo-fallback">The preview video couldn’t load on this connection.</p>
          ) : (
            <>
              <button
                type="button"
                className={`promo-play-toggle${playing ? ' is-playing' : ''}`}
                onClick={onPlayClick}
                aria-label={playing ? 'Pause the preview video' : 'Play the preview video'}
              >
                {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
              </button>
              <button
                type="button"
                className="promo-mute-toggle"
                onClick={toggleMute}
                aria-label={muted ? 'Unmute the preview video' : 'Mute the preview video'}
                aria-pressed={!muted}
              >
                {muted ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
