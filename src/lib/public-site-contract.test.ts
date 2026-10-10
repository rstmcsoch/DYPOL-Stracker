import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

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
    expect(root).toContain('if (!user) return <SiteContentProvider><LandingPage /></SiteContentProvider>')
    expect(root).toContain('<Outlet />')
  })

  it('keeps log in, sign up and password recovery as separate routes', () => {
    expect(declaredRoutes).toContain('/login')
    expect(declaredRoutes).toContain('/signup')
    expect(declaredRoutes).toContain('/reset-password')
    expect(app).toContain('<Route path="/login" element={<PublicOnly><LoginPage /></PublicOnly>} />')
    expect(app).toContain('<Route path="/signup" element={<PublicOnly><SignupPage /></PublicOnly>} />')
    // Recovery keeps its published route and is deliberately not wrapped in PublicOnly:
    // the emailed link signs the owner in, so redirecting an authenticated visitor away
    // from it would break the flow it exists for.
    expect(app).toContain('<Route path="/reset-password" element={<ResetPasswordPage />} />')
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
    const anchors = matchAll(publicSources, /href="#([^"]+)"/g)
    expect(anchors.length).toBeGreaterThan(8)
    for (const anchor of anchors) expect(publicSources, `#${anchor} has no target`).toContain(`id="${anchor}"`)
  })

  it('keeps the advertised navigation sections in the header and the footer', () => {
    for (const section of ['#features', '#how-it-works', '#ai', '#privacy']) {
      expect(publicSources).toContain(`href: '${section}'`)
    }
    expect(readFileSync(`${publicDir}PublicFooter.tsx`, 'utf8')).toContain('new Date().getFullYear()')
  })
})

describe('homepage honesty', () => {
  it('contains no fake controls inside the illustrative notebook page', () => {
    const preview = readFileSync(`${publicDir}NotebookPreview.tsx`, 'utf8')
    expect(preview).not.toMatch(/<button/)
    expect(preview).not.toMatch(/<input/)
    expect(preview).toContain('aria-hidden="true"')
    expect(preview).toContain('<figcaption')
  })

  it('claims no AI inference that DYPOL does not provide', () => {
    // Copy lives in the editable content registry; the component only renders it.
    const sections = readFileSync(`${srcDir}lib/site-content/registry.ts`, 'utf8')
    expect(sections).toContain('DYPOL does not supply or proxy a model key')
    expect(sections).toContain('with AI switched off')
    expect(sections).not.toMatch(/unlimited ai|free ai|free inference/i)
  })

  it('keeps the privacy section to claims the architecture supports', () => {
    const sections = readFileSync(`${srcDir}lib/site-content/registry.ts`, 'utf8')
    expect(sections).not.toMatch(/military-grade|bank-level|unhackable/i)
    expect(sections).toContain('row-level security')
    expect(sections).toContain('AES-256-GCM')
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
    expect(signup).toContain('await signUp(email, password, displayName)')
    expect(signup).not.toMatch(/localStorage|fake|mock account/i)
    expect(signup).toContain('Create my Stracker account')
  })

  it('respects email confirmation and password recovery behaviour', () => {
    expect(authContext).toContain("supabase.auth.resend({ type: 'signup', email: email.trim() })")
    expect(authContext).toContain('resetPasswordForEmail(email.trim()')
    expect(authContext).toContain('/reset-password')
    const login = read('pages/LoginPage.tsx')
    expect(login).toContain('await signIn(email, password)')
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
