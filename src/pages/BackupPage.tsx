import { useMemo, useRef, useState, type ChangeEvent } from 'react'
import { differenceInCalendarDays } from 'date-fns'
import { z } from 'zod'
import { useQueryClient } from '@tanstack/react-query'
import {
  Archive, ArrowDownToLine, CheckCircle2, CloudDownload, FileArchive,
  FileSpreadsheet, FileText, Import, Info, LockKeyhole, Printer, ShieldCheck, Upload
} from 'lucide-react'
import { Button, Field, NotebookCard, PageHeader, StatusBadge } from '../components/ui'
import { useAuth } from '../contexts/AuthContext'
import { useData } from '../contexts/DataContext'
import { useToast } from '../contexts/ToastContext'
import { createBackup, testRangeCounts, testRangeSummary, testsToCsv, triggerDownload, validateBackupText, type ValidatedImport } from '../lib/backup'
import { createDocxReport, createPdfReport, type ReportOptions, type ReportSections } from '../lib/report'
import { supabase } from '../lib/supabase'
import { backupCountLabel, backupRecordCount, csvCountLabel, reportCountLabel } from '../lib/export-counts'
import { isOwnedStoragePath } from '../lib/storage-path'
import { indiaDate, prettyDate, indiaToday } from '../lib/date'
import type { AppSettings, Mistake, Profile } from '../types'
import { T } from '../lib/student-layout/T'
import { usePageSlots } from '../lib/student-layout/use-layout'

const sectionOptions: { key: keyof ReportSections; label: string; note: string }[] = [
  { key: 'summary', label: 'Summary', note: 'Tests, best score, study time, streak' },
  { key: 'performance', label: 'Performance charts', note: 'Score trend and subject averages' },
  { key: 'chapters', label: 'Chapter signals', note: 'Weak, strong, dropping and untested' },
  { key: 'mistakes', label: 'Mistake breakdown', note: 'Recorded mistake categories' },
  { key: 'tests', label: 'Test history', note: 'Results within the date range' },
  { key: 'study', label: 'Study hours', note: 'Logged focus sessions' },
  { key: 'tips', label: 'Study notes', note: 'Rule-based tips from real data' }
]
const defaultSections: ReportSections = { summary: true, performance: true, chapters: true, mistakes: true, tests: true, study: true, tips: true }
const reportSchema = z.object({ from: z.string(), to: z.string() }).refine(value => !value.from || !value.to || value.from <= value.to, { message: 'Start date must be before end date.' })

