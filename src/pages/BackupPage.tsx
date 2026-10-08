import { useRef, useState, type ChangeEvent } from 'react'
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
import { createBackup, testsToCsv, triggerDownload, validateBackupText, type ValidatedImport } from '../lib/backup'
import { createDocxReport, createPdfReport, type ReportOptions, type ReportSections } from '../lib/report'
import { supabase } from '../lib/supabase'
import { indiaDate, prettyDate, indiaToday } from '../lib/date'
import type { AppSettings, Mistake, Profile } from '../types'

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
  const reportOptions: ReportOptions = { from: reportFrom, to: reportTo, sections, ownerName: data.settings.owner_name || data.profile?.display_name || 'Study notebook' }

  const exportJson = async () => {
    setExporting('json')
    try {
      const backup = createBackup(data)
      const cloud = supabase
      const imageFailures: string[] = []
      if (cloud && user && !user.isLocal) {
        await Promise.all(backup.mistakes.map(async mistake => {
          if (mistake.image_data || !mistake.image_path) return
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
      notify('Complete JSON backup downloaded. Keep a copy somewhere private.')
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
      notify('Test history exported as an Excel-ready CSV.')
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
    <PageHeader eyebrow="YOUR WORK, YOURS TO KEEP" title="Export & backup" subtitle="Portable copies for your data, report-ready summaries for your next review." doodle={<Archive size={19} />} />
    {reminderDue && <div className="backup-reminder" role="status"><span className="backup-reminder-icon"><ShieldCheck size={18} /></span><div><strong>{backupAge === null ? 'You haven’t made a backup yet.' : `Your last backup was ${backupAge} days ago.`}</strong><p>Export a private JSON backup to keep your study history safe.</p></div><Button size="sm" onClick={() => void exportJson()} loading={exporting === 'json'}><ArrowDownToLine size={15} /> Backup now</Button></div>}

    <section className="backup-export-grid" aria-label="Data exports"><NotebookCard className="backup-export-card json-export-card"><div className="export-card-icon json-icon"><FileArchive size={20} /></div><StatusBadge tone="Strong">FULL BACKUP</StatusBadge><h2>JSON notebook backup</h2><p>Settings, syllabus, notes, tests, mistakes, revisions, tasks, goals, sessions and compressed images.</p><ul><li><CheckCircle2 size={14} /> All owner data in one file</li><li><CheckCircle2 size={14} /> Re-importable and relationship-aware</li><li><LockKeyhole size={14} /> Owner-scoped; no server secret included</li></ul><Button onClick={() => void exportJson()} loading={exporting === 'json'}><CloudDownload size={16} /> Download JSON backup</Button><span className="export-last-date">{data.settings.last_backup_at ? `Last JSON backup: ${prettyDate(indiaDate(data.settings.last_backup_at))}` : 'No JSON backup recorded yet'}</span></NotebookCard>
      <NotebookCard className="backup-export-card csv-export-card"><div className="export-card-icon csv-icon"><FileSpreadsheet size={20} /></div><StatusBadge tone="Okay">SPREADSHEET READY</StatusBadge><h2>Test history CSV</h2><p>A clean, UTF-8 CSV for Excel or Google Sheets, including score, accuracy fields, notes and mock subject marks.</p><ul><li><CheckCircle2 size={14} /> Excel-friendly UTF-8 BOM</li><li><CheckCircle2 size={14} /> Optional date range</li><li><CheckCircle2 size={14} /> No invented percentages</li></ul><Button variant="secondary" onClick={exportCsv} loading={exporting === 'csv'}><ArrowDownToLine size={16} /> Export test CSV</Button><span className="export-last-date">{data.tests.length} test record{data.tests.length === 1 ? '' : 's'} in this notebook</span></NotebookCard></section>

    <NotebookCard className="report-builder-card"><div className="report-builder-header"><div className="report-builder-icon"><Printer size={20} /></div><div><span className="eyebrow">A POLISHED REVIEW, ON PAPER</span><h2>Build a study report</h2><p>Choose the time window and sections. Charts are rendered at high resolution from saved data.</p></div><span className="report-pencil" aria-hidden="true">✎</span></div>
      <div className="report-builder-body"><div className="report-range-grid"><Field label="From date"><input type="date" value={reportFrom} onChange={event => setReportFrom(event.target.value)} /></Field><Field label="To date"><input type="date" value={reportTo} onChange={event => setReportTo(event.target.value)} /></Field><div className="report-range-note"><Info size={15} /> Leave “From” blank to include all recorded history. Reports are generated on this device.</div></div>
        <div className="report-section-heading"><h3>Include in the report</h3><button className="text-button" onClick={() => setSections(Object.fromEntries(Object.keys(defaultSections).map(key => [key, true])) as unknown as ReportSections)}>Select all</button></div>
        <div className="report-section-grid">{sectionOptions.map(item => <label className={`report-section-option ${sections[item.key] ? 'selected' : ''}`} key={item.key}><input type="checkbox" checked={sections[item.key]} onChange={() => toggleSection(item.key)} /><span className="custom-check"><CheckCircle2 size={14} /></span><span><strong>{item.label}</strong><small>{item.note}</small></span></label>)}</div>
        <div className="report-export-actions"><div><span>Output types</span><small>PDF for sharing · DOCX for editing</small></div><div><Button variant="secondary" onClick={() => void exportReport('pdf')} loading={exporting === 'pdf'}><FileText size={16} /> Generate PDF</Button><Button onClick={() => void exportReport('docx')} loading={exporting === 'docx'}><FileText size={16} /> Generate DOCX</Button></div></div>
      </div>
    </NotebookCard>

    <section className="import-section"><div className="import-section-heading"><div><span className="eyebrow">MOVE YOUR DATA SAFELY</span><h2>Restore from JSON</h2><p>Import merges matching IDs and preserves links. Nothing is changed until you review the preview and confirm.</p></div><button className="import-drop-button" onClick={() => importInput.current?.click()}><Upload size={17} /> Choose backup</button><input ref={importInput} type="file" accept="application/json,.json" className="visually-hidden" onChange={event => void chooseImport(event)} /></div>
      {!importPreview ? <NotebookCard className="import-empty-card"><div className="import-empty-icon"><Import size={22} /></div><div><strong>Select a Stracker JSON backup</strong><p>Your existing notebook is left as-is until you confirm the merge.</p></div><span className="import-current-count">{backupCount} records in current cache</span></NotebookCard> : <NotebookCard className="import-preview-card"><div className="import-preview-head"><div><span className="eyebrow">IMPORT PREVIEW</span><h3>{importFileName}</h3></div><StatusBadge tone={importPreview.invalid.length || importPreview.warnings.length ? 'Okay' : 'Strong'}>{importPreview.invalid.length ? `${importPreview.invalid.length} invalid` : importPreview.warnings.length ? 'Review notes' : 'Structure looks good'}</StatusBadge></div><div className="import-count-grid">{Object.entries(importPreview.counts).map(([name, count]) => <div key={name}><span>{name.replaceAll(/([A-Z])/g, ' $1')}</span><strong>{count}</strong></div>)}</div>{importPreview.warnings.length > 0 && <div className="import-invalid-list import-warning-list"><strong>Backup notes</strong>{importPreview.warnings.map((warning, index) => <p key={`warning-${index}`}>{warning}</p>)}</div>}{importPreview.invalid.length > 0 && <div className="import-invalid-list"><strong>Records that will be skipped</strong>{importPreview.invalid.slice(0, 8).map((item, index) => <p key={`${item.collection}-${index}`}>{item.collection} · row {item.index}: {item.reason}</p>)}{importPreview.invalid.length > 8 && <small>And {importPreview.invalid.length - 8} more invalid rows.</small>}</div>}<label className="import-confirm-check"><input type="checkbox" checked={confirmMerge} onChange={event => setConfirmMerge(event.target.checked)} /><span className="custom-check"><CheckCircle2 size={14} /></span><span>I understand that records with matching IDs will be updated by this merge.</span></label><div className="dialog-actions"><Button variant="secondary" onClick={() => { setImportPreview(null); setConfirmMerge(false) }}>Cancel import</Button><Button onClick={() => void importBackup()} loading={importing} disabled={!confirmMerge}><Import size={15} /> Confirm merge</Button></div></NotebookCard>}
    </section>
    <div className="backup-security-note"><LockKeyhole size={15} /><span>Exports are generated in your browser and saved to your device. Stracker does not send reports to a third-party service.</span></div>
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
