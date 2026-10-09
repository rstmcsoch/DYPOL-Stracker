import { toCsv } from '../src/lib/share'
import { withAlpha } from '../src/components/charts/color'
import { base64ToBytes, bytesToBase64 } from '../src/lib/images'
import { emptyData } from '../src/lib/sync/helpers'
import { buildDocxReport } from '../src/lib/reports/report-docx'
import { buildPdfReport } from '../src/lib/reports/report-pdf'
import type { ReportOptions } from '../src/lib/reports/report-data'

const USER_ID = '11111111-2222-4333-8444-555555555555'
const everything: ReportOptions = {
  from: '',
  to: '',
  ownerName: 'Aarav',
  sections: { summary: true, performance: true, chapters: true, mistakes: true, tests: true, study: true, tips: true }
}

describe('CSV and colour helpers', () => {
  it('quotes every cell, doubles embedded quotes, and begins with a UTF-8 byte-order mark', () => {
    const csv = toCsv([['Date', 'Note'], ['2026-10-09', 'say "hi"'], ['2026-10-10', null]])
    expect(csv.startsWith('\ufeff"Date","Note"\r\n')).toBe(true)
    expect(csv).toContain('"2026-10-09","say ""hi"""')
    expect(csv).toContain('"2026-10-10",""')
  })

  it('adds an alpha channel to hex and rgb colours and clamps the value', () => {
    expect(withAlpha('#526c9a', 0.5)).toBe('#526c9a80')
    expect(withAlpha('#abc', 1)).toBe('#aabbccff')
    expect(withAlpha('rgba(1, 2, 3, 0.5)', 0.25)).toBe('rgba(1, 2, 3, 0.25)')
    expect(withAlpha('#000000', 3)).toBe('#000000ff')
  })
})

describe('base64 for embedded photos', () => {
  it('matches the standard encoding and round-trips arbitrary bytes', () => {
    expect(bytesToBase64(new TextEncoder().encode('Man'))).toBe('TWFu')
    expect(bytesToBase64(new TextEncoder().encode('Ma'))).toBe('TWE=')
    const bytes = Uint8Array.from([0, 1, 2, 127, 128, 250, 255, 16, 32])
    expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual(Array.from(bytes))
  })
})

describe('report files', () => {
  it('builds a PDF with the %PDF signature and no fabricated content for an empty notebook', () => {
    const bytes = buildPdfReport(emptyData(USER_ID), everything)
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe('%PDF-')
    expect(bytes.length).toBeGreaterThan(2000)
  })

  it('builds a DOCX as a zip container', async () => {
    const bytes = await buildDocxReport(emptyData(USER_ID), everything)
    expect(bytes[0]).toBe(0x50)
    expect(bytes[1]).toBe(0x4b)
    expect(bytes.length).toBeGreaterThan(2000)
  })
})
