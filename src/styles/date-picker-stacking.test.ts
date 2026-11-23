import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

describe('date picker stacking', () => {
  it('raises a focused date field above the sticky dialog head on Backlog and Add-task', () => {
    const layout = readFileSync(join(here, 'layout.css'), 'utf8')
    const base = readFileSync(join(here, 'base.css'), 'utf8')
    expect(base).toMatch(/\.dialog-head \{[^}]*z-index: 2/)
    expect(layout).toContain(".dialog-panel:has(input:where([type='date'], [type='time']):focus) .dialog-head { z-index: 1; }")
    expect(layout).toContain('.planner-date-field')
    expect(layout).toContain('.date-input-wrap')
    expect(layout).toMatch(/input:where\(\[type='date'\], \[type='time'\]\):focus[\s\S]*z-index: 5/)
  })
})
