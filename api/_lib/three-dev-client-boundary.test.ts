import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(__dirname, '..', '..')
const PATTERN = /THREE_DEV|three-dev|gate\.three\.dev|x-three-/i

function files(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : [path]
  })
}

describe('three.dev stays server-side', () => {
  it('no browser source references the three.dev key, module or headers', () => {
    const hits = files(join(root, 'src')).filter(path => /\.(tsx?|jsx?|css|html)$/.test(path) && PATTERN.test(readFileSync(path, 'utf8')))
    expect(hits).toEqual([])
  })

  it('no VITE_-prefixed three.dev variable exists anywhere', () => {
    const hits = [...files(join(root, 'src')), ...files(join(root, 'api')), join(root, '.env.example'), join(root, 'vite.config.ts')]
      .filter(path => !/\.test\.tsx?$/.test(path) && existsSync(path) && /VITE_THREE/i.test(readFileSync(path, 'utf8')))
    expect(hits).toEqual([])
  })

  it('a built client bundle (when present) contains no three.dev key name or proxy host', () => {
    const hits = files(join(root, 'dist')).filter(path => /\.(js|html|css|json|webmanifest)$/.test(path) && PATTERN.test(readFileSync(path, 'utf8')))
    expect(hits).toEqual([])
  })
})
