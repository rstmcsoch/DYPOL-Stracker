import { jsPDF } from 'jspdf'
import { getChapterPerformance, getMistakeCounts, getSmartTip, getStudyStreak, getSubjectPerformance } from '../../shared/lib/analytics'
import { indiaToday } from '../../shared/lib/date'
import { fmtDuration, fmtNumber } from '../../shared/lib/format'
import type { AppData } from '../../shared/types'
import {
  averagePercent, bestPercent, hourBars, negativeMarkSummary, rangeLabel, reportDateLabel, scopedData, subjectMinutes,
  syllabusDone, testRows, totalStudyMinutes, trendPoints, type ReportOptions
} from './report-data'

type RGB = [number, number, number]
const CHART_PAPER: RGB = [251, 249, 243]
const CHART_LINE: RGB = [85, 113, 160]
const CHART_GRID: RGB = [228, 222, 206]
const BAR_GREEN: RGB = [107, 154, 123]
const MUTED: RGB = [103, 101, 91]
const INK: RGB = [39, 44, 38]

/**
 * Builds the PDF on this device. Every chart is drawn with vector primitives (rectangles, lines, and
 * circles), so no canvas or image rasterisation is needed. Returns the file bytes.
 */
export function buildPdfReport(data: AppData, options: ReportOptions): Uint8Array {
  const scoped = scopedData(data, options.from, options.to)
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true })
  const width = doc.internal.pageSize.getWidth()
  const height = doc.internal.pageSize.getHeight()
  const range = rangeLabel(options)
  const selected = options.sections

  // Cover: warm paper with no fabricated figures.
  doc.setFillColor(248, 246, 238); doc.rect(0, 0, width, height, 'F')
  doc.setDrawColor(82, 105, 78); doc.setLineWidth(0.8); doc.roundedRect(12, 12, width - 24, height - 24, 4, 4, 'S')
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(86, 108, 82); doc.text('A JEE 2027 STUDY NOTEBOOK', 22, 44)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(37); doc.setTextColor(39, 45, 38); doc.text('Stracker', 22, 75)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(18); doc.setTextColor(91, 98, 83); doc.text('Study progress report', 22, 88)
  doc.setDrawColor(204, 177, 102); doc.setLineWidth(1.2); doc.line(22, 99, 93, 99)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(44, 48, 42); doc.text(options.ownerName || 'Study notebook', 22, 122)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(100, 101, 89)
  doc.text(`Report date: ${reportDateLabel()}`, 22, 133)
  doc.text(`Date range: ${range}`, 22, 142)
  doc.setFillColor(240, 235, 218); doc.roundedRect(22, 174, width - 44, 40, 3, 3, 'F')
  doc.setFont('helvetica', 'italic'); doc.setFontSize(14); doc.setTextColor(61, 70, 54); doc.text('“Progress is a practice, not a single score.”', 32, 197)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(75, 91, 69); doc.text('Stracker by DYPOL LABS', 22, height - 28)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(110, 108, 96); doc.text('Private study summary · Prepared from the data you recorded', 22, height - 21)

  if (selected.summary) {
    doc.addPage()
    let y = sectionTitle(doc, 'At a glance', 'A quick summary of what you have actually recorded.')
    const average = averagePercent(scoped)
    const best = bestPercent(scoped)
    const streak = getStudyStreak(data)
    const cards: [string, string][] = [
      ['Tests taken', `${scoped.tests.length}`],
      ['Average score', average === null ? '—' : `${Math.round(average)}%`],
      ['Best score', best === null ? '—' : `${Math.round(best)}%`],
      ['Study hours', fmtNumber(totalStudyMinutes(scoped) / 60, 1)],
      ['Syllabus', `${syllabusDone(data)} / ${data.chapters.length}`],
      ['Current streak', `${streak.current} day${streak.current === 1 ? '' : 's'}`],
      ['Target score', data.settings.target_score ? `${fmtNumber(data.settings.target_score)}` : '—']
    ]
    cards.forEach(([label, value], index) => {
      const column = index % 3
      const row = Math.floor(index / 3)
      const x = 17 + column * 59
      const top = y + row * 37
      doc.setFillColor(249, 247, 239); doc.setDrawColor(218, 212, 196); doc.roundedRect(x, top, 54, 28, 2.4, 2.4, 'FD')
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...MUTED); doc.text(label, x + 4, top + 9)
      doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(47, 57, 46); doc.text(value, x + 4, top + 21)
    })
    y += 98
    text(doc, `Date range: ${range}. Average is the arithmetic mean of each usable test percentage; one test counts once.`, 18, y, 170, 10)
    footer(doc, 'SUMMARY')
  }

  if (selected.performance) {
    doc.addPage()
    let y = sectionTitle(doc, 'Performance', 'Percentages keep different test totals on a common scale.')
    drawTrendChart(doc, 17, y, 176, 63, trendPoints(scoped))
    y += 70
    y = text(doc, 'Subject averages · unweighted per-result means', 18, y, 175, 12, [45, 65, 54])
    y = table(doc, getSubjectPerformance(scoped).map(item => [item.subject, item.average === null ? 'No usable scores' : `${Math.round(item.average)}%`, `${item.count}`]), 17, y, [70, 72, 34], ['Subject', 'Average', 'Results'])
    text(doc, negativeMarkSummary(scoped), 18, y + 2, 175, 9)
    footer(doc, 'PERFORMANCE')
  }

  if (selected.chapters) {
    doc.addPage()
    let y = sectionTitle(doc, 'Chapter signals', 'Chapter averages use up to the latest three usable chapter results.')
    const rows = getChapterPerformance({ ...scoped, chapters: data.chapters }).sort((a, b) => (a.average ?? 101) - (b.average ?? 101))
    const group = (title: string, items: typeof rows) => {
      y = text(doc, title, 18, y, 175, 12, [45, 65, 54])
      if (!items.length) y = text(doc, 'None in this report range.', 18, y, 174, 9, [110, 108, 96])
      else y = table(doc, items.map(item => [item.chapter.name, item.chapter.subject, item.average == null ? '—' : `${Math.round(item.average)}%`, item.dropping ? 'Dropping' : item.classification]), 17, y, [72, 34, 29, 41], ['Chapter', 'Subject', 'Average', 'Signal'])
    }
    group('Weak chapters', rows.filter(item => item.classification === 'Weak'))
    group('Strong chapters', rows.filter(item => item.classification === 'Strong'))
    group('Dropping chapters', rows.filter(item => item.dropping))
    group('Untested chapters', rows.filter(item => item.classification === 'Untested'))
    y += 2
    text(doc, `Syllabus completion: ${syllabusDone(data)} / ${data.chapters.length} recorded chapters.`, 18, y, 175, 10)
    footer(doc, 'CHAPTER SIGNALS')
  }

  if (selected.mistakes) {
    doc.addPage()
    let y = sectionTitle(doc, 'Mistake breakdown', 'Counts come from saved mistake notes in this date range.')
    const counts = getMistakeCounts(scoped)
    y = table(doc, counts.map(item => [item.type, `${item.count}`]), 17, y, [95, 81], ['Mistake type', 'Entries'])
    const common = [...counts].sort((a, b) => b.count - a.count)[0]
    if (common?.count) y = text(doc, `Most frequent recorded type: ${common.type} (${common.count}).`, 18, y + 4, 170, 10)
    const retries = scoped.mistakes.filter(item => item.retry_later && item.retry_status === 'pending').length
    text(doc, `Questions still on the retry list: ${retries}.`, 18, y + 2, 170, 10)
    footer(doc, 'MISTAKES')
  }

  if (selected.tests) {
    doc.addPage()
    let y = sectionTitle(doc, 'Test history', `${scoped.tests.length} test records · ${range}`)
    const rows = testRows(scoped)
    if (!rows.length) y = text(doc, 'No tests were recorded in this date range.', 18, y, 170, 10)
    else table(doc, rows, 17, y, [25, 59, 34, 24, 24, 20], ['Date', 'Test', 'Type', 'Subject', 'Score', '%'])
    footer(doc, 'TEST HISTORY')
  }

  if (selected.study) {
    doc.addPage()
    let y = sectionTitle(doc, 'Study hours', 'Focus sessions logged in the selected report range.')
    drawHoursChart(doc, 17, y, 176, 63, hourBars(scoped, options.to || indiaToday()))
    y += 72
    y = text(doc, `Total study time: ${fmtDuration(totalStudyMinutes(scoped))}.`, 18, y, 170, 11)
    table(doc, subjectMinutes(scoped), 17, y + 4, [88, 88], ['Subject', 'Logged time'])
    footer(doc, 'STUDY HOURS')
  }

  if (selected.tips) {
    doc.addPage()
    let y = sectionTitle(doc, 'Study notes to consider', 'Rule-based suggestions from the records in this report.')
    const chapterPerformance = getChapterPerformance({ ...scoped, chapters: data.chapters })
    const tips = [getSmartTip(scoped), ...chapterPerformance.filter(item => item.dropping).slice(0, 5).map(item => `${item.chapter.name} is down on the latest result; compare the question paper and note the reason.`)]
    for (const [index, tip] of [...new Set(tips)].entries()) {
      doc.setFillColor(index % 2 ? 243 : 237, index % 2 ? 241 : 237, index % 2 ? 230 : 215)
      const lines = doc.splitTextToSize(tip, 155) as string[]
      const boxHeight = Math.max(24, lines.length * 6 + 13)
      if (y + boxHeight > height - 25) { footer(doc, 'STUDY NOTES'); doc.addPage(); y = sectionTitle(doc, 'Study notes · continued') }
      doc.roundedRect(17, y, 176, boxHeight, 3, 3, 'F')
      doc.setFont('helvetica', 'bold'); doc.setTextColor(79, 98, 71); doc.setFontSize(10); doc.text(`${index + 1}.`, 23, y + 11)
      doc.setFont('helvetica', 'normal'); doc.setTextColor(54, 57, 51); doc.text(lines, 33, y + 11)
      y += boxHeight + 6
    }
    footer(doc, 'STUDY NOTES')
  }

  return new Uint8Array(doc.output('arraybuffer'))
}

