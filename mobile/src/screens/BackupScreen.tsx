import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { File } from 'expo-file-system'
import * as DocumentPicker from 'expo-document-picker'
import { differenceInCalendarDays } from 'date-fns'
import { z } from 'zod'
import {
  Archive, ArrowDownToLine, CheckCheck, CloudDownload, FileArchive, FileSpreadsheet, FileText, Import, Info, LockKeyhole, Printer, ShieldCheck, Upload
} from '../components/icons'
import { Button } from '../components/ui/Button'
import { DateField, SwitchRow } from '../components/ui/Forms'
import { Screen } from '../components/ui/Screen'
import { NotebookCard, PageHeader, SectionHeading, StatusBadge } from '../components/ui/Surfaces'
import { useTheme } from '../contexts/AppearanceContext'
import { useAuth } from '../contexts/AuthContext'
import { useData } from '../contexts/DataContext'
import { useToast } from '../contexts/ToastContext'
import { createBackup, testsToCsv, validateBackupText, type ValidatedImport } from '../shared/lib/backup'
import { indiaDate, indiaToday, prettyDate } from '../shared/lib/date'
import { bytesToBase64 } from '../lib/images'
import { shareFile } from '../lib/share'
import { supabase } from '../lib/supabase'
import { buildDocxReport } from '../lib/reports/report-docx'
import { buildPdfReport } from '../lib/reports/report-pdf'
import { SECTION_LABELS, type ReportOptions, type ReportSections } from '../lib/reports/report-data'
import type { AppSettings, Mistake, Profile } from '../shared/types'

const MAX_IMPORT_BYTES = 60 * 1024 * 1024
const defaultSections: ReportSections = { summary: true, performance: true, chapters: true, mistakes: true, tests: true, study: true, tips: true }
const rangeSchema = z.object({ from: z.string(), to: z.string() }).refine(value => !value.from || !value.to || value.from <= value.to, { message: 'Start date must be before end date.' })
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

