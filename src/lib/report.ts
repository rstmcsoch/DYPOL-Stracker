import { format, parseISO } from 'date-fns'
import { Document, Footer, HeadingLevel, ImageRun, PageBreak, PageNumber, Paragraph, Packer, Table, TableCell, TableRow, TextRun, WidthType, BorderStyle, AlignmentType } from 'docx'
import { jsPDF } from 'jspdf'
import { getChapterPerformance, getMistakeCounts, getSmartTip, getStudyStreak, getSubjectPerformance, testPercentage } from './analytics'
import { indiaToday, prettyDate } from './date'
import { fmtDuration, fmtNumber } from './format'
import type { AppData, TestRecord } from '../types'
import { SUBJECTS } from '../types'
import { triggerDownload } from './backup'

export interface ReportSections {
  summary: boolean
  performance: boolean
  chapters: boolean
  mistakes: boolean
  tests: boolean
  study: boolean
  tips: boolean
}
export interface ReportOptions { from: string; to: string; sections: ReportSections; ownerName: string }

function scopedData(data: AppData, from: string, to: string): AppData {
  const between = (date: string) => (!from || date >= from) && (!to || date <= to)
  const tests = data.tests.filter(test => between(test.test_date))
  const testIds = new Set(tests.map(test => test.id))
  const mistakeIds = new Set(data.mistakes.filter(mistake => between(mistake.created_at.slice(0, 10))).map(mistake => mistake.id))
  const sessions = data.sessions.filter(session => between(toIndiaDate(session.started_at)))
  return {
    ...data, tests, testSubjectScores: data.testSubjectScores.filter(item => testIds.has(item.test_id)),
    testChapterLinks: data.testChapterLinks.filter(item => testIds.has(item.test_id)),
    mistakes: data.mistakes.filter(item => mistakeIds.has(item.id)), sessions,
    revisions: data.revisions.filter(item => (item.completed_at && between(toIndiaDate(item.completed_at))) || between(item.due_on))
  }
}

function toIndiaDate(timestamp: string): string {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(timestamp)) }
  catch { return timestamp.slice(0, 10) }
}

function overallTestPercent(test: TestRecord, data: AppData): number | null {
  const direct = testPercentage(test)
  if (direct !== null) return direct
  if (test.test_type !== 'Full Mock') return null
  const scores = data.testSubjectScores.filter(score => score.test_id === test.id)
  if (scores.length !== 3 || !SUBJECTS.every(subject => scores.some(row => row.subject === subject && row.total_marks && row.marks_obtained != null))) return null
  const marks = scores.reduce((sum, score) => sum + (score.marks_obtained ?? 0), 0)
  const total = scores.reduce((sum, score) => sum + (score.total_marks ?? 0), 0)
  return total > 0 ? marks / total * 100 : null
}

function overallTestMarks(test: TestRecord, data: AppData): { marks: number; total: number } | null {
  if (test.marks_obtained != null && test.total_marks != null && test.total_marks > 0) return { marks: test.marks_obtained, total: test.total_marks }
  if (test.test_type !== 'Full Mock') return null
  const scores = data.testSubjectScores.filter(score => score.test_id === test.id)
  if (scores.length !== 3 || !SUBJECTS.every(subject => scores.some(row => row.subject === subject && row.total_marks && row.marks_obtained != null))) return null
  return { marks: scores.reduce((sum, score) => sum + (score.marks_obtained ?? 0), 0), total: scores.reduce((sum, score) => sum + (score.total_marks ?? 0), 0) }
}