function sectionTitle(doc: jsPDF, title: string, subtitle?: string): number {
  doc.setFont('helvetica', 'bold'); doc.setFontSize(19); doc.setTextColor(...INK); doc.text(title, 17, 23)
  doc.setDrawColor(191, 181, 158); doc.setLineWidth(0.6); doc.line(17, 28, 193, 28)
  if (subtitle) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...MUTED); doc.text(subtitle, 17, 35)
    return 44
  }
  return 37
}

function text(doc: jsPDF, value: string, x: number, y: number, maxWidth: number, size = 10, color: RGB = [55, 59, 52]): number {
  doc.setFont('helvetica', 'normal'); doc.setFontSize(size); doc.setTextColor(...color)
  const lines = doc.splitTextToSize(value, maxWidth) as string[]
  doc.text(lines, x, y)
  return y + lines.length * (size * 0.42) + 2
}

function footer(doc: jsPDF, pageName: string): void {
  const h = doc.internal.pageSize.getHeight()
  doc.setDrawColor(220, 215, 202); doc.line(17, h - 15, 193, h - 15)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(117, 114, 102)
  doc.text('Stracker by DYPOL LABS', 17, h - 9)
  doc.text(pageName, 193, h - 9, { align: 'right' })
}

/** Ruled table with a header row. Rows that would cross the footer start a new page. */
function table(doc: jsPDF, rows: string[][], x: number, y: number, widths: number[], headers: string[]): number {
  let currentY = y
  const drawRow = (values: string[], header = false) => {
    const lineHeight = 5.1
    const cellLines = values.map((value, index) => doc.splitTextToSize(value || '—', (widths[index] ?? 30) - 4) as string[])
    const rowHeight = Math.max(9, Math.max(...cellLines.map(lines => lines.length)) * lineHeight + 4)
    if (currentY + rowHeight > doc.internal.pageSize.getHeight() - 21) {
      footer(doc, 'JEE STUDY REPORT')
      doc.addPage()
      currentY = sectionTitle(doc, 'Continued')
    }
    if (header) doc.setFillColor(235, 231, 218)
    else if (Math.round(currentY / rowHeight) % 2 === 0) doc.setFillColor(250, 248, 241)
    else doc.setFillColor(255, 255, 255)
    doc.setDrawColor(222, 218, 207)
    doc.rect(x, currentY, widths.reduce((sum, value) => sum + value, 0), rowHeight, 'FD')
    let cellX = x
    values.forEach((_value, index) => {
      doc.setFont('helvetica', header ? 'bold' : 'normal'); doc.setFontSize(header ? 8 : 8.5); doc.setTextColor(47, 50, 44)
      doc.text(cellLines[index] ?? ['—'], cellX + 2, currentY + 5.8)
      cellX += widths[index] ?? 0
    })
    currentY += rowHeight
  }
  drawRow(headers, true)
  for (const row of rows) drawRow(row)
  return currentY + 5
}

