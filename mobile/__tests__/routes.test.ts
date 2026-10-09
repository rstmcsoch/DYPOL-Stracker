/**
 * Route parity and link integrity. The website's route table in src/App.tsx is the reference: every
 * path it declares must exist as an Expo Router file, and every internal link in the app's source must
 * resolve to a route. These checks read source files only.
 */
import { readFileSync, readdirSync, statSync } from 'fs'
import { basename, join, relative } from 'path'

const mobileRoot = join(__dirname, '..')
const appDir = join(mobileRoot, 'src', 'app')
const sourceDir = join(mobileRoot, 'src')

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}

/** Expo Router paths from src/app: route groups like (app) are dropped, index maps to its parent. */
function mobileRoutes(): Set<string> {
  const routes = new Set<string>()
  for (const file of walk(appDir).filter(name => /\.(tsx|ts)$/.test(name))) {
    const name = basename(file)
    if (name.startsWith('_') || name.startsWith('+')) continue
    const segments = relative(appDir, file)
      .replace(/\\/g, '/')
      .replace(/\.(tsx|ts)$/, '')
      .split('/')
      .filter(segment => !/^\(.*\)$/.test(segment) && segment !== 'index')
    routes.add(`/${segments.join('/')}`.replace(/\/$/, '') || '/')
  }
  return routes
}

function normalise(path: string): string {
  return path.replace(/[?#].*$/, '').replace(/\/+$/, '') || '/'
}

describe('route parity with the website', () => {
  const websiteApp = readFileSync(join(mobileRoot, '..', 'src', 'App.tsx'), 'utf8')
  const websitePaths = [...websiteApp.matchAll(/path="([^"]+)"/g)].map(match => match[1] ?? '').filter(path => path !== '*')

  it('reads the website route table (guards against an empty pass)', () => {
    expect(websitePaths.length).toBeGreaterThanOrEqual(18)
  })

  it('has an Expo Router screen for every website route', () => {
    const routes = mobileRoutes()
    // The website mixes absolute (/login) and nested (analytics) paths; both map to a leading slash.
    const missing = websitePaths
      .map(path => (path.startsWith('/') ? path : `/${path}`))
      .filter(path => path !== '/' && !routes.has(path))
    expect(missing).toEqual([])
    expect(routes.has('/')).toBe(true)
    expect(routes.has('/home')).toBe(true)
  })
})

describe('internal links', () => {
  const linkPattern = /(?:href|to|route|push|replace|navigate)\s*[:=(]\s*\{?\s*(['"`])(\/[^'"`]*)\1/g
  const sources = walk(sourceDir).filter(file => /\.(ts|tsx)$/.test(file) && !file.includes('__generated'))

  it('point only at routes that exist', () => {
    const routes = mobileRoutes()
    const targets: { file: string; path: string }[] = []
    for (const file of sources) {
      const text = readFileSync(file, 'utf8')
      for (const match of text.matchAll(linkPattern)) {
        const path = match[2] ?? ''
        if (path.includes('${') || path.startsWith('/api/')) continue
        targets.push({ file: relative(mobileRoot, file), path })
      }
    }
    expect(targets.length).toBeGreaterThan(10)
    const broken = targets.filter(target => !routes.has(normalise(target.path)))
    expect(broken).toEqual([])
  })
})
