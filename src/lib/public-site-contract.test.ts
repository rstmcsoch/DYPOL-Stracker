import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as registryModule from './site-content/registry'
import { DEFAULT_STATS } from './site-editor/blocks-spec'

/**
 * Public-site contract.
 *
 * The homepage and the authentication entry pages are the first thing a visitor sees,
 * so the things that break silently — a link pointing at an anchor that no longer
 * exists, a route that moved, a fake control inside the hero illustration, a heavier
 * texture than intended — are asserted here rather than left to a visual check.
 */

const srcDir = fileURLToPath(new URL('../', import.meta.url))
const read = (path: string) => readFileSync(`${srcDir}${path}`, 'utf8')
const publicDir = `${srcDir}components/public/`
const publicComponentFiles = readdirSync(publicDir).filter(file => file.endsWith('.tsx'))

const app = read('App.tsx')
const landing = read('pages/LandingPage.tsx')
const publicSources = [landing, readFileSync(`${srcDir}lib/site-content/registry.ts`, 'utf8'), ...publicComponentFiles.map(file => readFileSync(`${publicDir}${file}`, 'utf8'))].join('\n')
const authPageFiles = ['pages/LoginPage.tsx', 'pages/SignupPage.tsx', 'pages/ResetPasswordPage.tsx']
const authSources = authPageFiles.map(read)
const styles = readFileSync(`${srcDir}styles/public.css`, 'utf8')
const stylesEntry = readFileSync(new URL('../styles.css', import.meta.url), 'utf8')
const authContext = read('contexts/AuthContext.tsx')

const matchAll = (source: string, pattern: RegExp) => [...source.matchAll(pattern)].map(match => match[1] ?? '')

/** Route paths declared by the router, plus the index route. */
const declaredRoutes = new Set(['/', ...matchAll(app, /path="([^"]+)"/g)])
/** Targets of in-app navigation written in the public surface. */
const publicLinkTargets = matchAll(publicSources + authSources.join('\n'), /to="([^"]+)"/g)

describe('public site routes', () => {
  it('serves the homepage to visitors and the notebook to signed-in users from the same URL', () => {
    expect(app).toContain('<Route path="/" element={<RootRoute />}>')
    const root = /function RootRoute\(\) \{([\s\S]*?)\n\}/.exec(app)?.[1] ?? ''
    expect(root).toContain('if (loading)')
    expect(root).toContain('if (!user) return <SiteGate kind="public"><SiteContentProvider withDocument><LandingPage /></SiteContentProvider></SiteGate>')
    expect(root).toContain('<Outlet />')
  })

  it('keeps log in, sign up and password recovery as separate routes', () => {
    expect(declaredRoutes).toContain('/login')
    expect(declaredRoutes).toContain('/signup')
    expect(declaredRoutes).toContain('/reset-password')
    expect(app).toContain('<Route path="/login" element={<PublicOnly><SiteGate kind="auth"><LoginPage /></SiteGate></PublicOnly>} />')
    expect(app).toContain('<Route path="/signup" element={<PublicOnly><SiteGate kind="public"><SignupPage /></SiteGate></PublicOnly>} />')
    // Recovery keeps its published route and is deliberately not wrapped in PublicOnly:
    // the emailed link signs the owner in, so redirecting an authenticated visitor away
    // from it would break the flow it exists for.
    expect(app).toContain('<Route path="/reset-password" element={<SiteGate kind="auth"><ResetPasswordPage /></SiteGate>} />')
  })

  it('sends authenticated visitors into the application instead of the marketing pages', () => {
    const publicOnly = app.match(/function PublicOnly\([\s\S]*?\n\}/)?.[0] ?? ''
    expect(publicOnly).toContain('if (user) return <Navigate to="/" replace')
    const protectedApp = /function ProtectedApp\(\) \{([\s\S]*?)\n\}/.exec(app)?.[1] ?? ''
    expect(protectedApp).toContain('<Navigate to="/login" replace')
    expect(protectedApp).toContain('if (loading) return <AppLoading />')
  })

  it('never introduces a redirect loop on the root route', () => {
    const root = /function RootRoute\(\) \{([\s\S]*?)\n\}/.exec(app)?.[1] ?? ''
    expect(root).not.toContain('<Navigate')
  })

  it('keeps every existing notebook route mounted', () => {
    for (const route of ['syllabus', 'tests', 'mistakes', 'retry', 'planner', 'revision', 'analytics', 'weak-areas', 'backup', 'settings', 'focus']) {
      expect(declaredRoutes).toContain(route)
    }
  })
})

