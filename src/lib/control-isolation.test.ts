import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function listFiles(dir: string): string[] {
  const results: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) results.push(...listFiles(full))
    else if (/\.(ts|tsx|css|html)$/.test(entry)) results.push(full)
  }
  return results
}

describe('Control Center isolation from the public site and student app', () => {
  const publicAndStudentFiles = [
    ...listFiles('src/pages'),
    ...listFiles('src/components'),
    ...listFiles('src/contexts'),
    'index.html'
  ]

  it('never links to or mentions /control-panel in public or student components', () => {
    for (const file of publicAndStudentFiles) {
      const content = readFileSync(file, 'utf8')
      expect(content, `${file} must not reference /control-panel`).not.toContain('/control-panel')
      expect(content, `${file} must not reference /api/control`).not.toContain('/api/control')
      expect(content, `${file} must not import from src/control`).not.toMatch(/from\s+['"][^'"]*control\//)
    }
  })

  it('lazy-loads the console in App.tsx so its bundle is separate from the student bundle', () => {
    const app = readFileSync('src/App.tsx', 'utf8')
    expect(app).toMatch(/lazy\(\(\)\s*=>\s*import\(['"]\.\/control\/ControlPanelApp['"]\)\)/)
    expect(app).not.toMatch(/^import\s+.*from\s+['"]\.\/control\//m)
  })

  it('never hardcodes personal email addresses (@gmail.com, @yahoo.com, @outlook.com, @hotmail.com, @icloud.com) in src/ or api/', () => {
    const codeFiles = [...listFiles('src'), ...listFiles('api')]
    const personalEmailPattern = /[a-z0-9._%+-]+@(gmail|yahoo|outlook|hotmail|icloud)\.com\b/i
    for (const file of codeFiles) {
      const content = readFileSync(file, 'utf8')
      expect(content, `${file} must not contain a hardcoded personal email address`).not.toMatch(personalEmailPattern)
    }
  })
})
