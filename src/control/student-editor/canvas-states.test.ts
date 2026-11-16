// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { activateViewState, collectViewStates } from './canvas-states'
import { attachStudentOverlay } from './canvas-overlay'
import type { StudentCanvasState } from './protocol'

afterEach(() => { document.body.innerHTML = '' })

const html = `
  <div data-sl="settings.tabs"><div role="tablist">
    <button role="tab" aria-selected="true">Account</button><button role="tab" aria-selected="false">Exam</button>
  </div></div>
  <div class="page-header-action"><button>Add test</button></div>
  <label class="jee-select"><span>Subject</span><select><option value="all">All subjects</option><option value="p">Physics</option></select></label>
  <ul><li><button aria-pressed="false">Mark Solve set complete</button><select aria-label="Status for Kinematics"><option>Done</option></select></li></ul>
  <nav class="sidebar"><button role="tab">Menu</button></nav>`

describe('canvas view states', () => {
  it('lists sub-tabs, open actions and filters but not per-record controls or menus', () => {
    document.body.innerHTML = html
    const states = collectViewStates()
    expect(states.map(state => `${state.group}:${state.label}:${state.active}`)).toEqual([
      'Tabs:Account:true', 'Tabs:Exam:false', 'Open:Add test:false', 'Filter · Subject:All subjects:true', 'Filter · Subject:Physics:false'
    ])
  })

  it('activates a tab and a filter option', () => {
    document.body.innerHTML = html
    const tab = document.querySelectorAll('[role="tab"]')[1] as HTMLButtonElement
    const onTab = vi.fn(); tab.addEventListener('click', onTab)
    const select = document.querySelector('label select') as HTMLSelectElement
    const onChange = vi.fn(); select.addEventListener('change', onChange)
    expect(activateViewState('Tabs|Exam')).toBe(true)
    expect(activateViewState('Filter · Subject|Physics')).toBe(true)
    expect(onTab).toHaveBeenCalledOnce()
    expect(select.value).toBe('p')
    expect(onChange).toHaveBeenCalledOnce()
    expect(activateViewState('Tabs|Nope')).toBe(false)
  })
})

describe('edit-mode clicks', () => {
  function setup(interact = true) {
    document.body.innerHTML = html
    const sent: unknown[] = []
    const state = { type: 'sl:state', mode: 'edit', selected: null, interact } as unknown as StudentCanvasState
    const overlay = attachStudentOverlay(message => sent.push(message), () => state)
    const tab = document.querySelectorAll('[role="tab"]')[1] as HTMLButtonElement
    let ran = 0
    tab.addEventListener('click', event => { if (!event.defaultPrevented) ran += 1 })
    return { sent, overlay, tab, ran: () => ran }
  }

  it('runs a sub-tab and selects its part', () => {
    const { sent, overlay, tab, ran } = setup()
    tab.click()
    expect(ran()).toBe(1)
    expect(sent).toContainEqual({ type: 'sl:select', id: 'settings.tabs' })
    overlay.detach()
  })

  it('Alt + click and "Select only" select without switching', () => {
    const first = setup()
    first.tab.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, altKey: true }))
    expect(first.ran()).toBe(0)
    expect(first.sent).toContainEqual({ type: 'sl:select', id: 'settings.tabs' })
    first.overlay.detach()
    const second = setup(false)
    second.tab.click()
    expect(second.ran()).toBe(0)
    second.overlay.detach()
  })
})
