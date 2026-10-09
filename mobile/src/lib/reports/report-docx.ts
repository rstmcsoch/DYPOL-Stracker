import { AlignmentType, BorderStyle, Document, Footer, HeadingLevel, PageBreak, PageNumber, Packer, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType } from 'docx'
import { getChapterPerformance, getMistakeCounts, getSmartTip, getStudyStreak, getSubjectPerformance } from '../../shared/lib/analytics'
import { indiaToday } from '../../shared/lib/date'
import { fmtDuration, fmtNumber } from '../../shared/lib/format'
import type { AppData } from '../../shared/types'
import { base64ToBytes } from '../images'
import {
  averagePercent, bestPercent, hourBars, negativeMarkSummary, rangeLabel, reportDateLabel, scopedData, subjectMinutes,
  syllabusDone, testRows, totalStudyMinutes, trendPoints, type ReportOptions
} from './report-data'

const HEADING = { font: 'Kalam', size: 34, color: '354432' }
const BAR_FILL = '6B9A7B'
const TRACK_FILL = 'EFEBDD'
const TABLE_WIDTH = 9000

type ParagraphChild = Paragraph | Table

function docParagraph(text: string, options: { bold?: boolean; size?: number; color?: string; font?: string; heading?: (typeof HeadingLevel)[keyof typeof HeadingLevel]; alignment?: (typeof AlignmentType)[keyof typeof AlignmentType]; spacing?: number } = {}): Paragraph {
  return new Paragraph({
    heading: options.heading,
    alignment: options.alignment,
    spacing: { after: options.spacing ?? 120 },
    children: [new TextRun({ text, bold: options.bold, size: options.size ?? 22, color: options.color ?? '353A32', font: options.font ?? 'Aptos' })]
  })
}

function pageBreak(): Paragraph {
  return new Paragraph({ children: [new PageBreak()] })
}

function docTable(headers: string[], rows: string[][]): Table {
  const cell = (text: string, header = false) => new TableCell({
    shading: header ? { type: ShadingType.CLEAR, color: 'auto', fill: 'E9E5D9' } : undefined,
    margins: { top: 90, bottom: 90, left: 110, right: 110 },
    children: [new Paragraph({ children: [new TextRun({ text, bold: header, size: 18, font: header ? 'Kalam' : 'Aptos', color: '33382F' })] })]
  })
  const border = { style: BorderStyle.SINGLE, size: 3, color: 'DAD5C7' }
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
    rows: [
      new TableRow({ tableHeader: true, children: headers.map(value => cell(value, true)) }),
      ...rows.map(row => new TableRow({ children: row.map(value => cell(value || '—')) }))
    ]
  })
}

/**
 * A bar chart drawn as a Word table. Each row has a label, a shaded bar whose width is the value's share
 * of the scale, and the value. Word draws it natively, so the file needs no embedded image.
 */
function barTable(rows: { label: string; value: number; display: string }[], scaleMax: number): Table {
  const labelWidth = 2600
  const valueWidth = 1500
  const barArea = TABLE_WIDTH - labelWidth - valueWidth
  const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
  const borders = { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none }
  return new Table({
    width: { size: TABLE_WIDTH, type: WidthType.DXA },
    columnWidths: [labelWidth, barArea, valueWidth],
    borders,
    rows: rows.map(row => {
      const share = Math.max(0, Math.min(1, row.value / scaleMax))
      const filled = Math.round(barArea * share)
      const empty = Math.max(1, barArea - filled)
      const inner = new Table({
        width: { size: barArea, type: WidthType.DXA },
        columnWidths: [Math.max(1, filled), empty],
        borders,
        rows: [new TableRow({
          children: [
            new TableCell({ width: { size: Math.max(1, filled), type: WidthType.DXA }, shading: { type: ShadingType.CLEAR, color: 'auto', fill: BAR_FILL }, children: [new Paragraph({ spacing: { after: 0 }, children: [new TextRun({ text: ' ', size: 14 })] })] }),
            new TableCell({ width: { size: empty, type: WidthType.DXA }, shading: { type: ShadingType.CLEAR, color: 'auto', fill: TRACK_FILL }, children: [new Paragraph({ spacing: { after: 0 }, children: [new TextRun({ text: ' ', size: 14 })] })] })
          ]
        })]
      })
      return new TableRow({
        children: [
          new TableCell({ width: { size: labelWidth, type: WidthType.DXA }, margins: { top: 60, bottom: 60, left: 80, right: 80 }, children: [new Paragraph({ spacing: { after: 0 }, children: [new TextRun({ text: row.label, size: 19, font: 'Aptos', color: '33382F' })] })] }),
          new TableCell({ width: { size: barArea, type: WidthType.DXA }, margins: { top: 60, bottom: 60, left: 0, right: 80 }, children: [inner] }),
          new TableCell({ width: { size: valueWidth, type: WidthType.DXA }, margins: { top: 60, bottom: 60, left: 80, right: 80 }, children: [new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { after: 0 }, children: [new TextRun({ text: row.display, bold: true, size: 19, font: 'Aptos', color: '33382F' })] })] })
        ]
      })
    })
  })
}