function chartFrame(doc: jsPDF, x: number, y: number, w: number, h: number, title: string): { left: number; right: number; top: number; bottom: number } {
  doc.setFillColor(...CHART_PAPER); doc.setDrawColor(218, 212, 196)
  doc.roundedRect(x, y, w, h, 3, 3, 'FD')
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...INK); doc.text(title, x + 4, y + 7)
  return { left: x + 14, right: x + w - 5, top: y + 13, bottom: y + h - 9 }
}

function drawTrendChart(doc: jsPDF, x: number, y: number, w: number, h: number, points: { label: string; value: number }[]): void {
  const plot = chartFrame(doc, x, y, w, h, 'Test score trend')
  for (const level of [0, 25, 50, 75, 100]) {
    const gy = plot.bottom - (level / 100) * (plot.bottom - plot.top)
    doc.setDrawColor(...CHART_GRID); doc.setLineWidth(0.25); doc.setLineDashPattern([1.2, 1.5], 0)
    doc.line(plot.left, gy, plot.right, gy)
    doc.setLineDashPattern([], 0)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(...MUTED)
    doc.text(`${level}%`, plot.left - 2, gy + 1, { align: 'right' })
  }
  if (!points.length) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...MUTED)
    doc.text('No percentage results in this range yet.', x + w / 2, y + h / 2, { align: 'center' })
    return
  }
  const coords = points.map((point, index) => ({
    px: points.length === 1 ? plot.left + (plot.right - plot.left) / 2 : plot.left + ((plot.right - plot.left) * index) / (points.length - 1),
    py: plot.bottom - (Math.max(0, Math.min(100, point.value)) / 100) * (plot.bottom - plot.top),
    label: point.label,
    value: point.value
  }))
  doc.setDrawColor(...CHART_LINE); doc.setLineWidth(0.9)
  for (let index = 1; index < coords.length; index += 1) {
    const previous = coords[index - 1]
    const current = coords[index]
    if (previous && current) doc.line(previous.px, previous.py, current.px, current.py)
  }
  for (const point of coords) {
    doc.setFillColor(...CHART_PAPER); doc.setDrawColor(...CHART_LINE); doc.setLineWidth(0.7)
    doc.circle(point.px, point.py, 1.2, 'FD')
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6); doc.setTextColor(...MUTED)
    doc.text(point.label, point.px, plot.bottom + 4, { align: 'center' })
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); doc.setTextColor(...INK)
    doc.text(`${point.value}%`, point.px, point.py - 2.6, { align: 'center' })
  }
}

