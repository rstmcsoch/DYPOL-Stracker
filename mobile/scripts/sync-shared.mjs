#!/usr/bin/env node
/**
 * Copies the website's platform-neutral TypeScript modules into `src/shared/`.
 *
 * Only modules with no DOM, Dexie, React DOM, Vite, docx/jsPDF, or browser-storage
 * dependency are listed in MANIFEST. Everything else (Dexie cache, Supabase client, page
 * components, report renderers) is re-implemented for React Native under src/.
 *
 *   node scripts/sync-shared.mjs          copy the manifest into src/shared/
 *   node scripts/sync-shared.mjs --check  fail on drift, missing or extra files, or
 *                                         imports that escape the copied set
 *
 * The copies are byte-for-byte. Never edit files under src/shared/ by hand.
 * EAS uploads only the mobile/ directory, so the copies are what the build actually uses.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const websiteSrc = resolve(here, '../../src')
const targetRoot = resolve(here, '../src/shared')
const checkOnly = process.argv.includes('--check')

/** Website modules (relative to src/) that are safe on both platforms. */
const MANIFEST = [
  'types/index.ts',
  'lib/analytics.ts',
  'lib/auth-rules.ts',
  'lib/backup.ts',
  'lib/data-relations.ts',
  'lib/date.ts',
  'lib/defaults.ts',
  'lib/focus-timer.ts',
  'lib/fonts.ts',
  'lib/format.ts',
  'lib/goal-validation.ts',
  'lib/id.ts',
  'lib/jee-record-schemas.ts',
  'lib/record-validation.ts',
  'lib/revision-actions.ts',
  'lib/settings-validation.ts',
  'lib/study-aggregation.ts',
  'lib/syllabus.ts',
  'lib/task-validation.ts',
  'lib/test-validation.ts',
  'lib/themes.ts',
  'lib/jee/cards.ts',
  'lib/jee/exam.ts',
  'lib/jee/forms.ts',
  'lib/jee/ids.ts',
  'lib/jee/mock-analysis.ts',
  'lib/jee/progress.ts',
  'lib/jee/recommend.ts',
  'lib/jee/reminders.ts',
  'lib/jee/study-time.ts',
  'lib/jee/weekly-report.ts',
  'lib/ai/catalog.ts',
  'lib/ai/model-catalog.ts',
  'lib/ai/sanitize.ts'
]

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

/** Relative import specifiers in a TypeScript file, resolved to a manifest-style path. */
function localImports(source) {
  const specifiers = [...source.matchAll(/(?:import|export)\s[^'"]*?from\s+'(\.[^']+)'/g)].map(match => match[1])
  return specifiers
}

function resolveImport(fromFile, specifier) {
  const base = resolve(dirname(fromFile), specifier)
  const withoutJs = base.endsWith('.js') ? base.slice(0, -3) : base
  const candidates = [`${withoutJs}.ts`, `${withoutJs}.tsx`, join(withoutJs, 'index.ts')]
  if (base !== withoutJs) candidates.push(base)
  return candidates.find(candidate => existsSync(candidate) && statSync(candidate).isFile()) ?? null
}

function listTargetFiles(directory, prefix = '') {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) return listTargetFiles(join(directory, entry.name), relativePath)
    return [relativePath]
  })
}

function verifyClosure(files) {
  const problems = []
  for (const file of files) {
    const absolute = resolve(websiteSrc, file)
    const source = readFileSync(absolute, 'utf8')
    for (const specifier of localImports(source)) {
      const resolved = resolveImport(absolute, specifier)
      if (!resolved) {
        problems.push(`${file}: cannot resolve ${specifier}`)
        continue
      }
      const rel = relative(websiteSrc, resolved).split('\\').join('/')
      if (!files.includes(rel)) problems.push(`${file}: imports ${rel}, which is not in the manifest`)
    }
  }
  return problems
}

function main() {
  const missing = MANIFEST.filter(file => !existsSync(resolve(websiteSrc, file)))
  if (missing.length) {
    console.error(`Manifest entries missing from the website: ${missing.join(', ')}`)
    process.exit(1)
  }

  const closureProblems = verifyClosure(MANIFEST)
  if (closureProblems.length) {
    console.error('Shared module imports escape the manifest:\n  ' + closureProblems.join('\n  '))
    process.exit(1)
  }

  if (checkOnly) {
    const problems = []
    for (const file of MANIFEST) {
      const source = readFileSync(resolve(websiteSrc, file))
      const copy = resolve(targetRoot, file)
      if (!existsSync(copy)) {
        problems.push(`missing copy: src/shared/${file}`)
        continue
      }
      if (sha256(source) !== sha256(readFileSync(copy))) problems.push(`drifted copy: src/shared/${file}`)
    }
    const expected = new Set(MANIFEST)
    for (const file of listTargetFiles(targetRoot)) {
      if (!expected.has(file)) problems.push(`unexpected file: src/shared/${file}`)
    }
    if (problems.length) {
      console.error('src/shared is out of sync with the website. Run `npm run shared:sync`.\n  ' + problems.join('\n  '))
      process.exit(1)
    }
    console.log(`src/shared matches ${MANIFEST.length} website modules byte-for-byte.`)
    return
  }

  rmSync(targetRoot, { recursive: true, force: true })
  for (const file of MANIFEST) {
    const destination = resolve(targetRoot, file)
    mkdirSync(dirname(destination), { recursive: true })
    writeFileSync(destination, readFileSync(resolve(websiteSrc, file)))
  }
  console.log(`copied ${MANIFEST.length} website modules into src/shared/`)
}

main()
