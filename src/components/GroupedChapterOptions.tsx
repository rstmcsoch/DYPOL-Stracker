import { groupedChapterOptions } from '../lib/planner-fields'

/** <option> rows for a General-subject chapter <select>, grouped under one heading per subject. */
export function GroupedChapterOptions({ chapters, subjectOrder }: { chapters: { id: string; subject: string; position?: number; name: string }[]; subjectOrder: readonly string[] }) {
  return <>{groupedChapterOptions(chapters, subjectOrder).map(row => row.kind === 'heading'
    ? <option key={`h-${row.subject}`} disabled value={`__heading_${row.subject}`} className="chapter-group-heading">{`── ${row.subject} ──`}</option>
    : <option key={row.id} value={row.id}>{row.label}</option>)}</>
}