function chartSvg(data: AppData, kind: 'trend' | 'hours', hoursEndDate = indiaToday()): string {
  const width = 1200
  const height = 430
  const pad = { left: 82, right: 46, top: 42, bottom: 72 }
  const chartW = width - pad.left - pad.right
  const chartH = height - pad.top - pad.bottom
  const grid = Array.from({ length: 5 }, (_, index) => {
    const y = pad.top + (chartH / 4) * index
    const value = kind === 'trend' ? 100 - index * 25 : (4 - index) * 1.5
    return `<line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" stroke="#e4dece" stroke-dasharray="5 8"/><text x="${pad.left - 18}" y="${y + 6}" text-anchor="end" font-size="17" fill="#736f63" font-family="Arial">${kind === 'trend' ? `${value}%` : `${value}h`}</text>`
  }).join('')
  let plot = ''
  if (kind === 'trend') {
    const points = data.tests.filter(test => overallTestPercent(test, data) !== null).sort((a, b) => a.test_date.localeCompare(b.test_date)).slice(-12)
    if (points.length > 0) {
      const xy = points.map((test, index) => ({
        x: points.length === 1 ? pad.left + chartW / 2 : pad.left + (chartW * index) / (points.length - 1),
        y: pad.top + chartH * (1 - (overallTestPercent(test, data) ?? 0) / 100),
        date: format(parseISO(`${test.test_date}T12:00:00`), 'd MMM'),
        value: Math.round(overallTestPercent(test, data) ?? 0)
      }))
      plot = `<polyline points="${xy.map(point => `${point.x},${point.y}`).join(' ')}" fill="none" stroke="#5571a0" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>${xy.map(point => `<circle cx="${point.x}" cy="${point.y}" r="9" fill="#f7f4ec" stroke="#5571a0" stroke-width="6"/><text x="${point.x}" y="${height - 27}" text-anchor="middle" font-size="16" fill="#736f63" font-family="Arial">${xml(point.date)}</text>`).join('')}`
    }
  } else {
    const today = hoursEndDate
    const bins: { date: string; hours: number }[] = []
    for (let index = 13; index >= 0; index -= 1) {
      const date = format(new Date(parseISO(`${today}T12:00:00`).getTime() - index * 86_400_000), 'yyyy-MM-dd')
      const minutes = data.sessions.filter(session => toIndiaDate(session.started_at) === date).reduce((sum, session) => sum + session.duration_minutes, 0)
      bins.push({ date, hours: minutes / 60 })
    }
    plot = bins.map((bin, index) => {
      const x = pad.left + index * (chartW / bins.length) + 7
      const barW = chartW / bins.length - 14
      const barH = Math.min(chartH, (bin.hours / 6) * chartH)
      const y = pad.top + chartH - barH
      const label = index % 2 === 0 ? format(parseISO(`${bin.date}T12:00:00`), 'd MMM') : ''
      return `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" rx="10" fill="#6b9a7b"/><text x="${x + barW / 2}" y="${height - 27}" text-anchor="middle" font-size="14" fill="#736f63" font-family="Arial">${label}</text>`
    }).join('')
  }
  const title = kind === 'trend' ? 'Test score trend' : 'Study hours · last 14 days'
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#fbf9f3" rx="22"/><text x="${pad.left}" y="29" font-size="21" fill="#252a25" font-family="Arial" font-weight="700">${title}</text>${grid}${plot || `<text x="${width / 2}" y="${height / 2}" text-anchor="middle" font-family="Arial" font-size="22" fill="#736f63">No recorded data for this chart yet</text>`}</svg>`
}

function xml(value: string): string { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;') }

async function svgPng(svg: string): Promise<Uint8Array> {
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image()
      element.onload = () => resolve(element)
      element.onerror = () => reject(new Error('Could not render a report chart.'))
      element.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = 2400; canvas.height = 860
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas export is unavailable in this browser.')
    context.fillStyle = '#fbf9f3'; context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const base64 = canvas.toDataURL('image/png')
    const binary = atob(base64.split(',')[1] ?? '')
    return Uint8Array.from(binary, character => character.charCodeAt(0))
  } finally { URL.revokeObjectURL(url) }
}

