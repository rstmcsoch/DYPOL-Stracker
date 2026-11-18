// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { AppData, BacklogItem } from '../../types'
import { defaultExamTracks, defaultSettings } from '../../lib/defaults'
import { indiaToday, plusDays } from '../../lib/date'
import { HomeSnapshot } from './HomeSnapshot'

/**
 * The Home "THIS WEEK" strip regressed once already: its CSS styled `li` while the JSX
 * rendered `div`, so the numbers and labels collapsed onto one line. These assertions pin
 * the structure the stylesheet actually depends on, so the two cannot drift apart again.
 */

const USER = '00000000-0000-4000-8000-000000000001'
const NOW = '2026-10-08T06:00:00.000Z'
const TODAY = indiaToday()

const harness = vi.hoisted(() => ({ data: null as unknown as AppData }))

vi.mock('../../contexts/DataContext', () => ({ useData: () => ({ data: harness.data }) }))

function data(overrides: Partial<AppData> = {}): AppData {
  return {
    chapters: [], revisions: [], tests: [], testSubjectScores: [], testChapterLinks: [], mistakes: [], tasks: [],
    goals: [], sessions: [], practiceSessions: [], pyqRecords: [], chapterStages: [], backlogItems: [],
    studyCards: [], testErrorLogs: [], testTimeEntries: [], examTracks: defaultExamTracks(USER),
    settings: {
      ...defaultSettings(USER), user_id: USER, pyq_from_year: 2025, pyq_to_year: 2026,
      main_exam_date: '2026-12-20', owner_name: 'Aarav'
    },
    profile: null, ...overrides
  }
}

const backlog = (id: string, due: string): BacklogItem => ({
  id, user_id: USER, title: `Item ${id}`, type: 'Lecture', subject: 'Physics', chapter_id: null,
  priority: 'Medium', due_on: due, status: 'active', snoozed_until: null, completed_at: null,
  notes: '', created_at: NOW, updated_at: NOW
})

const renderStrip = (appData: AppData) => {
  harness.data = appData
  return render(<MemoryRouter><HomeSnapshot /></MemoryRouter>)
}

afterEach(cleanup)

describe('Home weekly strip', () => {
  it('renders the metrics as a list, which is what the stylesheet targets', () => {
    renderStrip(data())
    const list = screen.getByRole('list')
    expect(list.tagName).toBe('UL')
    const cells = within(list).getAllByRole('listitem')
    expect(cells.length).toBeGreaterThanOrEqual(3)
    // Every cell must be an element the CSS can select; a bare text/label mix is the bug.
    for (const cell of cells) expect(cell.tagName).toBe('LI')
  })

  it('keeps each label in its own element instead of gluing it to the number', () => {
    renderStrip(data())
    const list = screen.getByRole('list')
    const studied = within(list).getAllByRole('listitem')[0]!
    // textContent runs adjacent nodes together, so asserting on it proves nothing. What
    // matters is that label / value / note are three *separate elements* the CSS can lay
    // out — that is exactly what was missing when it rendered as "0mstudied".
    const label = studied.querySelector(':scope > span')
    const value = studied.querySelector(':scope > strong')
    const note = studied.querySelector(':scope > small')
    expect(label?.textContent).toBe('Studied')
    expect(value?.textContent).toBe('0m')
    expect(note?.textContent).toBe('this week')
    expect(new Set([label, value, note]).size).toBe(3)
  })

  it('shows the backlog as its own pill, not a fifth metric cell', () => {
    renderStrip(data({
      backlogItems: [backlog('b1', TODAY), backlog('b2', plusDays(TODAY, 1))]
    }))
    const pill = screen.getByRole('button', { name: /Backlog/ })
    expect(pill.className).toContain('jee-week-backlog')
    // It must sit outside the metrics list, so the grid keeps four even columns.
    expect(within(screen.getByRole('list')).queryByRole('button')).toBeNull()
    expect(pill.textContent).toContain('1 due now')
    expect(pill.textContent).toContain('1 tomorrow')
  })

  it('never invents an accuracy percentage when nothing was attempted', () => {
    renderStrip(data())
    const list = screen.getByRole('list')
    expect(within(list).queryByText(/accuracy$/)).toBeNull()
    expect(within(list).getByText('no accuracy yet')).toBeTruthy()
  })

  it('shows real accuracy when practice exists', () => {
    renderStrip(data({
      practiceSessions: [{
        id: 'p1', user_id: USER, chapter_id: 'c1', practice_date: TODAY, attempted: 40, correct: 30,
        incorrect: 10, source: 'DPP', time_minutes: 40, notes: '', created_at: NOW, updated_at: NOW
      }]
    }))
    const list = screen.getByRole('list')
    expect(within(list).getByText('75% accuracy')).toBeTruthy()
  })
})