export default function BackupPage() {
  const sl = usePageSlots('backup')
  const { data, updateSettings, mergeImportedData, saveImage } = useData()
  const { user } = useAuth()
  const { notify } = useToast()
  const queryClient = useQueryClient()
  const importInput = useRef<HTMLInputElement>(null)
  const [importPreview, setImportPreview] = useState<ValidatedImport | null>(null)
  const [importFileName, setImportFileName] = useState('')
  const [confirmMerge, setConfirmMerge] = useState(false)
  const [importing, setImporting] = useState(false)
  const [reportFrom, setReportFrom] = useState('')
  const [reportTo, setReportTo] = useState(indiaToday())
  const [sections, setSections] = useState(defaultSections)
  const [exporting, setExporting] = useState<'json' | 'csv' | 'pdf' | 'docx' | null>(null)

  const backupAge = data.settings.last_backup_at ? differenceInCalendarDays(new Date(), new Date(data.settings.last_backup_at)) : null
  const reminderDue = backupAge === null || backupAge >= 7
  const rangeCounts = testRangeCounts(data.tests, reportFrom, reportTo)
  const rangeSummary = testRangeSummary(rangeCounts, reportFrom, reportTo)
  const jsonRecordCount = useMemo(() => backupRecordCount(createBackup(data)), [data])
  const reportCoverage = useMemo(() => reportCountLabel(data, reportFrom, reportTo), [data, reportFrom, reportTo])
  const reportOptions: ReportOptions = { from: reportFrom, to: reportTo, sections, ownerName: data.settings.owner_name || data.profile?.display_name || 'Study notebook' }

  const exportJson = async () => {
    setExporting('json')
    try {
      const backup = createBackup(data)
      const cloud = supabase
      const imageFailures: string[] = []
      if (cloud && user && !user.isLocal) {
        await Promise.all(backup.mistakes.map(async mistake => {
          if (mistake.image_data || !mistake.image_path || !user || !isOwnedStoragePath(user.id, mistake.image_path)) return
          const { data: signed, error } = await cloud.storage.from('mistake-images').createSignedUrl(mistake.image_path, 300)
          if (error || !signed?.signedUrl) { imageFailures.push(mistake.id); return }
          try {
            const response = await fetch(signed.signedUrl)
            if (!response.ok) { imageFailures.push(mistake.id); return }
            mistake.image_data = await blobToDataUrl(await response.blob())
          } catch { imageFailures.push(mistake.id) }
        }))
      }
      const missingImages = backup.mistakes.filter(mistake => mistake.image_path && !mistake.image_data)
      if (imageFailures.length || missingImages.length) {
        throw new Error(`Could not include ${new Set([...imageFailures, ...missingImages.map(mistake => mistake.id)]).size} stored image(s). The backup was not downloaded; check your connection and storage access, then retry.`)
      }
      triggerDownload(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' }), `stracker-backup-${indiaToday()}.json`)
      const backedUpAt = new Date().toISOString()
      // Stamp the latest committed settings row, never a render snapshot that could revert a newer edit.
      await updateSettings(current => ({ ...current, last_backup_at: backedUpAt }))
      notify('Backup downloaded.')
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not create backup. Retry.', 'error') }
    finally { setExporting(null) }
  }

  const exportCsv = () => {
    const check = reportSchema.safeParse({ from: reportFrom, to: reportTo })
    if (!check.success) { notify(check.error.issues[0]?.message ?? 'Check the date range.', 'error'); return }
    setExporting('csv')
    try {
      const csv = testsToCsv(data, reportFrom, reportTo)
      triggerDownload(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `stracker-test-history-${indiaToday()}.csv`)
      notify('Test history exported.')
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not export CSV.', 'error') }
    finally { setExporting(null) }
  }

  const exportReport = async (kind: 'pdf' | 'docx') => {
    const check = reportSchema.safeParse({ from: reportFrom, to: reportTo })
    if (!check.success) { notify(check.error.issues[0]?.message ?? 'Check the date range.', 'error'); return }
    if (!Object.values(sections).some(Boolean)) { notify('Choose at least one report section.', 'error'); return }
    setExporting(kind)
    try {
      if (kind === 'pdf') await createPdfReport(data, reportOptions)
      else await createDocxReport(data, reportOptions)
      notify(`${kind.toUpperCase()} report generated.`)
    } catch (error) { notify(error instanceof Error ? error.message : `Could not generate ${kind.toUpperCase()} report.`, 'error') }
    finally { setExporting(null) }
  }

  const chooseImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setImportPreview(null); setConfirmMerge(false)
    if (!file.name.toLowerCase().endsWith('.json') || file.size > 60 * 1024 * 1024) { notify('Choose a Stracker JSON file under 60 MB.', 'error'); event.target.value = ''; return }
    try {
      const preview = validateBackupText(await file.text(), data)
      setImportPreview(preview); setImportFileName(file.name)
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not read that backup.', 'error') }
    finally { event.target.value = '' }
  }

  const importBackup = async () => {
    if (!importPreview?.backup || !confirmMerge || importing) return
    setImporting(true)
    const backup = importPreview.backup
    try {
      const restored: Mistake[] = []
      for (const source of backup.mistakes ?? []) {
        const mistake: Mistake = { ...source, image_path: null, image_preview: null, image_pending: false }
        if (source.image_data?.startsWith('data:image/')) {
          const image = dataUrlToFile(source.image_data, `${source.id}.webp`)
          const prepared = await saveImage(image)
          mistake.image_path = prepared.path
          mistake.image_data = prepared.dataUrl
          mistake.image_preview = prepared.dataUrl
          mistake.image_pending = !prepared.path && !user?.isLocal
        }
        restored.push(mistake)
      }

      const now = new Date().toISOString()
      const ownerId = user?.id ?? data.settings.id
      const importedSettings = backup.settings ? { ...(backup.settings as AppSettings), id: ownerId, user_id: ownerId, updated_at: now } : null
      const importedProfile: Profile | null = backup.profile && user ? {
        ...(backup.profile as Profile), id: user.id, user_id: user.id, email: user.email, updated_at: now
      } : null

      await mergeImportedData({
        app_settings: importedSettings ? [importedSettings] : [],
        profiles: importedProfile ? [importedProfile] : [],
        chapters: backup.chapters ?? [], tests: backup.tests ?? [],
        chapter_revisions: backup.revisions ?? [],
        test_subject_scores: backup.testSubjectScores ?? [],
        test_chapter_links: backup.testChapterLinks ?? [], mistakes: restored,
        daily_tasks: backup.tasks ?? [], weekly_goals: backup.goals ?? [], study_sessions: backup.sessions ?? [],
        practice_sessions: backup.practiceSessions ?? [], pyq_records: backup.pyqRecords ?? [],
        chapter_stages: backup.chapterStages ?? [], backlog_items: backup.backlogItems ?? [],
        study_cards: backup.studyCards ?? [], test_error_logs: backup.testErrorLogs ?? [],
        test_time_entries: backup.testTimeEntries ?? [], user_exam_tracks: backup.examTracks ?? []
      })
      queryClient.invalidateQueries({ queryKey: ['stracker-data'] })
      const validCount = Object.values(importPreview.counts).reduce((sum, count) => sum + count, 0)
      const syncNote = supabase && user && !user.isLocal ? ' Cloud sync is queued and will retry automatically.' : ''
      notify(`Backup merged locally. ${validCount} valid records imported; ${importPreview.invalid.length} skipped.${syncNote}`)
      setImportPreview(null); setConfirmMerge(false); setImportFileName('')
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not finish the import. Check your notebook and sync status before retrying.', 'error') }
    finally { setImporting(false) }
  }


  const toggleSection = (key: keyof ReportSections) => setSections(current => ({ ...current, [key]: !current[key] }))
  const backupCount = Object.values(data).reduce((count, value) => count + (Array.isArray(value) ? value.length : 0), 0)

  return <div className="content-page backup-page">
    <PageHeader layoutId="backup.header" title="Export & backup" subtitle="Download, import or report your data." doodle={<Archive size={19} />} />
    {reminderDue && <div className="backup-reminder" role="status"><span className="backup-reminder-icon"><ShieldCheck size={18} /></span><div><strong>{backupAge === null ? 'You haven’t made a backup yet.' : `Your last backup was ${backupAge} days ago.`}</strong><p><T k="backup:export-a-private-json-backup-to-keep-you">{"Export a JSON backup to keep your data safe."}</T></p></div><Button size="sm" onClick={() => void exportJson()} loading={exporting === 'json'}><ArrowDownToLine size={15} />{' '}<T k="backup:backup-now">{"Backup now"}</T></Button></div>}

    <section {...sl.attrs('exports')} className="backup-export-grid" aria-label="Data exports"><NotebookCard className="backup-export-card json-export-card"><div className="export-card-icon json-icon"><FileArchive size={20} /></div><StatusBadge tone="Strong"><T k="backup:full-backup">{"FULL BACKUP"}</T></StatusBadge><h2><T k="backup:json-notebook-backup">{"JSON notebook backup"}</T></h2><p><T k="backup:settings-syllabus-notes-tests-mistakes-r">{"Settings, syllabus, notes, tests, mistakes, revisions, tasks, goals, sessions and compressed images."}</T></p><ul><li><CheckCircle2 size={14} />{' '}<T k="backup:all-owner-data-in-one-file">{"All owner data in one file"}</T></li><li><CheckCircle2 size={14} />{' '}<T k="backup:re-importable-and-relationship-aware">{"Re-importable and relationship-aware"}</T></li><li><LockKeyhole size={14} />{' '}<T k="backup:owner-scoped-no-server-secret-included">{"Owner-scoped; no server secret included"}</T></li></ul><Button onClick={() => void exportJson()} loading={exporting === 'json'}><CloudDownload size={16} />{' '}<T k="backup:download-json-backup">{"Download JSON backup"}</T></Button><span className="export-record-count" data-testid="json-record-count">{backupCountLabel(jsonRecordCount)}</span><span className="export-last-date">{data.settings.last_backup_at ? `Last JSON backup: ${prettyDate(indiaDate(data.settings.last_backup_at))}` : 'No JSON backup recorded yet'}</span></NotebookCard>
      <NotebookCard className="backup-export-card csv-export-card"><div className="export-card-icon csv-icon"><FileSpreadsheet size={20} /></div><StatusBadge tone="Okay"><T k="backup:spreadsheet-ready">{"CSV"}</T></StatusBadge><h2><T k="backup:test-history-csv">{"Test history CSV"}</T></h2><p><T k="backup:a-clean-utf-8-csv-for-excel-or-google-sh">{"Export test history to Excel or Google Sheets."}</T></p><ul><li><CheckCircle2 size={14} />{' '}<T k="backup:excel-friendly-utf-8-bom">{"Excel-friendly UTF-8 BOM"}</T></li><li><CheckCircle2 size={14} />{' '}<T k="backup:optional-date-range">{"Optional date range"}</T></li><li><CheckCircle2 size={14} />{' '}<T k="backup:no-invented-percentages">{"No invented percentages"}</T></li></ul><Button variant="secondary" onClick={exportCsv} loading={exporting === 'csv'}><ArrowDownToLine size={16} />{' '}<T k="backup:export-test-csv">{"Export test CSV"}</T></Button><span className="export-record-count" data-testid="csv-record-count">{csvCountLabel(rangeCounts.included)}</span><span className="export-last-date">{data.tests.length} test record{data.tests.length === 1 ? '' : 's'} in this notebook</span>{(rangeCounts.before > 0 || rangeCounts.after > 0) && <span className="export-last-date backup-range-skip" role="status">{rangeSummary} Change the report dates below to include them.</span>}</NotebookCard></section>

    <NotebookCard {...sl.attrs('report')} className="report-builder-card"><div className="report-builder-header"><div className="report-builder-icon"><Printer size={20} /></div><div><span className="eyebrow"><T k="backup:a-polished-review-on-paper">{"REPORT"}</T></span><h2><T k="backup:build-a-study-report">{"Build a study report"}</T></h2><p><T k="backup:choose-the-time-window-and-sections-char">{"Choose a date range and report sections."}</T></p></div><span className="report-pencil" aria-hidden="true">✎</span></div>
      <div className="report-builder-body"><div className="report-range-grid"><Field lk="backup:from-date" label="From date"><input type="date" value={reportFrom} onChange={event => setReportFrom(event.target.value)} /></Field><Field lk="backup:to-date" label="To date"><input type="date" value={reportTo} onChange={event => setReportTo(event.target.value)} /></Field><div className="report-range-note"><Info size={15} />{' '}<T k="backup:leave-from-blank-to-include-all-recorded">{"Leave “From” blank to include all history."}</T></div><p className="report-range-count jee-small" role="status">{rangeSummary}</p></div>
        <div className="report-section-heading"><h3><T k="backup:include-in-the-report">{"Include in the report"}</T></h3><button className="text-button" onClick={() => setSections(Object.fromEntries(Object.keys(defaultSections).map(key => [key, true])) as unknown as ReportSections)}><T k="backup:select-all">{"Select all"}</T></button></div>
        <div className="report-section-grid">{sectionOptions.map(item => <label className={`report-section-option ${sections[item.key] ? 'selected' : ''}`} key={item.key}><input type="checkbox" checked={sections[item.key]} onChange={() => toggleSection(item.key)} /><span className="custom-check"><CheckCircle2 size={14} /></span><span><strong>{item.label}</strong><small>{item.note}</small></span></label>)}</div>
        <div className="report-export-actions"><div><span><T k="backup:output-types">{"Output types"}</T></span><small><T k="backup:pdf-for-sharing-docx-for-editing">{"PDF for sharing · DOCX for editing"}</T></small></div><div><Button variant="secondary" onClick={() => void exportReport('pdf')} loading={exporting === 'pdf'}><FileText size={16} />{' '}<T k="backup:generate-pdf">{"Generate PDF"}</T></Button><Button onClick={() => void exportReport('docx')} loading={exporting === 'docx'}><FileText size={16} />{' '}<T k="backup:generate-docx">{"Generate DOCX"}</T></Button></div></div>
        <p className="export-record-count report-record-count" data-testid="report-record-count" role="status">{reportCoverage}</p>
      </div>
    </NotebookCard>

    <section {...sl.attrs('import')} className="import-section"><div className="import-section-heading"><div><span className="eyebrow"><T k="backup:move-your-data-safely">{"IMPORT"}</T></span><h2><T k="backup:restore-from-json">{"Restore from JSON"}</T></h2><p><T k="backup:import-merges-matching-ids-and-preserves">{"Import merges matching IDs and preserves links. Nothing is changed until you review the preview and confirm."}</T></p></div><button className="import-drop-button" onClick={() => importInput.current?.click()}><Upload size={17} />{' '}<T k="backup:choose-backup">{"Choose backup"}</T></button><input ref={importInput} type="file" accept="application/json,.json" className="visually-hidden" onChange={event => void chooseImport(event)} /></div>
      {!importPreview ? <NotebookCard className="import-empty-card"><div className="import-empty-icon"><Import size={22} /></div><div><strong><T k="backup:select-a-stracker-json-backup">{"Select a Stracker JSON backup"}</T></strong><p><T k="backup:your-existing-notebook-is-left-as-is-unt">{"Your existing notebook is left as-is until you confirm the merge."}</T></p></div><span className="import-current-count">{backupCount} records in current cache</span></NotebookCard> : <NotebookCard className="import-preview-card"><div className="import-preview-head"><div><span className="eyebrow"><T k="backup:import-preview">{"IMPORT PREVIEW"}</T></span><h3>{importFileName}</h3></div><StatusBadge tone={importPreview.invalid.length || importPreview.warnings.length ? 'Okay' : 'Strong'}>{importPreview.invalid.length ? `${importPreview.invalid.length} invalid` : importPreview.warnings.length ? 'Review notes' : 'Structure looks good'}</StatusBadge></div><div className="import-count-grid">{Object.entries(importPreview.counts).map(([name, count]) => <div key={name}><span>{name.replaceAll(/([A-Z])/g, ' $1')}</span><strong>{count}</strong></div>)}</div>{importPreview.warnings.length > 0 && <div className="import-invalid-list import-warning-list"><strong><T k="backup:backup-notes">{"Backup notes"}</T></strong>{importPreview.warnings.map((warning, index) => <p key={`warning-${index}`}>{warning}</p>)}</div>}{importPreview.invalid.length > 0 && <div className="import-invalid-list"><strong><T k="backup:records-that-will-be-skipped">{"Records that will be skipped"}</T></strong>{importPreview.invalid.slice(0, 8).map((item, index) => <p key={`${item.collection}-${index}`}>{item.collection} · row {item.index}: {item.reason}</p>)}{importPreview.invalid.length > 8 && <small>And {importPreview.invalid.length - 8} more invalid rows.</small>}</div>}<label className="import-confirm-check"><input type="checkbox" checked={confirmMerge} onChange={event => setConfirmMerge(event.target.checked)} /><span className="custom-check"><CheckCircle2 size={14} /></span><span><T k="backup:i-understand-that-records-with-matching">{"I understand that records with matching IDs will be updated by this merge."}</T></span></label><div className="dialog-actions"><Button variant="secondary" onClick={() => { setImportPreview(null); setConfirmMerge(false) }}><T k="backup:cancel-import">{"Cancel import"}</T></Button><Button onClick={() => void importBackup()} loading={importing} disabled={!confirmMerge}><Import size={15} />{' '}<T k="backup:confirm-merge">{"Confirm merge"}</T></Button></div></NotebookCard>}
    </section>
    {!sl.hidden('security') && <div {...sl.attrs('security')} className="backup-security-note"><LockKeyhole size={15} /><span><T k="backup:exports-are-generated-in-your-browser-an">{"Exports are made on your device. Nothing is sent to other services."}</T></span></div>}
  </div>
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not add an image to the backup.'))
    reader.onerror = () => reject(new Error('Could not read an image for the backup.'))
    reader.readAsDataURL(blob)
  })
}

function dataUrlToFile(dataUrl: string, name: string): File {
  const match = dataUrl.match(/^data:(image\/(?:webp|png|jpeg));base64,(.*)$/)
  if (!match?.[1] || !match[2]) throw new Error('A backup image had an unsupported format.')
  const binary = atob(match[2])
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
  return new File([bytes], name, { type: match[1] })
}