function pdfLine(doc: jsPDF, text: string, x: number, y: number, width: number, size = 10, color: [number, number, number] = [55, 59, 52]): number {
  doc.setFontSize(size); doc.setTextColor(...color)
  const lines = doc.splitTextToSize(text, width) as string[]
  doc.text(lines, x, y)
  return y + lines.length * (size * 0.42) + 2
}

function pdfSectionTitle(doc: jsPDF, title: string, subtitle?: string): number {
  doc.setFont('helvetica', 'bold'); doc.setFontSize(19); doc.setTextColor(39, 44, 38); doc.text(title, 17, 23)
  doc.setDrawColor(191, 181, 158); doc.setLineWidth(0.6); doc.line(17, 28, 193, 28)
  if (subtitle) { doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(103, 101, 91); doc.text(subtitle, 17, 35); return 44 }
  return 37
}

function pdfFooter(doc: jsPDF, pageName: string): void {
  const h = doc.internal.pageSize.getHeight()
  doc.setDrawColor(220, 215, 202); doc.line(17, h - 15, 193, h - 15)
  doc.setFontSize(8); doc.setTextColor(117, 114, 102); doc.text('Stracker by DYPOL LABS', 17, h - 9); doc.text(pageName, 193, h - 9, { align: 'right' })
}

function addPdfTable(doc: jsPDF, rows: string[][], x: number, y: number, widths: number[], headers: string[]): number {
  let currentY = y
  const drawRow = (values: string[], header = false) => {
    const lineHeight = 5.1
    const cellLines = values.map((value, index) => doc.splitTextToSize(value || '—', (widths[index] ?? 30) - 4) as string[])
    const rowHeight = Math.max(9, Math.max(...cellLines.map(lines => lines.length)) * lineHeight + 4)
    if (currentY + rowHeight > doc.internal.pageSize.getHeight() - 21) { pdfFooter(doc, 'JEE STUDY REPORT'); doc.addPage(); currentY = pdfSectionTitle(doc, 'Continued') }
    if (header) doc.setFillColor(235, 231, 218); else if (Math.round(currentY / rowHeight) % 2 === 0) doc.setFillColor(250, 248, 241); else doc.setFillColor(255, 255, 255)
    doc.setDrawColor(222, 218, 207); doc.rect(x, currentY, widths.reduce((sum, value) => sum + value, 0), rowHeight, 'FD')
    let cellX = x
    values.forEach((_value, index) => {
      doc.setFont('helvetica', header ? 'bold' : 'normal'); doc.setFontSize(header ? 8 : 8.5); doc.setTextColor(47, 50, 44)
      doc.text(cellLines[index] ?? '—', cellX + 2, currentY + 5.8)
      cellX += widths[index] ?? 0
    })
    currentY += rowHeight
  }
  drawRow(headers, true)
  for (const row of rows) drawRow(row)
  return currentY + 5
}