function drawHoursChart(doc: jsPDF, x: number, y: number, w: number, h: number, bars: { label: string; hours: number; showLabel: boolean }[]): void {
  const plot = chartFrame(doc, x, y, w, h, 'Study hours · last 14 days')
  const scaleMax = Math.max(6, Math.ceil(Math.max(0, ...bars.map(bar => bar.hours))))
  for (let index = 0; index <= 4; index += 1) {
    const value = (scaleMax / 4) * index
    const gy = plot.bottom - (index / 4) * (plot.bottom - plot.top)
    doc.setDrawColor(...CHART_GRID); doc.setLineWidth(0.25); doc.setLineDashPattern([1.2, 1.5], 0)
    doc.line(plot.left, gy, plot.right, gy)
    doc.setLineDashPattern([], 0)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(...MUTED)
    doc.text(`${Math.round(value * 10) / 10}h`, plot.left - 2, gy + 1, { align: 'right' })
  }
  const slot = (plot.right - plot.left) / Math.max(1, bars.length)
  bars.forEach((bar, index) => {
    const barWidth = slot * 0.7
    const barX = plot.left + index * slot + (slot - barWidth) / 2
    const barHeight = (Math.max(0, bar.hours) / scaleMax) * (plot.bottom - plot.top)
    if (barHeight > 0) {
      doc.setFillColor(...BAR_GREEN)
      doc.roundedRect(barX, plot.bottom - barHeight, barWidth, barHeight, 1, 1, 'F')
    }
    if (bar.showLabel) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(6); doc.setTextColor(...MUTED)
      doc.text(bar.label, barX + barWidth / 2, plot.bottom + 4, { align: 'center' })
    }
  })
}