describe('public navigation integrity', () => {
  it('only points at routes the application actually declares', () => {
    const targets = publicLinkTargets.map(target => target.split(/[?#]/)[0]).filter(Boolean)
    expect(targets.length).toBeGreaterThan(6)
    for (const target of targets) expect(declaredRoutes, `${target} is not a declared route`).toContain(target)
  })

  it('only links to anchors that exist on the page', () => {
    // Footer section links are written as at('#id') so they also work from the information pages.
    const anchors = [...matchAll(publicSources, /href="#([^"]+)"/g), ...matchAll(publicSources, /href=\{at\('#([^']+)'\)\}/g)]
    expect(anchors.length).toBeGreaterThan(8)
    for (const anchor of anchors) expect(publicSources, `#${anchor} has no target`).toContain(`id="${anchor}"`)
  })

  it('keeps the advertised navigation sections in the header and the footer', () => {
    // "Study Loop" (#why-stracker) replaced "How It Works", whose section now ships hidden.
    for (const section of ['#features', '#why-stracker', '#ai', '#privacy']) {
      expect(publicSources).toContain(`href: '${section}'`)
    }
    expect(publicSources).not.toContain(`href: '#how-it-works'`)
    expect(readFileSync(`${publicDir}PublicFooter.tsx`, 'utf8')).toContain('new Date().getFullYear()')
  })
})

describe('homepage honesty', () => {
  it('keeps the illustrative notebook page a clearly labelled, local-only sample', () => {
    const preview = readFileSync(`${publicDir}NotebookPreview.tsx`, 'utf8')
    // The only controls are the sample task ticks: local state, announced as toggles, never saved.
    expect(preview).not.toMatch(/<input|<form|fetch\(|supabase|localStorage/i)
    expect([...preview.matchAll(/<button/g)]).toHaveLength(1)
    expect(preview).toContain('aria-pressed')
    expect(preview).toContain('Sample workspace')
    expect(preview).toContain('aria-hidden="true"')
    expect(preview).toContain('<figcaption')
  })

  it('describes Stracker AI as it ships: built-in models with a daily limit, or your own provider', () => {
    // Copy lives in the editable content registry; the component only renders it.
    const sections = readFileSync(`${srcDir}lib/site-content/registry.ts`, 'utf8')
    expect(sections).toContain('built-in AI with a daily limit')
    expect(sections).toContain('works without AI.')
    expect(sections).not.toMatch(/unlimited ai|free ai|free inference|DYPOL does not supply/i)
  })

  it('keeps homepage privacy copy jargon-free and the technical detail on the Privacy Policy', () => {
    const { SITE_CONTENT_DEFAULTS } = registryModule
    const homepage = Object.entries(SITE_CONTENT_DEFAULTS).filter(([key]) => /^public\.(privacy|ai)\./.test(key)).map(([, value]) => value).join('\n')
    expect(homepage).not.toMatch(/military-grade|bank-level|unhackable/i)
    expect(homepage).not.toMatch(/row-level|postgres|anonymous role|supabase|public key|AES-256|ciphertext/i)
    const policy = readFileSync(`${srcDir}lib/site-content/info-page-defaults.ts`, 'utf8')
    expect(policy).toContain('row-level security')
    expect(policy).toContain('AES-256-GCM')
    expect(policy).toContain('anonymous role')
  })

  it('keeps homepage copy short: the word limits from the copy-simplification brief', () => {
    const d = registryModule.SITE_CONTENT_DEFAULTS
    const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length
    const over: string[] = []
    const check = (key: string, max: number) => { const n = words(d[key] ?? ''); if (n > max) over.push(`${key}: ${n} > ${max}`) }
    for (const s of ['hero', 'loop', 'features', 'ai', 'privacy', 'final']) check(`public.${s}.title`, 10)
    check('public.hero.lede', 16)
    for (const s of ['loop', 'features', 'ai', 'privacy']) check(`public.${s}.lede`, 16)
    for (let n = 1; n <= 8; n++) {
      check(`public.features.item_${n}.summary`, 12)
      for (const point of (d[`public.features.item_${n}.points`] ?? '').split('\n')) if (words(point) > 8) over.push(`feature ${n} point: ${point}`)
    }
    for (let n = 1; n <= 5; n++) check(`public.loop.step_${n}.body`, 12)
    for (let n = 1; n <= 4; n++) check(`public.ai.fact_${n}.body`, 12)
    for (let n = 1; n <= 6; n++) check(`public.privacy.item_${n}.body`, 12)
    for (const key of ['public.dypol.body', 'public.final.body', 'public.final.note', 'public.promo.body', 'public.privacy.foot', 'public.loop.footnote']) check(key, 12)
    for (const stat of DEFAULT_STATS) if (words(stat.label) > 8) over.push(`stat: ${stat.label}`)
    expect(over).toEqual([])
  })

  it('never claims students can create their own subjects, or a ready syllabus for every exam', () => {
    const copy = Object.entries(registryModule.SITE_CONTENT_DEFAULTS).filter(([key]) => key.startsWith('public.') && !key.startsWith('public.footer.') && !/principles|how\./.test(key)).map(([, value]) => value).join('\n')
    expect(copy).not.toMatch(/(add|create|build) (or choose )?your (own )?subjects/i)
    expect(copy).not.toMatch(/every exam has|syllabus for every exam/i)
  })

  it('never renders a provider secret or service key on the public surface', () => {
    expect(publicSources).not.toMatch(/SERVICE_ROLE|service_role|AI_CREDENTIALS_ENCRYPTION_KEY/)
    // A provider key looks like a long opaque token; short dashed class names must not trip this.
    expect(publicSources).not.toMatch(/\bsk-[A-Za-z0-9]{10,}/)
    expect(publicSources).not.toMatch(/import\.meta\.env/)
  })
})

describe('public authentication', () => {
  it('creates real Supabase accounts instead of local-only ones', () => {
    expect(authContext).toContain('supabase.auth.signUp({')
    expect(authContext).toContain('emailRedirectTo')
    expect(authContext).toContain('needsEmailConfirmation: !data.session')
    const signup = read('pages/SignupPage.tsx')
    expect(signup).toContain('await signUp(email, password, displayName, captchaToken)')
    expect(signup).not.toMatch(/localStorage|fake|mock account/i)
    expect(signup).toContain('Create my Stracker account')
  })

  it('respects email confirmation and password recovery behaviour', () => {
    expect(authContext).toContain("supabase.auth.resend({ type: 'signup', email: email.trim(), options: captchaToken ? { captchaToken } : undefined })")
    expect(authContext).toContain('resetPasswordForEmail(email.trim()')
    expect(authContext).toContain('/reset-password')
    const login = read('pages/LoginPage.tsx')
    expect(login).toContain('await signIn(email, password, captchaToken)')
    expect(login).toContain('to="/signup"')
  })
})

describe('public stylesheet', () => {
  it('is loaded from the single shared entry after the base layer', () => {
    expect(stylesEntry.indexOf('base.css')).toBeLessThan(stylesEntry.indexOf('public.css'))
    expect(stylesEntry.indexOf('public.css')).toBeLessThan(stylesEntry.indexOf('responsive.css'))
  })

  it('guards every fixed pixel minimum inside a grid track', () => {
    for (const line of styles.split('\n')) {
      if (!line.includes('grid-template-columns')) continue
      expect(line, `unguarded grid track: ${line.trim()}`).not.toMatch(/minmax\(\s*\d+(?:\.\d+)?px/)
    }
  })

  it('keeps the grain light, local and cheap', () => {
    const grain = /\.pub-grain \{([^}]*)\}/.exec(styles)?.[1] ?? ''
    expect(grain).toContain('pointer-events: none')
    expect(grain).toContain('data:image/svg+xml')
    const opacity = Number(/opacity:\s*\.(\d+)/.exec(grain)?.[1] ?? '99')
    expect(opacity).toBeGreaterThan(0)
    expect(opacity).toBeLessThanOrEqual(6)
    // No remote assets, no video backgrounds, no stock imagery in the public layer.
    expect(styles).not.toMatch(/url\(["']?https?:/)
    expect(styles).not.toMatch(/<img|\.mp4|<video/)
  })

  it('respects reduced-motion preferences on every animated element it adds', () => {
    const reduce = styles.slice(styles.indexOf('@media (prefers-reduced-motion: reduce)'))
    expect(reduce).toContain('.hero-sheet')
    expect(reduce).toContain('.hero-scroll svg')
    expect(reduce).toContain('animation: none')
  })

  it('defines a mobile header that keeps the account actions reachable', () => {
    expect(styles).toContain('.pub-menu-trigger')
    expect(styles).toContain('.pub-menu-link')
    const header = readFileSync(`${publicDir}PublicHeader.tsx`, 'utf8')
    // The mobile panel repeats both account actions rather than hiding them.
    expect(header).toContain('aria-expanded={open}')
    expect(header).toContain('aria-controls="stracker-public-menu"')
    expect(header.match(/to="\/login"/g)?.length).toBe(2)
    expect(header.match(/to="\/signup"/g)?.length).toBe(2)
  })
})