/** Export, report, and restore. Everything is generated on this device and shared only through the share sheet. */
export function BackupScreen() {
  const theme = useTheme()
  const { data, upsert, mergeImportedData, refresh, syncState } = useData()
  const { user } = useAuth()
  const { notify } = useToast()
  const [importPreview, setImportPreview] = useState<ValidatedImport | null>(null)
  const [importFileName, setImportFileName] = useState('')
  const [confirmMerge, setConfirmMerge] = useState(false)
  const [importing, setImporting] = useState(false)
  const [reportFrom, setReportFrom] = useState('')
  const [reportTo, setReportTo] = useState(indiaToday())
  const [sections, setSections] = useState<ReportSections>(defaultSections)
  const [exporting, setExporting] = useState<'json' | 'csv' | 'pdf' | 'docx' | null>(null)

  const backupAge = data.settings.last_backup_at ? differenceInCalendarDays(new Date(), new Date(data.settings.last_backup_at)) : null
  const reminderDue = backupAge === null || backupAge >= 7
  const reportOptions: ReportOptions = { from: reportFrom, to: reportTo, sections, ownerName: data.settings.owner_name || data.profile?.display_name || 'Study notebook' }
  const backupCount = data.tests.length + data.chapters.length + data.mistakes.length + data.sessions.length + data.revisions.length + data.tasks.length
  const rangeError = () => {
    const check = rangeSchema.safeParse({ from: reportFrom, to: reportTo })
    return check.success ? null : check.error.issues[0]?.message ?? 'Check the date range.'
  }

  const exportJson = async () => {
    if (exporting) return
    setExporting('json')
    try {
      const backup = createBackup(data)
      const failures: string[] = []
      // Cloud photos are fetched through short-lived signed links and embedded, so the backup is complete.
      const client = supabase
      if (client && user && !user.isLocal) {
        await Promise.all(backup.mistakes.map(async mistake => {
          if (mistake.image_data || !mistake.image_path) return
          const { data: signed, error } = await client.storage.from('mistake-images').createSignedUrl(mistake.image_path, 300)
          if (error || !signed?.signedUrl) { failures.push(mistake.id); return }
          try {
            const response = await fetch(signed.signedUrl)
            if (!response.ok) { failures.push(mistake.id); return }
            mistake.image_data = `data:image/webp;base64,${bytesToBase64(new Uint8Array(await response.arrayBuffer()))}`
          } catch {
            failures.push(mistake.id)
          }
        }))
      }
      const missing = backup.mistakes.filter(mistake => mistake.image_path && !mistake.image_data)
      if (failures.length || missing.length) {
        throw new Error(`Could not include ${new Set([...failures, ...missing.map(mistake => mistake.id)]).size} stored photo(s). The backup was not shared; check your connection, then retry.`)
      }
      await shareFile({
        name: `stracker-backup-${indiaToday()}.json`,
        content: JSON.stringify(backup, null, 2),
        mimeType: 'application/json',
        dialogTitle: 'Save your Stracker backup'
      })
      const now = new Date().toISOString()
      await upsert('app_settings', { ...data.settings, last_backup_at: now, updated_at: now } as AppSettings)
      notify('JSON backup is ready. Keep a copy somewhere private.')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not create the backup. Retry.', 'error')
    } finally {
      setExporting(null)
    }
  }

  const exportCsv = async () => {
    const problem = rangeError()
    if (problem) { notify(problem, 'error'); return }
    if (exporting) return
    setExporting('csv')
    try {
      await shareFile({
        name: `stracker-test-history-${indiaToday()}.csv`,
        content: testsToCsv(data, reportFrom, reportTo),
        mimeType: 'text/csv',
        dialogTitle: 'Share test history'
      })
      notify('Test history CSV is ready. It opens in Excel and Google Sheets.')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not export the CSV.', 'error')
    } finally {
      setExporting(null)
    }
  }

  const exportReport = async (kind: 'pdf' | 'docx') => {
    const problem = rangeError()
    if (problem) { notify(problem, 'error'); return }
    if (!Object.values(sections).some(Boolean)) { notify('Choose at least one report section.', 'error'); return }
    if (exporting) return
    setExporting(kind)
    try {
      if (kind === 'pdf') {
        const bytes = buildPdfReport(data, reportOptions)
        await shareFile({ name: 'stracker-study-report.pdf', content: bytes, mimeType: 'application/pdf', dialogTitle: 'Share study report' })
      } else {
        const bytes = await buildDocxReport(data, reportOptions)
        await shareFile({ name: 'stracker-study-report.docx', content: bytes, mimeType: DOCX_MIME, dialogTitle: 'Share study report' })
      }
      notify(`${kind.toUpperCase()} report is ready to share.`)
    } catch (error) {
      notify(error instanceof Error ? error.message : `Could not generate the ${kind.toUpperCase()} report.`, 'error')
    } finally {
      setExporting(null)
    }
  }

  const chooseImport = async () => {
    setImportPreview(null)
    setConfirmMerge(false)
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'text/plain', 'application/octet-stream'], copyToCacheDirectory: true, multiple: false })
      if (result.canceled) return
      const asset = result.assets[0]
      if (!asset) return
      if (!asset.name.toLowerCase().endsWith('.json') || (asset.size ?? 0) > MAX_IMPORT_BYTES) {
        notify('Choose a Stracker JSON file under 60 MB.', 'error')
        return
      }
      const text = await new File(asset.uri).text()
      setImportPreview(validateBackupText(text, data))
      setImportFileName(asset.name)
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not read that backup.', 'error')
    }
  }

  const importBackup = async () => {
    if (!importPreview?.backup || !confirmMerge || importing) return
    setImporting(true)
    const backup = importPreview.backup
    try {
      const restored: Mistake[] = (backup.mistakes ?? []).map(source => {
        const hasPhoto = typeof source.image_data === 'string' && source.image_data.startsWith('data:image/')
        if (!hasPhoto) return { ...source, image_path: null, image_preview: null, image_pending: false }
        // The sync engine uploads pending photos to the owner's folder, so imported photos go through the same path.
        return { ...source, image_path: null, image_preview: source.image_data ?? null, image_pending: !user?.isLocal }
      })
      const now = new Date().toISOString()
      const ownerId = user?.id ?? data.settings.id
      const importedSettings = backup.settings ? { ...(backup.settings as AppSettings), id: ownerId, user_id: ownerId, updated_at: now } : null
      const importedProfile: Profile | null = backup.profile && user
        ? { ...(backup.profile as Profile), id: user.id, user_id: user.id, email: user.email, updated_at: now }
        : null
      await mergeImportedData({
        app_settings: importedSettings ? [importedSettings] : [],
        profiles: importedProfile ? [importedProfile] : [],
        chapters: backup.chapters ?? [],
        tests: backup.tests ?? [],
        chapter_revisions: backup.revisions ?? [],
        test_subject_scores: backup.testSubjectScores ?? [],
        test_chapter_links: backup.testChapterLinks ?? [],
        mistakes: restored,
        daily_tasks: backup.tasks ?? [],
        weekly_goals: backup.goals ?? [],
        study_sessions: backup.sessions ?? [],
        practice_sessions: backup.practiceSessions ?? [],
        pyq_records: backup.pyqRecords ?? [],
        chapter_stages: backup.chapterStages ?? [],
        backlog_items: backup.backlogItems ?? [],
        study_cards: backup.studyCards ?? [],
        test_error_logs: backup.testErrorLogs ?? [],
        test_time_entries: backup.testTimeEntries ?? [],
        user_exam_tracks: backup.examTracks ?? []
      })
      const validCount = Object.values(importPreview.counts).reduce((sum, count) => sum + count, 0)
      const syncNote = supabase && user && !user.isLocal ? ' Cloud sync is queued and will retry automatically.' : ''
      notify(`Backup merged on this device. ${validCount} valid records imported; ${importPreview.invalid.length} skipped.${syncNote}`)
      setImportPreview(null)
      setConfirmMerge(false)
      setImportFileName('')
      void refresh()
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not finish the import. Check your notebook and sync status before retrying.', 'error')
    } finally {
      setImporting(false)
    }
  }

  const toggleSection = (key: keyof ReportSections) => setSections(current => ({ ...current, [key]: !current[key] }))
  const busy = exporting !== null

  return (
    <Screen refreshing={syncState === 'syncing'} onRefresh={() => void refresh()}>
      <PageHeader eyebrow="YOUR WORK, YOURS TO KEEP" title="Export & backup" subtitle="Portable copies for your data, report-ready summaries for your next review." action={<Archive size={19} color={theme.colors.muted} />} />

      {reminderDue ? (
        <NotebookCard style={styles.reminder} accent="yellow">
          <View style={styles.row}>
            <ShieldCheck size={18} color={theme.colors.surfaceTipInk} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[theme.type.label, { color: theme.colors.ink }]}>{backupAge === null ? 'You haven’t made a backup yet.' : `Your last backup was ${backupAge} days ago.`}</Text>
              <Text style={[theme.type.caption, { color: theme.colors.inkSoft, fontSize: 13 }]}>Export a private JSON backup to keep your study history safe.</Text>
            </View>
          </View>
          <Button size="sm" onPress={() => void exportJson()} loading={exporting === 'json'} disabled={busy && exporting !== 'json'} icon={<ArrowDownToLine size={15} color={theme.colors.buttonPrimaryInk} />}>
            Backup now
          </Button>
        </NotebookCard>
      ) : null}

      <NotebookCard>
        <View style={[styles.iconTile, { backgroundColor: theme.colors.surfaceWarm }]}><FileArchive size={20} color={theme.colors.surfaceWarmInk} /></View>
        <StatusBadge tone="good">FULL BACKUP</StatusBadge>
        <Text accessibilityRole="header" style={[theme.type.h3, { color: theme.colors.ink }]}>JSON notebook backup</Text>
        <Text style={[theme.type.caption, { color: theme.colors.inkSoft }]}>Settings, syllabus, notes, tests, mistakes, revisions, tasks, goals, sessions and photos.</Text>
        <Bullet text="All owner data in one file" />
        <Bullet text="Re-importable and relationship-aware" />
        <Bullet text="Owner-scoped; no server secret included" icon={<LockKeyhole size={14} color={theme.colors.muted} />} />
        <Button onPress={() => void exportJson()} loading={exporting === 'json'} disabled={busy && exporting !== 'json'} icon={<CloudDownload size={16} color={theme.colors.buttonPrimaryInk} />}>
          Share JSON backup
        </Button>
        <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 12.5 }]}>
          {data.settings.last_backup_at ? `Last JSON backup: ${prettyDate(indiaDate(data.settings.last_backup_at))}` : 'No JSON backup recorded yet'}
        </Text>
      </NotebookCard>

      <NotebookCard>
        <View style={[styles.iconTile, { backgroundColor: theme.colors.greenBg }]}><FileSpreadsheet size={20} color={theme.colors.green} /></View>
        <StatusBadge tone="warn">SPREADSHEET READY</StatusBadge>
        <Text accessibilityRole="header" style={[theme.type.h3, { color: theme.colors.ink }]}>Test history CSV</Text>
        <Text style={[theme.type.caption, { color: theme.colors.inkSoft }]}>A clean, UTF-8 CSV for Excel or Google Sheets, including score, accuracy fields, notes and mock subject marks.</Text>
        <Bullet text="Excel-friendly UTF-8 byte-order mark" />
        <Bullet text="Uses the date range below" />
        <Bullet text="No invented percentages" />
        <Button variant="secondary" onPress={() => void exportCsv()} loading={exporting === 'csv'} disabled={busy && exporting !== 'csv'} icon={<ArrowDownToLine size={16} color={theme.colors.ink} />}>
          Export test CSV
        </Button>
        <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 12.5 }]}>{`${data.tests.length} test record${data.tests.length === 1 ? '' : 's'} in this notebook`}</Text>
      </NotebookCard>

      <NotebookCard>
        <View style={styles.row}>
          <View style={[styles.iconTile, { backgroundColor: theme.colors.surfaceCoolAccentBg }]}><Printer size={20} color={theme.colors.accent} /></View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[theme.type.overline, { color: theme.colors.muted, fontSize: 11 }]}>A POLISHED REVIEW, ON PAPER</Text>
            <Text accessibilityRole="header" style={[theme.type.h3, { color: theme.colors.ink }]}>Build a study report</Text>
            <Text style={[theme.type.caption, { color: theme.colors.inkSoft }]}>Choose the time window and sections. Charts are drawn from saved data.</Text>
          </View>
        </View>
        <View style={styles.rangeGrid}>
          <View style={{ flex: 1 }}>
            <DateField label="From date" value={reportFrom} onChange={setReportFrom} allowClear />
          </View>
          <View style={{ flex: 1 }}>
            <DateField label="To date" value={reportTo} onChange={setReportTo} allowClear={false} />
          </View>
        </View>
        <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 12.5 }]}>
          <Info size={12} color={theme.colors.muted} /> Leave “From” blank to include all recorded history. Reports are generated on this device.
        </Text>
        <View style={styles.sectionHeading}>
          <Text style={[theme.type.label, { color: theme.colors.ink }]}>Include in the report</Text>
          <Pressable accessibilityRole="button" onPress={() => setSections(Object.fromEntries(Object.keys(defaultSections).map(key => [key, true])) as unknown as ReportSections)}>
            <Text style={[theme.type.label, { color: theme.colors.accent }]}>Select all</Text>
          </Pressable>
        </View>
        <View style={styles.sectionList}>
          {SECTION_LABELS.map(item => (
            <SwitchRow key={item.key} label={item.label} description={item.note} value={sections[item.key]} onValueChange={() => toggleSection(item.key)} />
          ))}
        </View>
        <View style={[styles.outputs, { borderTopColor: theme.colors.line }]}>
          <Text style={[theme.type.caption, { color: theme.colors.muted, flex: 1 }]}>Output types{'\n'}PDF for sharing · DOCX for editing</Text>
          <View style={styles.outputButtons}>
            <Button variant="secondary" onPress={() => void exportReport('pdf')} loading={exporting === 'pdf'} disabled={busy && exporting !== 'pdf'} icon={<FileText size={16} color={theme.colors.ink} />}>
              Generate PDF
            </Button>
            <Button onPress={() => void exportReport('docx')} loading={exporting === 'docx'} disabled={busy && exporting !== 'docx'} icon={<FileText size={16} color={theme.colors.buttonPrimaryInk} />}>
              Generate DOCX
            </Button>
          </View>
        </View>
      </NotebookCard>

      <SectionHeading title="Restore from JSON" note="Import merges matching IDs and preserves links. Nothing is changed until you review the preview and confirm." action={
        <Button variant="secondary" size="sm" onPress={() => void chooseImport()} icon={<Upload size={16} color={theme.colors.ink} />}>Choose backup</Button>
      } />

      {!importPreview ? (
        <NotebookCard style={styles.emptyImport}>
          <View style={styles.row}>
            <View style={[styles.iconTile, { backgroundColor: theme.colors.paperSoft }]}><Import size={22} color={theme.colors.muted} /></View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[theme.type.label, { color: theme.colors.ink }]}>Select a Stracker JSON backup</Text>
              <Text style={[theme.type.caption, { color: theme.colors.inkSoft }]}>Your existing notebook is left as-is until you confirm the merge.</Text>
            </View>
          </View>
          <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 12.5 }]}>{`${backupCount} records in the current cache`}</Text>
        </NotebookCard>
      ) : (
        <NotebookCard>
          <View style={styles.previewHead}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[theme.type.overline, { color: theme.colors.muted, fontSize: 11 }]}>IMPORT PREVIEW</Text>
              <Text accessibilityRole="header" style={[theme.type.h3, { color: theme.colors.ink }]} numberOfLines={2}>{importFileName}</Text>
            </View>
            <StatusBadge tone={importPreview.invalid.length || importPreview.warnings.length ? 'warn' : 'good'}>
              {importPreview.invalid.length ? `${importPreview.invalid.length} invalid` : importPreview.warnings.length ? 'Review notes' : 'Structure looks good'}
            </StatusBadge>
          </View>
          <View style={styles.countGrid}>
            {Object.entries(importPreview.counts).map(([name, count]) => (
              <View key={name} style={[styles.countTile, { borderColor: theme.colors.line, backgroundColor: theme.colors.paperSoft }]}>
                <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 12 }]}>{name.replaceAll(/([A-Z])/g, ' $1')}</Text>
                <Text style={[theme.type.h3, { color: theme.colors.ink, fontSize: 18 }]}>{count}</Text>
              </View>
            ))}
          </View>
          {importPreview.warnings.length > 0 ? (
            <View style={[styles.notes, { borderColor: theme.colors.line, backgroundColor: theme.colors.surfaceTip }]}>
              <Text style={[theme.type.label, { color: theme.colors.surfaceTipInk }]}>Backup notes</Text>
              {importPreview.warnings.map((warning, index) => <Text key={`warning-${index}`} style={[theme.type.caption, { color: theme.colors.surfaceTipInk }]}>{warning}</Text>)}
            </View>
          ) : null}
          {importPreview.invalid.length > 0 ? (
            <View style={[styles.notes, { borderColor: theme.colors.line, backgroundColor: theme.colors.redBg }]}>
              <Text style={[theme.type.label, { color: theme.colors.red }]}>Records that will be skipped</Text>
              {importPreview.invalid.slice(0, 8).map((item, index) => (
                <Text key={`${item.collection}-${index}`} style={[theme.type.caption, { color: theme.colors.inkSoft }]}>{`${item.collection} · row ${item.index}: ${item.reason}`}</Text>
              ))}
              {importPreview.invalid.length > 8 ? <Text style={[theme.type.caption, { color: theme.colors.muted }]}>{`And ${importPreview.invalid.length - 8} more invalid rows.`}</Text> : null}
            </View>
          ) : null}
          <SwitchRow label="I understand that records with matching IDs will be updated by this merge." value={confirmMerge} onValueChange={setConfirmMerge} />
          <View style={styles.outputButtons}>
            <Button variant="secondary" onPress={() => { setImportPreview(null); setConfirmMerge(false) }} disabled={importing}>Cancel import</Button>
            <Button onPress={() => void importBackup()} loading={importing} disabled={!confirmMerge || importing} icon={<CheckCheck size={15} color={theme.colors.buttonPrimaryInk} />}>
              Merge backup
            </Button>
          </View>
        </NotebookCard>
      )}

      <View style={[styles.security, { borderColor: theme.colors.surfaceCoolBorder, backgroundColor: theme.colors.surfaceCool }]}>
        <LockKeyhole size={15} color={theme.colors.surfaceCoolInk} />
        <Text style={[theme.type.caption, { color: theme.colors.surfaceCoolInk, flex: 1 }]}>
          Exports are generated on this device and leave only through the share sheet you choose. Stracker does not send reports to a third-party service.
        </Text>
      </View>
    </Screen>
  )
}

function Bullet({ text, icon }: { text: string; icon?: React.ReactNode }) {
  const theme = useTheme()
  return (
    <View style={styles.bullet}>
      {icon ?? <CheckCheck size={14} color={theme.colors.green} />}
      <Text style={[theme.type.caption, { color: theme.colors.inkSoft, flex: 1 }]}>{text}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  reminder: { gap: 10 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  iconTile: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  bullet: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rangeGrid: { flexDirection: 'row', gap: 10 },
  sectionHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 },
  sectionList: { gap: 4 },
  outputs: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  outputButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'flex-end' },
  emptyImport: { gap: 12 },
  previewHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  countGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  countTile: { width: '48.5%', borderWidth: 1, borderRadius: 12, padding: 10, gap: 2 },
  notes: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 6 },
  security: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderWidth: 1, borderRadius: 12, padding: 12 }
})

