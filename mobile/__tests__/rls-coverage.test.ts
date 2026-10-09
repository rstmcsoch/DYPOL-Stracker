/**
 * Static checks on the existing Supabase migrations (the database the website already uses). They
 * read the SQL only; nothing here connects to a database or changes one.
 */
import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { SYNC_TABLES } from '../src/lib/local-db/tables'

const migrationsDir = join(__dirname, '..', '..', 'supabase', 'migrations')
const sql = readdirSync(migrationsDir)
  .filter(name => name.endsWith('.sql'))
  .sort()
  .map(name => readFileSync(join(migrationsDir, name), 'utf8'))
  .join('\n')

/** Each `foreach tbl in array array[...] loop ... end loop;` block with its table list and body. */
function loopBlocks(text: string): { tables: string[]; body: string }[] {
  return [...text.matchAll(/foreach tbl in array array\[([\s\S]*?)\] loop([\s\S]*?)end loop;/g)].map(match => ({
    tables: [...(match[1] ?? '').matchAll(/'([a-z_]+)'/g)].map(table => table[1] ?? ''),
    body: match[2] ?? ''
  }))
}

describe('row-level security on the existing database', () => {
  it('creates every table the mobile app syncs', () => {
    for (const table of SYNC_TABLES) {
      expect({ table, created: new RegExp(`create table (if not exists )?public\\.${table}\\b`).test(sql) }).toEqual({ table, created: true })
    }
  })

  it('scopes every synced table to its owner with RLS, for the authenticated role only', () => {
    const ownerScoped = new Set(
      loopBlocks(sql)
        .filter(block => /enable row level security/.test(block.body) && /to authenticated/.test(block.body) && /auth\.uid\(\) = user_id/.test(block.body))
        .flatMap(block => block.tables)
    )
    for (const table of SYNC_TABLES) expect({ table, ownerScoped: ownerScoped.has(table) }).toEqual({ table, ownerScoped: true })
  })

  it('keeps the AI tables server-only: RLS on, browser roles revoked, service role granted', () => {
    const serverOnly = loopBlocks(sql).filter(block => /revoke all on table[\s\S]*from anon, authenticated/.test(block.body))
    const tables = new Set(serverOnly.flatMap(block => block.tables))
    for (const table of ['ai_provider_configs', 'ai_conversations', 'ai_messages', 'ai_tasks', 'ai_pending_actions', 'ai_action_audit']) {
      expect({ table, serverOnly: tables.has(table) }).toEqual({ table, serverOnly: true })
    }
    expect(serverOnly.every(block => /enable row level security/.test(block.body) && /grant all on table[\s\S]*to service_role/.test(block.body))).toBe(true)
  })

  it('never disables RLS and never grants a policy to the anonymous role', () => {
    expect(/disable row level security/i.test(sql)).toBe(false)
    expect(/create policy[^;]*\bto\s+anon\b/i.test(sql)).toBe(false)
  })

  it('keeps the mistake-images bucket private and limited to each owner’s folder', () => {
    expect(sql).toMatch(/'mistake-images',\s*'mistake-images',\s*false/)
    expect(sql).toMatch(/bucket_id = 'mistake-images' and \(storage\.foldername\(name\)\)\[1\] = auth\.uid\(\)::text/)
  })

  it('does not reference the server-only AI tables from the app', () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap(name => (statSync(join(dir, name)).isDirectory() ? walk(join(dir, name)) : [join(dir, name)]))
    const sources = walk(join(__dirname, '..', 'src')).filter(file => /\.(ts|tsx)$/.test(file))
    const offenders = sources.filter(file => /ai_(provider_configs|conversations|messages|tasks|pending_actions|action_audit)/.test(readFileSync(file, 'utf8')))
    expect(offenders).toEqual([])
  })
})
