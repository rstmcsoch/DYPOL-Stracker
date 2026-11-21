import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('exam-neutral PWA manifest, metadata, and public branding', () => {
  it('keeps the PWA manifest exam-neutral (never JEE-specific)', () => {
    const vite = read('vite.config.ts')
    const manifestStart = vite.indexOf('manifest: {')
    const workboxStart = vite.indexOf('workbox: {')
    const manifestBlock = vite.slice(manifestStart, workboxStart)

    expect(manifestBlock).toContain("name: 'Stracker — Exam Study Notebook'")
    expect(manifestBlock).toContain("short_name: 'Stracker'")
    expect(manifestBlock).toContain("description: 'A private study notebook for exam plans, revision, tests and focus sessions — by DYPOL LABS.'")
    expect(manifestBlock).toContain("orientation: 'any'")
    expect(manifestBlock).not.toMatch(/\bJEE\b/i)
  })

  it('keeps index.html and head defaults exam-neutral', () => {
    const html = read('index.html')
    const head = read('src/lib/head.ts')

    expect(html).toContain('<title>Stracker — Exam Study Notebook</title>')
    expect(html).not.toMatch(/\bJEE\b/i)
    expect(head).toContain("APP_TITLE = 'Stracker — Exam Study Notebook'")
    expect(head).not.toMatch(/\bJEE\b/i)
  })

  it('keeps public auth pages and AppShell brand subtitle exam-neutral', () => {
    for (const file of ['src/pages/LoginPage.tsx', 'src/pages/SignupPage.tsx', 'src/pages/ResetPasswordPage.tsx']) {
      expect(read(file)).not.toMatch(/\bJEE\b/i)
    }
    const shell = read('src/components/AppShell.tsx')
    expect(shell).toContain('>STUDY HOME</small>')
    expect(shell).not.toContain('JEE STUDY HOME')
  })
})
