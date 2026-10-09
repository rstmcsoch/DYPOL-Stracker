import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Control Center isolation contract. These checks keep the private console out of the
 * public site, out of crawler discovery, and out of any browser bundle that could carry a
 * server secret. Each assertion reads the real file, so a regression fails the test.
 */

const root = fileURLToPath(new URL('../../', import.meta.url))
const read = (path: string) => readFileSync(join(root, path), 'utf8')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(relative(root, full))
  }
  return out
}

const isTest = (file: string) => /\.test\.tsx?$/.test(file)
const sourceFiles = walk(join(root, 'src')).filter(file => /\.(ts|tsx|js|jsx|css)$/.test(file) && !isTest(file))
/** Public and dashboard UI. The router (App.tsx) is excluded because it must mount the console. */
const publicSiteFiles = sourceFiles.filter(file => !file.startsWith('src/control/') && file !== 'src/App.tsx')

/** Removes // and block comments so assertions check code, not explanatory prose. */
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')

describe('control center isolation', () => {
  it('mounts the console only at /control-panel and keeps the public routes intact', () => {
    const app = read('src/App.tsx')
    expect(app).toMatch(/path="\/control-panel\/\*"/)
    expect(app).toMatch(/lazy\(\(\) => import\('\.\/control\/ControlPanelApp'\)\)/)
  })

  it('never links to the console from the public site, dashboard navigation, or the sitemap', () => {
    for (const file of publicSiteFiles) {
      const source = readFileSync(join(root, file), 'utf8')
      expect(source, file).not.toMatch(/['"`]\/control-panel/)
    }
    const sitemapPath = join(root, 'public', 'sitemap.xml')
    if (existsSync(sitemapPath)) expect(readFileSync(sitemapPath, 'utf8')).not.toContain('control-panel')
  })

  it('sends noindex from the server for every console path', () => {
    const vercel = JSON.parse(read('vercel.json')) as { headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }> }
    const rule = vercel.headers.find(entry => entry.source === '/control-panel(.*)')
    expect(rule?.headers).toContainEqual({ key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' })
  })

  it('does not disallow the console in robots.txt, which would hide the noindex directive', () => {
    const robotsPath = join(root, 'public', 'robots.txt')
    if (existsSync(robotsPath)) expect(readFileSync(robotsPath, 'utf8')).not.toMatch(/control-panel/)
  })

  it('keeps every service-role and secret identifier out of browser code', () => {
    const forbidden = [/SERVICE_ROLE/i, /service_role_key/i, /sb_secret_/, /VITE_[A-Z_]*(SECRET|SERVICE|PRIVATE)/]
    for (const file of sourceFiles) {
      const source = code(readFileSync(join(root, file), 'utf8'))
      for (const pattern of forbidden) expect(source, `${file} matches ${pattern}`).not.toMatch(pattern)
    }
  })

  it('keeps the console free of client-side role decisions', () => {
    const consoleSources = sourceFiles.filter(file => file.startsWith('src/control/') && !file.endsWith('.test.tsx') && !file.endsWith('.test.ts'))
    for (const file of consoleSources) {
      const source = readFileSync(join(root, file), 'utf8')
      expect(source, file).not.toMatch(/localStorage|sessionStorage/)
      expect(source, file).not.toMatch(/user_metadata|app_metadata/)
    }
  })

  it('grants the admin tables to the service role only, never to anon or authenticated', () => {
    const migrations = walk(join(root, 'supabase', 'migrations')).filter(file => file.includes('control_center_admin'))
    expect(migrations).toHaveLength(1)
    const sql = code(read(migrations[0] ?? '').replace(/--[^\n]*/g, ''))
    expect(sql).not.toMatch(/grant[^;]*\bto\s+(anon|authenticated|public)\b/i)
    expect(sql).toMatch(/enable row level security/)
    expect(sql).not.toMatch(/create policy[^;]*\bto\s+(anon|authenticated|public)\b/i)
    expect(sql).not.toMatch(/\bdrop\s+table\b(?![^;]*if exists)/i)
    expect(sql).not.toMatch(/\bdelete\s+from\s+(public\.)?(profiles|auth\.|user)/i)
  })

  it('bootstraps the owner through a script that never creates, verifies, or resets accounts', () => {
    const script = code(read('scripts/owner-provisioning.mjs'))
    expect(script).not.toMatch(/createUser|resetPassword|updateUserById\(\s*[^)]*password/)
    expect(script).not.toMatch(/password/i)
  })
})