export async function createPdfReport(data: AppData, options: ReportOptions): Promise<void> {
  const scoped = scopedData(data, options.from, options.to)
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true })
  const width = doc.internal.pageSize.getWidth()
  const height = doc.internal.pageSize.getHeight()
  const rangeLabel = options.from || options.to ? `${options.from ? prettyDate(options.from) : 'All time'} — ${options.to ? prettyDate(options.to) : 'Today'}` : 'All recorded time'
  const reportDate = prettyDate(indiaToday())
  const chartTrend = await svgPng(chartSvg(scoped, 'trend'))
  const chartHours = await svgPng(chartSvg(scoped, 'hours', options.to || indiaToday()))
  const selected = options.sections

  // Cover page: warm-paper treatment with no fabricated data.
  doc.setFillColor(248, 246, 238); doc.rect(0, 0, width, height, 'F')
  doc.setDrawColor(82, 105, 78); doc.setLineWidth(0.8); doc.roundedRect(12, 12, width - 24, height - 24, 4, 4, 'S')
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(86, 108, 82); doc.text('A JEE 2027 STUDY NOTEBOOK', 22, 44)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(37); doc.setTextColor(39, 45, 38); doc.text('Stracker', 22, 75)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(18); doc.setTextColor(91, 98, 83); doc.text('Study progress report', 22, 88)
  doc.setDrawColor(204, 177, 102); doc.setLineWidth(1.2); doc.line(22, 99, 93, 99)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(44, 48, 42); doc.text(options.ownerName || 'Study notebook', 22, 122)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(100, 101, 89); doc.text(`Report date: ${reportDate}`, 22, 133); doc.text(`Date range: ${rangeLabel}`, 22, 142)
  doc.setFillColor(240, 235, 218); doc.roundedRect(22, 174, width - 44, 40, 3, 3, 'F')
  doc.setFont('helvetica', 'italic'); doc.setFontSize(14); doc.setTextColor(61, 70, 54); doc.text('“Progress is a practice, not a single score.”', 32, 197)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(75, 91, 69); doc.text('Stracker by DYPOL LABS', 22, height - 28)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(110, 108, 96); doc.text('Private study summary · Prepared from the data you recorded', 22, height - 21)

  if (selected.summary) {
    doc.addPage(); let y = pdfSectionTitle(doc, 'At a glance', 'A quick summary of what you have actually recorded.')
    const scores = scoped.tests.map(test => overallTestMarks(test, scoped)).filter((item): item is { marks: number; total: number } => item !== null)
    const avg = scores.length ? scores.reduce((sum, row) => sum + row.marks / row.total * 100, 0) / scores.length : null
    const best = scores.length ? Math.max(...scores.map(row => row.marks / row.total * 100)) : null
    const done = data.chapters.filter(chapter => ['Done','Revised'].includes(chapter.status)).length
    const streak = getStudyStreak(data)
    const totalHours = scoped.sessions.reduce((sum, session) => sum + session.duration_minutes, 0) / 60
    const cards: [string, string][] = [
      ['Tests taken', `${scoped.tests.length}`], ['Average score', avg === null ? '—' : `${Math.round(avg)}%`],
      ['Best score', best === null ? '—' : `${Math.round(best)}%`], ['Study hours', fmtNumber(totalHours, 1)],
      ['Syllabus', `${done} / ${data.chapters.length}`], ['Current streak', `${streak.current} day${streak.current === 1 ? '' : 's'}`],
      ['Target score', data.settings.target_score ? `${fmtNumber(data.settings.target_score)}` : '—']
    ]
    const cardWidth = 54; const cardHeight = 28
    cards.forEach(([label, value], index) => {
      const col = index % 3; const row = Math.floor(index / 3); const x = 17 + col * 59; const top = y + row * 37
      doc.setFillColor(249, 247, 239); doc.setDrawColor(218, 212, 196); doc.roundedRect(x, top, cardWidth, cardHeight, 2.4, 2.4, 'FD')
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(103, 101, 91); doc.text(label, x + 4, top + 9)
      doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(47, 57, 46); doc.text(value, x + 4, top + 21)
    })
    y += 98
    y = pdfLine(doc, `Date range: ${rangeLabel}. Scores above are percentages, so tests with different totals can be compared meaningfully.`, 18, y, 170, 10)
    pdfFooter(doc, 'SUMMARY')
  }

  if (selected.performance) {
    doc.addPage(); let y = pdfSectionTitle(doc, 'Performance', 'Percentages keep different test totals on a common scale.')
    doc.addImage(chartTrend, 'PNG', 17, y, 176, 63); y += 70
    const bySubject = getSubjectPerformance(scoped)
    y = pdfLine(doc, 'Subject averages', 18, y, 175, 12, [45, 65, 54])
    y = addPdfTable(doc, bySubject.map(item => [item.subject, item.average === null ? 'No usable scores' : `${Math.round(item.average)}%`, `${item.count}`]), 17, y, [70, 72, 34], ['Subject','Average','Results'])
    const negatives = scoped.tests.filter(test => test.negative_marks !== null).reduce((sum, test) => sum + (test.negative_marks ?? 0), 0)
    pdfLine(doc, `Recorded negative marks in range: ${fmtNumber(negatives, 1)}.`, 18, y + 2, 175, 9)
    pdfFooter(doc, 'PERFORMANCE')
  }

  if (selected.chapters) {
    doc.addPage(); let y = pdfSectionTitle(doc, 'Chapter signals', 'Chapter averages use up to the latest three usable chapter results.')
    const rows = getChapterPerformance({ ...scoped, chapters: data.chapters }).sort((a, b) => (a.average ?? 101) - (b.average ?? 101))
    const weak = rows.filter(item => item.classification === 'Weak')
    const strong = rows.filter(item => item.classification === 'Strong')
    const dropping = rows.filter(item => item.dropping)
    const untested = rows.filter(item => item.classification === 'Untested')
    const table = (title: string, items: typeof rows) => {
      y = pdfLine(doc, title, 18, y, 175, 12, [45, 65, 54])
      if (!items.length) y = pdfLine(doc, 'None in this report range.', 18, y, 174, 9, [110, 108, 96])
      else y = addPdfTable(doc, items.map(item => [item.chapter.name, item.chapter.subject, item.average == null ? '—' : `${Math.round(item.average)}%`, item.dropping ? 'Dropping' : item.classification]), 17, y, [72, 34, 29, 41], ['Chapter','Subject','Average','Signal'])
    }
    await table('Weak chapters', weak); await table('Strong chapters', strong); await table('Dropping chapters', dropping); await table('Untested chapters', untested)
    y += 2
    y = pdfLine(doc, `Syllabus completion: ${data.chapters.filter(item => item.status === 'Done' || item.status === 'Revised').length} / ${data.chapters.length} recorded chapters.`, 18, y, 175, 10)
    pdfFooter(doc, 'CHAPTER SIGNALS')
  }

  if (selected.mistakes) {
    doc.addPage(); let y = pdfSectionTitle(doc, 'Mistake breakdown', 'Counts come from saved mistake notes in this date range.')
    const counts = getMistakeCounts(scoped)
    y = addPdfTable(doc, counts.map(item => [item.type, `${item.count}`]), 17, y, [95, 81], ['Mistake type','Entries'])
    const common = [...counts].sort((a, b) => b.count - a.count)[0]
    if (common?.count) y = pdfLine(doc, `Most frequent recorded type: ${common.type} (${common.count}).`, 18, y + 4, 170, 10)
    const retries = scoped.mistakes.filter(item => item.retry_later && item.retry_status === 'pending').length
    pdfLine(doc, `Questions still on the retry list: ${retries}.`, 18, y + 2, 170, 10)
    pdfFooter(doc, 'MISTAKES')
  }

  if (selected.tests) {
    doc.addPage(); let y = pdfSectionTitle(doc, 'Test history', `${scoped.tests.length} test records · ${rangeLabel}`)
    const sorted = [...scoped.tests].sort((a, b) => b.test_date.localeCompare(a.test_date))
    const rows = sorted.map(test => {
      const score = overallTestMarks(test, scoped)
      return [test.test_date, test.title, test.test_type, test.subject ?? '—', score ? `${fmtNumber(score.marks, 1)} / ${fmtNumber(score.total, 1)}` : '—', score ? `${Math.round(score.marks / score.total * 100)}%` : '—']
    })
    if (!rows.length) y = pdfLine(doc, 'No tests were recorded in this date range.', 18, y, 170, 10)
    else addPdfTable(doc, rows, 17, y, [25, 59, 34, 24, 24, 20], ['Date','Test','Type','Subject','Score','%'])
    pdfFooter(doc, 'TEST HISTORY')
  }

  if (selected.study) {
    doc.addPage(); let y = pdfSectionTitle(doc, 'Study hours', 'Focus sessions logged in the selected report range.')
    doc.addImage(chartHours, 'PNG', 17, y, 176, 63); y += 72
    y = pdfLine(doc, `Total study time: ${fmtDuration(scoped.sessions.reduce((sum, session) => sum + session.duration_minutes, 0))}.`, 18, y, 170, 11)
    const subjectMinutes = SUBJECTS.map(subject => [subject, fmtDuration(scoped.sessions.filter(session => session.subject === subject).reduce((sum, session) => sum + session.duration_minutes, 0))])
    addPdfTable(doc, subjectMinutes, 17, y + 4, [88, 88], ['Subject','Logged time'])
    pdfFooter(doc, 'STUDY HOURS')
  }

  if (selected.tips) {
    doc.addPage(); let y = pdfSectionTitle(doc, 'Study notes to consider', 'Rule-based suggestions from the records in this report.')
    const chapterPerf = getChapterPerformance({ ...scoped, chapters: data.chapters })
    const tips = [getSmartTip(scoped), ...chapterPerf.filter(item => item.dropping).slice(0, 5).map(item => `${item.chapter.name} is down on the latest result; compare the question paper and note the reason.`)]
    for (const [index, tip] of [...new Set(tips)].entries()) {
      doc.setFillColor(index % 2 ? 243 : 237, index % 2 ? 241 : 237, index % 2 ? 230 : 215)
      const lines = doc.splitTextToSize(tip, 155) as string[]
      const boxH = Math.max(24, lines.length * 6 + 13)
      if (y + boxH > height - 25) { pdfFooter(doc, 'STUDY NOTES'); doc.addPage(); y = pdfSectionTitle(doc, 'Study notes · continued') }
      doc.roundedRect(17, y, 176, boxH, 3, 3, 'F')
      doc.setFont('helvetica', 'bold'); doc.setTextColor(79, 98, 71); doc.setFontSize(10); doc.text(`${index + 1}.`, 23, y + 11)
      doc.setFont('helvetica', 'normal'); doc.setTextColor(54, 57, 51); doc.text(lines, 33, y + 11)
      y += boxH + 6
    }
    pdfFooter(doc, 'STUDY NOTES')
  }
  doc.save('stracker-study-report.pdf')
}