/** Builds the DOCX on this device and returns its bytes. Charts are native Word tables, not images. */
export async function buildDocxReport(data: AppData, options: ReportOptions): Promise<Uint8Array> {
  const scoped = scopedData(data, options.from, options.to)
  const content: ParagraphChild[] = []
  const range = rangeLabel(options)
  const selected = options.sections

  content.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 1400, after: 260 }, children: [new TextRun({ text: 'STRACKER', bold: true, size: 56, color: '354432', font: 'Kalam' })] }))
  content.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 800 }, children: [new TextRun({ text: 'JEE Study Progress Report', size: 34, color: '65735D', font: 'Patrick Hand' })] }))
  content.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [new TextRun({ text: options.ownerName || 'Study notebook', bold: true, size: 30, color: '30352E', font: 'Kalam' })] }))
  content.push(docParagraph(`Report date: ${reportDateLabel()}`, { alignment: AlignmentType.CENTER, size: 22, color: '777367' }))
  content.push(docParagraph(`Selected range: ${range}`, { alignment: AlignmentType.CENTER, size: 22, color: '777367', spacing: 500 }))
  content.push(docParagraph('“Progress is a practice, not a single score.”', { alignment: AlignmentType.CENTER, size: 26, color: '52684D', font: 'Kalam', spacing: 1100 }))
  content.push(docParagraph('Stracker by DYPOL LABS', { alignment: AlignmentType.CENTER, bold: true, size: 20, color: '58674F' }))
  content.push(pageBreak())

  if (selected.summary) {
    const average = averagePercent(scoped)
    const best = bestPercent(scoped)
    const streak = getStudyStreak(data)
    content.push(docParagraph('At a glance', { heading: HeadingLevel.HEADING_1, ...HEADING }))
    content.push(docTable(['Measure', 'Recorded value'], [
      ['Tests taken', `${scoped.tests.length}`],
      ['Average score', average === null ? 'No usable result' : `${Math.round(average)}%`],
      ['Best score', best === null ? 'No usable result' : `${Math.round(best)}%`],
      ['Study time', fmtDuration(totalStudyMinutes(scoped))],
      ['Syllabus progress', `${syllabusDone(data)} / ${data.chapters.length}`],
      ['Current study streak', `${streak.current} day(s)`],
      ['Target score', `${fmtNumber(data.settings.target_score)}`]
    ]))
    content.push(pageBreak())
  }

  if (selected.performance) {
    const points = trendPoints(scoped)
    content.push(docParagraph('Performance', { heading: HeadingLevel.HEADING_1, ...HEADING }))
    content.push(docParagraph('Test score trend · last twelve usable results, as percentages.', { bold: true }))
    content.push(points.length
      ? barTable(points.map(point => ({ label: point.label, value: point.value, display: `${point.value}%` })), 100)
      : docParagraph('No percentage results in this range yet.'))
    content.push(docParagraph('Subject averages are unweighted arithmetic means of valid per-result percentages; each subject result counts once.'))
    content.push(docTable(['Subject', 'Average', 'Results'], getSubjectPerformance(scoped).map(item => [item.subject, item.average === null ? 'No usable scores' : `${Math.round(item.average)}%`, `${item.count}`])))
    content.push(docParagraph(negativeMarkSummary(scoped)))
    content.push(pageBreak())
  }

  if (selected.chapters) {
    const rows = getChapterPerformance({ ...scoped, chapters: data.chapters })
    content.push(docParagraph('Chapter signals', { heading: HeadingLevel.HEADING_1, ...HEADING }))
    content.push(docTable(['Chapter', 'Subject', 'Recent average', 'Latest', 'Signal'], rows.map(item => [
      item.chapter.name,
      item.chapter.subject,
      item.average == null ? '—' : `${Math.round(item.average)}%`,
      item.latest == null ? '—' : `${Math.round(item.latest)}%`,
      item.dropping ? 'Dropping' : item.classification
    ])))
    content.push(docParagraph(`Syllabus completion: ${syllabusDone(data)} / ${data.chapters.length} chapters.`))
    content.push(pageBreak())
  }

  if (selected.mistakes) {
    content.push(docParagraph('Mistake breakdown', { heading: HeadingLevel.HEADING_1, ...HEADING }))
    content.push(docTable(['Mistake type', 'Entries'], getMistakeCounts(scoped).map(item => [item.type, `${item.count}`])))
    content.push(docParagraph(`Retry questions still pending: ${scoped.mistakes.filter(item => item.retry_later && item.retry_status === 'pending').length}.`))
    content.push(pageBreak())
  }

  if (selected.tests) {
    const rows = testRows(scoped)
    content.push(docParagraph('Test history', { heading: HeadingLevel.HEADING_1, ...HEADING }))
    content.push(docTable(['Date', 'Test', 'Type', 'Subject', 'Score', '%'], rows.length ? rows : [['—', 'No tests in this range', '—', '—', '—', '—']]))
    content.push(pageBreak())
  }

  if (selected.study) {
    const bars = hourBars(scoped, options.to || indiaToday())
    const scaleMax = Math.max(6, Math.ceil(Math.max(0, ...bars.map(bar => bar.hours))))
    content.push(docParagraph('Study hours', { heading: HeadingLevel.HEADING_1, ...HEADING }))
    content.push(docParagraph('Study hours · last 14 days', { bold: true }))
    content.push(barTable(bars.map(bar => ({ label: bar.label, value: bar.hours, display: `${Math.round(bar.hours * 10) / 10}h` })), scaleMax))
    content.push(docParagraph(`Total logged study time: ${fmtDuration(totalStudyMinutes(scoped))}.`))
    content.push(docTable(['Subject', 'Logged time'], subjectMinutes(scoped)))
    content.push(pageBreak())
  }

  if (selected.tips) {
    content.push(docParagraph('Study notes to consider', { heading: HeadingLevel.HEADING_1, ...HEADING }))
    content.push(docParagraph(getSmartTip(scoped), { size: 23, color: '44563F', font: 'Patrick Hand' }))
    for (const item of getChapterPerformance({ ...scoped, chapters: data.chapters }).filter(row => row.dropping)) {
      content.push(docParagraph(`${item.chapter.name}: the latest percentage is down from the prior result. Review the paper and note what changed.`, { size: 22 }))
    }
  }

  const document = new Document({
    styles: {
      default: { document: { run: { font: 'Aptos', size: 22, color: '353A32' }, paragraph: { spacing: { after: 120 } } } },
      paragraphStyles: [{ id: 'Title', name: 'Title', run: { font: 'Kalam', size: 42, bold: true, color: '354432' } }]
    },
    sections: [{
      properties: { page: { margin: { top: 850, right: 800, bottom: 850, left: 800 } } },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: 'Stracker by DYPOL LABS  ·  ', color: '77806D', size: 17 }),
              new TextRun({ children: [PageNumber.CURRENT], color: '77806D', size: 17 })
            ]
          })]
        })
      },
      children: content as (Paragraph | Table)[]
    }]
  })
  const base64 = await Packer.toBase64String(document)
  return base64ToBytes(base64)
}
