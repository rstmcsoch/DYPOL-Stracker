import { useEffect, type RefObject } from 'react'

/**
 * Homepage-only motion. Everything here is decorative and opt-in:
 * - one passive scroll listener, throttled to one requestAnimationFrame;
 * - transforms and opacity only (no layout writes), set on a handful of elements;
 * - IntersectionObserver for reveals, so nothing runs for content off screen;
 * - `prefers-reduced-motion` turns parallax, tilt, reveals and confetti off.
 * Nothing in this file affects the notebook or the Control Center.
 */

/** Largest scroll-parallax offset for a decorative doodle, in px. */
const PARALLAX_MAX = 40

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

const CONFETTI_COLORS = ['#2f5cff', '#ffd84d', '#ff8fa3', '#16b981', '#8b5cf6']

/** A short confetti burst from the top of `host`; pieces remove themselves. */
export function burstConfetti(host: HTMLElement, count: number) {
  let layer = host.querySelector<HTMLElement>(':scope > .hp-confetti')
  if (!layer) {
    layer = document.createElement('div')
    layer.className = 'hp-confetti'
    layer.setAttribute('aria-hidden', 'true')
    host.appendChild(layer)
  }
  for (let i = 0; i < count; i += 1) {
    const piece = document.createElement('i')
    piece.style.left = `${Math.random() * 100}%`
    piece.style.setProperty('--c', CONFETTI_COLORS[i % CONFETTI_COLORS.length] ?? '#2f5cff')
    piece.style.setProperty('--dx', `${Math.round(Math.random() * 120 - 60)}px`)
    piece.style.setProperty('--t', `${(1.4 + Math.random() * 1.2).toFixed(2)}s`)
    piece.style.setProperty('--dl', `${(Math.random() * .3).toFixed(2)}s`)
    layer.appendChild(piece)
    window.setTimeout(() => piece.remove(), 3200)
  }
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

export function useHomeMotion(rootRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = rootRef.current
    if (!root) return undefined
    const reduce = prefersReducedMotion()
    const cleanups: Array<() => void> = []
    const hasIO = typeof IntersectionObserver !== 'undefined'

    /* Reveals: content is only hidden once this script is running and motion is allowed. */
    if (!reduce && hasIO) {
      root.classList.add('hp-motion')
      const reveal = new IntersectionObserver(entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) { entry.target.classList.add('is-in'); reveal.unobserve(entry.target) }
        }
      }, { threshold: .12, rootMargin: '0px 0px -6% 0px' })
      root.querySelectorAll('[data-reveal]').forEach(node => reveal.observe(node))
      cleanups.push(() => { reveal.disconnect(); root.classList.remove('hp-motion') })
    }

    const q = <T extends Element = HTMLElement>(selector: string) => root.querySelector<T & HTMLElement>(selector)
    const blobs = [q('#px1'), q('#px2'), q('#px3')]
    const blobSpeed = [.06, -.08, .05]
    const doodles = Array.from(root.querySelectorAll<HTMLElement>('[data-px]'))
    const barFill = q('.hp-progress-fill')
    const penFill = q('.hp-pencil-fill')
    const pen = q('.hp-pencil-tip')
    const penTrack = q('.hp-pencil')
    const steps = q('.hp-steps')
    const stepFill = q('.hp-steps-fill')
    const wordmark = q('.pub-footer-wordmark')
    const wordWindow = q('.pub-footer-wordmark-window')
    const navLinks = Array.from(root.querySelectorAll<HTMLAnchorElement>('.pub-nav-link[href^="#"]'))
    const navTargets = navLinks.map(link => document.getElementById(link.hash.slice(1)))

    let ticking = false
    let activeIndex = -2
    const frame = () => {
      ticking = false
      const y = window.scrollY || 0
      const vh = window.innerHeight || 1
      const max = Math.max(1, document.documentElement.scrollHeight - vh)
      const progress = clamp01(y / max)
      if (barFill) barFill.style.transform = `scaleX(${progress.toFixed(4)})`
      if (penFill) penFill.style.transform = `scaleY(${progress.toFixed(4)})`
      if (pen && penTrack) pen.style.transform = `translate(-50%, ${(progress * penTrack.clientHeight).toFixed(1)}px)`

      if (steps && stepFill) {
        const rect = steps.getBoundingClientRect()
        const fill = rect.height ? clamp01((vh * .62 - rect.top) / rect.height) : 0
        stepFill.style.transform = `scaleY(${reduce ? 1 : fill.toFixed(3)})`
        steps.querySelectorAll<HTMLElement>('.hp-step').forEach(step => {
          const stepRect = step.getBoundingClientRect()
          step.classList.toggle('is-reached', reduce || stepRect.top < vh * .62)
        })
      }

      if (!reduce) {
        blobs.forEach((blob, index) => { if (blob) blob.style.transform = `translate3d(0, ${(y * (blobSpeed[index] ?? 0)).toFixed(1)}px, 0)` })
        // Gentle parallax, measured against each doodle's own section and capped, so a doodle can
        // never drift past its section (an uncapped offset once grew the page below the footer).
        doodles.forEach(node => {
          const host = node.closest('section') ?? node.parentElement
          if (!host) return
          const box = host.getBoundingClientRect()
          if (box.bottom < -vh || box.top > vh * 2) return
          const shift = (vh / 2 - (box.top + box.height / 2)) * (Number(node.dataset.px) || 0) / 100
          node.style.translate = `0 ${Math.max(-PARALLAX_MAX, Math.min(PARALLAX_MAX, shift)).toFixed(1)}px`
        })
        if (wordmark && wordWindow) {
          const rect = wordWindow.getBoundingClientRect()
          if (rect.top < vh + 200) {
            const rise = rect.height ? clamp01((vh - rect.top) / rect.height) : 1
            wordmark.style.transform = `translate3d(0, ${((1 - rise) * 45).toFixed(1)}%, 0)`
          }
        }
      }

      let current = -1
      navTargets.forEach((target, index) => {
        if (!target) return
        const rect = target.getBoundingClientRect()
        if (rect.top < vh * .4 && rect.bottom > vh * .4) current = index
      })
      if (current !== activeIndex) {
        activeIndex = current
        navLinks.forEach((link, index) => {
          link.classList.toggle('is-active', index === current)
          if (index === current) link.setAttribute('aria-current', 'location')
          else link.removeAttribute('aria-current')
        })
      }
    }
    const request = () => { if (!ticking) { ticking = true; window.requestAnimationFrame(frame) } }
    window.addEventListener('scroll', request, { passive: true })
    window.addEventListener('resize', request, { passive: true })
    cleanups.push(() => {
      window.removeEventListener('scroll', request)
      window.removeEventListener('resize', request)
      navLinks.forEach(link => { link.classList.remove('is-active'); link.removeAttribute('aria-current') })
    })
    frame()

    /* Pointer-only hero tilt and doodle drift (mouse/trackpad; never on touch). */
    const hero = q('.hp-hero')
    const sheet = q('[data-tilt]')
    const fine = typeof window.matchMedia === 'function' && window.matchMedia('(hover: hover) and (pointer: fine)').matches
    if (hero && sheet && fine && !reduce) {
      const depth = Array.from(hero.querySelectorAll<HTMLElement>('[data-depth]'))
      let pending: PointerEvent | null = null
      const apply = () => {
        const event = pending
        pending = null
        if (!event) return
        const heroRect = hero.getBoundingClientRect()
        const nx = (event.clientX - heroRect.left) / heroRect.width - .5
        const ny = (event.clientY - heroRect.top) / heroRect.height - .5
        depth.forEach(node => {
          const d = Number(node.dataset.depth) || 0
          node.style.transform = `translate3d(${(nx * d * 2).toFixed(1)}px, ${(ny * d * 2).toFixed(1)}px, 0)`
        })
        const r = sheet.getBoundingClientRect()
        const sx = Math.max(-.7, Math.min(.7, (event.clientX - r.left) / r.width - .5))
        const sy = Math.max(-.7, Math.min(.7, (event.clientY - r.top) / r.height - .5))
        sheet.style.transform = `perspective(1100px) rotateX(${(sy * -7).toFixed(2)}deg) rotateY(${(sx * 8).toFixed(2)}deg)`
      }
      const onMove = (event: PointerEvent) => {
        if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return
        const first = pending === null
        pending = event
        if (first) window.requestAnimationFrame(apply)
      }
      const onLeave = () => {
        pending = null
        sheet.style.transform = ''
        depth.forEach(node => { node.style.transform = '' })
      }
      hero.addEventListener('pointermove', onMove, { passive: true })
      hero.addEventListener('pointerleave', onLeave, { passive: true })
      cleanups.push(() => {
        hero.removeEventListener('pointermove', onMove)
        hero.removeEventListener('pointerleave', onLeave)
      })
    }

    return () => cleanups.forEach(cleanup => cleanup())
  }, [rootRef])
}