const docParagraph = (text: string, options: { bold?: boolean; size?: number; color?: string; font?: string; heading?: (typeof HeadingLevel)[keyof typeof HeadingLevel]; alignment?: (typeof AlignmentType)[keyof typeof AlignmentType]; spacing?: number } = {}) => new Paragraph({
  text, heading: options.heading, alignment: options.alignment,
  spacing: { after: options.spacing ?? 120 },
  children: [new TextRun({ text, bold: options.bold, size: options.size ?? 22, color: options.color ?? '353A32', font: options.font ?? 'Aptos' })]
})

function docTable(headers: string[], rows: string[][]): Table {
  const cell = (text: string, header = false) => new TableCell({
    shading: header ? { fill: 'E9E5D9' } : undefined,
    margins: { top: 90, bottom: 90, left: 110, right: 110 },
    children: [new Paragraph({ children: [new TextRun({ text, bold: header, size: 18, font: header ? 'Kalam' : 'Aptos', color: '33382F' })] })]
  })
  const border = { style: BorderStyle.SINGLE, size: 3, color: 'DAD5C7' }
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
    rows: [new TableRow({ tableHeader: true, children: headers.map(value => cell(value, true)) }), ...rows.map(row => new TableRow({ children: row.map(value => cell(value || '—')) }))]
  })
}

