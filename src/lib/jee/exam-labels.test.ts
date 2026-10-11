import { describe, expect, it } from 'vitest'
import { defaultSettings } from '../defaults'
import type { AppData } from '../../types'
import { allTrackReadiness, availableTracks, currentExamMode, effectiveTrack, trackLabels, TRACK_LABEL } from './exam'

const settings = (overrides: Record<string, unknown> = {}) => ({ ...defaultSettings('u'), ...overrides })
const data = (overrides: Record<string, unknown>) => ({
  settings: settings(overrides), examTracks: [], chapters: [], tests: [], testSubjectScores: [], pyqRecords: []
}) as unknown as AppData

describe('exam dates follow the chosen exam', () => {
  it('keeps JEE Main/Advanced for JEE and for students without an exam', () => {
    expect(trackLabels(settings())).toBe(TRACK_LABEL)
    expect(trackLabels(settings({ exam_id: 'jee', exam_year: 2028 }))).toBe(TRACK_LABEL)
    expect(availableTracks(settings())).toEqual(['main1', 'main2', 'advanced', 'boards'])
  })

  it('labels other exams from the catalogue with the target year', () => {
    const neet = settings({ exam_id: 'neet-ug', exam_year: 2027 })
    expect(trackLabels(neet).main1).toBe('NEET UG 2027')
    expect(availableTracks(neet)).toEqual(['main1'])
    expect(availableTracks({ ...neet, boards_addon: true })).toEqual(['main1', 'boards'])
    expect(effectiveTrack({ ...neet, active_track: 'advanced' })).toBe('main1')
  })

  it('runs Exam Mode on the chosen exam date', () => {
    const mode = currentExamMode(data({ exam_id: 'neet-ug', exam_year: 2027, active_track: 'advanced', main_exam_date: '2027-05-02' }), '2027-04-20')
    expect(mode).toMatchObject({ active: true, label: 'NEET UG 2027', track: 'main1', daysLeft: 12 })
    expect(allTrackReadiness(data({ exam_id: 'cat' }), '2026-10-11').map(item => item.label)).toEqual(['CAT'])
  })
})
