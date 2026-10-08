import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Vercel compiles these functions as native ES modules because package.json sets
 * "type": "module". Node's ESM loader does not add extensions, so an extensionless
 * relative import such as '../_lib/http' crashes the function before it can answer.
 * Every file reachable from the AI functions must therefore use an explicit .js specifier.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

function reachableFiles(): string[] {
  const seen = new Set<string>()
  const queue = readdirSync(join(root, 'api/ai'))
    .filter(name => name.endsWith('.ts'))
    .map(name => join('api/ai', name))
  while (queue.length) {
    const rel = queue.shift()!
    if (seen.has(rel)) continue
    seen.add(rel)
    const source = readFileSync(join(root, rel), 'utf8')
    for (const match of source.matchAll(/(?:from|import)\s+'(\.{1,2}\/[^']+)'/g)) {
      const specifier = match[1]!.replace(/\.js$/, '')
      const target = normalize(join(dirname(rel), specifier))
      const resolved = [`${target}.ts`, join(target, 'index.ts')].find(candidate => existsSync(join(root, candidate)))
      if (resolved) queue.push(resolved)
    }
  }
  return [...seen]
}

describe('Vercel ESM function imports', () => {
  it('uses explicit .js specifiers for every relative import reachable from api/ai', () => {
    const offenders: string[] = []
    for (const rel of reachableFiles()) {
      const source = readFileSync(join(root, rel), 'utf8')
      for (const match of source.matchAll(/(?:from|import)\s+'(\.{1,2}\/[^']+)'/g)) {
        if (!/\.(js|mjs|json)$/.test(match[1]!)) offenders.push(`${rel} -> ${match[1]}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('covers the shared src/lib modules that the server imports', () => {
    const files = reachableFiles()
    expect(files).toContain('src/lib/ai/sanitize.ts')
    expect(files).toContain('src/lib/analytics.ts')
    expect(files).toContain('src/types/index.ts')
  })
})