export async function createDocxReport(data: AppData, options: ReportOptions): Promise<void> {
  const scoped = scopedData(data, options.from, options.to)
  const content: (Paragraph | Table)[] = []
  const rangeLabel = options.from || options.to ? `${options.from ? prettyDate(options.from) : 'All time'} — ${options.to ? prettyDate(options.to) : 'Today'}` : 'All recorded time'
  const reportDate = prettyDate(indiaToday())
  const selected = options.sections
  const trendImage = await svgPng(chartSvg(scoped, 'trend'))
  const hoursImage = await svgPng(chartSvg(scoped, 'hours'))
  content.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 1400, after: 260 }, children: [new TextRun({ text: 'STRACKER', bold: true, size: 56, color: '354432', font: 'Kalam' })] }))
  content.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 800 }, children: [new TextRun({ text: 'JEE Study Progress Report', size: 34, color: '65735D', font: 'Patrick Hand' })] }))
  content.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [new TextRun({ text: options.ownerName || 'Study notebook', bold: true, size: 30, color: '30352E', font: 'Kalam' })] }))
  content.push(docParagraph(`Report date: ${reportDate}`, { alignment: AlignmentType.CENTER, size: 22, color: '777367' }))
  content.push(docParagraph(`Selected range: ${rangeLabel}`, { alignment: AlignmentType.CENTER, size: 22, color: '777367', spacing: 500 }))
  content.push(docParagraph('“Progress is a practice, not a single score.”', { alignment: AlignmentType.CENTER, size: 26, color: '52684D', font: 'Kalam', spacing: 1100 }))
  content.push(docParagraph('Stracker by DYPOL LABS', { alignment: AlignmentType.CENTER, bold: true, size: 20, color: '58674F' }))
  content.push(new Paragraph({ children: [new PageBreak()] }))

  if (selected.summary) {
    content.push(docParagraph('At a glance', { heading: HeadingLevel.HEADING_1, font: 'Kalam', size: 34, color: '354432' }))
    const scores = scoped.tests.map(test => overallTestMarks(test, scoped)).filter((item): item is { marks: number; total: number } => item !== null)
    const average = scores.length ? scores.reduce((sum, item) => sum + item.marks / item.total * 100, 0) / scores.length : null
    const best = scores.length ? Math.max(...scores.map(item => item.marks / item.total * 100)) : null
    const streak = getStudyStreak(data)
    content.push(docTable(['Measure','Recorded value'], [
      ['Tests taken', `${scoped.tests.length}`], ['Average score', average === null ? 'No usable result' : `${Math.round(average)}%`],
      ['Best score', best === null ? 'No usable result' : `${Math.round(best)}%`],
      ['Study time', fmtDuration(scoped.sessions.reduce((sum, session) => sum + session.duration_minutes, 0))],
      ['Syllabus progress', `${data.chapters.filter(item => item.status === 'Done' || item.status === 'Revised').length} / ${data.chapters.length}`],
      ['Current study streak', `${streak.current} day(s)`], ['Target score', `${fmtNumber(data.settings.target_score)}`]
    ]))
    content.push(new Paragraph({ children: [new PageBreak()] }))
  }
  if (selected.performance) {
    content.push(docParagraph('Performance', { heading: HeadingLevel.HEADING_1, font: 'Kalam', size: 34, color: '354432' }))
    content.push(new Paragraph({ children: [new ImageRun({ data: trendImage, type: 'png', transformation: { width: 600, height: 215 } })], spacing: { after: 180 } }))
    content.push(docTable(['Subject','Average','Results'], getSubjectPerformance(scoped).map(item => [item.subject, item.average === null ? 'No usable scores' : `${Math.round(item.average)}%`, `${item.count}`])))
    content.push(new Paragraph({ children: [new PageBreak()] }))
  }
  if (selected.chapters) {
    content.push(docParagraph('Chapter signals', { heading: HeadingLevel.HEADING_1, font: 'Kalam', size: 34, color: '354432' }))
    const rows = getChapterPerformance({ ...scoped, chapters: data.chapters })
    content.push(docTable(['Chapter','Subject','Recent average','Latest','Signal'], rows.map(item => [item.chapter.name, item.chapter.subject, item.average == null ? '—' : `${Math.round(item.average)}%`, item.latest == null ? '—' : `${Math.round(item.latest)}%`, item.dropping ? 'Dropping' : item.classification])))
    content.push(docParagraph(`Syllabus completion: ${data.chapters.filter(item => item.status === 'Done' || item.status === 'Revised').length} / ${data.chapters.length} chapters.`))
    content.push(new Paragraph({ children: [new PageBreak()] }))
  }
  if (selected.mistakes) {
    content.push(docParagraph('Mistake breakdown', { heading: HeadingLevel.HEADING_1, font: 'Kalam', size: 34, color: '354432' }))
    content.push(docTable(['Mistake type','Entries'], getMistakeCounts(scoped).map(item => [item.type, `${item.count}`])))
    content.push(docParagraph(`Retry questions still pending: ${scoped.mistakes.filter(item => item.retry_later && item.retry_status === 'pending').length}.`))
    content.push(new Paragraph({ children: [new PageBreak()] }))
  }
  if (selected.tests) {
    content.push(docParagraph('Test history', { heading: HeadingLevel.HEADING_1, font: 'Kalam', size: 34, color: '354432' }))
    const rows = [...scoped.tests].sort((a, b) => b.test_date.localeCompare(a.test_date)).map(test => {
      const score = overallTestMarks(test, scoped)
      return [test.test_date, test.title, test.test_type, test.subject ?? '—', score ? `${fmtNumber(score.marks, 1)} / ${fmtNumber(score.total, 1)}` : '—', score ? `${Math.round(score.marks / score.total * 100)}%` : '—']
    })
    content.push(docTable(['Date','Test','Type','Subject','Score','%'], rows.length ? rows : [['—','No tests in this range','—','—','—','—']]))
    content.push(new Paragraph({ children: [new PageBreak()] }))
  }
  if (selected.study) {
    content.push(docParagraph('Study hours', { heading: HeadingLevel.HEADING_1, font: 'Kalam', size: 34, color: '354432' }))
    content.push(new Paragraph({ children: [new ImageRun({ data: hoursImage, type: 'png', transformation: { width: 600, height: 215 } })], spacing: { after: 150 } }))
    content.push(docParagraph(`Total logged study time: ${fmtDuration(scoped.sessions.reduce((sum, session) => sum + session.duration_minutes, 0))}.`))
    content.push(docTable(['Subject','Logged time'], SUBJECTS.map(subject => [subject, fmtDuration(scoped.sessions.filter(session => session.subject === subject).reduce((sum, session) => sum + session.duration_minutes, 0))])))
    content.push(new Paragraph({ children: [new PageBreak()] }))
  }
  if (selected.tips) {
    content.push(docParagraph('Study notes to consider', { heading: HeadingLevel.HEADING_1, font: 'Kalam', size: 34, color: '354432' }))
    content.push(docParagraph(getSmartTip(scoped), { size: 23, color: '44563F', font: 'Patrick Hand' }))
    const drops = getChapterPerformance({ ...scoped, chapters: data.chapters }).filter(item => item.dropping)
    for (const item of drops) content.push(docParagraph(`${item.chapter.name}: the latest percentage is down from the prior result. Review the paper and note what changed.`, { size: 22 }))
  }

  const doc = new Document({
    styles: {
      default: { document: { run: { font: 'Aptos', size: 22, color: '353A32' }, paragraph: { spacing: { after: 120 } } }, title: { run: { font: 'Kalam', size: 42, bold: true, color: '354432' } } }
    },
    sections: [{ properties: { page: { margin: { top: 850, right: 800, bottom: 850, left: 800 } } }, footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Stracker by DYPOL LABS  ·  ', color: '77806D', size: 17 }), new TextRun({ children: [PageNumber.CURRENT], color: '77806D', size: 17 })] })] }) }, children: content }]
  })
  const blob = await Packer.toBlob(doc)
  triggerDownload(blob, 'stracker-study-report.docx')
}
