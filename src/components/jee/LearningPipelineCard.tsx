import { useMemo } from 'react'
import { NotebookCard, SectionHeading } from '../ui'
import { Meter, Pct } from './shared'
import { useData } from '../../contexts/DataContext'
import { stageCounts, syllabusProgress } from '../../lib/jee/progress'
import { CHAPTER_STAGE_KEYS } from '../../types'

const LABEL: Record<(typeof CHAPTER_STAGE_KEYS)[number], string> = { theory: 'Theory', notes: 'Notes', pyqs: 'PYQs', revised: 'Revised', tested: 'Tested' }

/** How many chapters are at each learning stage, plus raw vs weighted syllabus completion. */
export function LearningPipelineCard() {
  const { data } = useData()
  const counts = useMemo(() => stageCounts(data), [data])
  const progress = useMemo(() => syllabusProgress(data.chapters, data.settings), [data.chapters, data.settings])
  const total = data.chapters.length
  return <section aria-label="Learning pipeline">
    <SectionHeading title="Learning pipeline" note="Chapters at each stage. Stages are independent, so counts need not add up to the same chapters." />
    <NotebookCard className="jee-pipeline-card">
      <div className="jee-pipeline-counts">
        {CHAPTER_STAGE_KEYS.map(key => <div key={key} className="jee-pipeline-count">
          <span>{LABEL[key]}</span>
          <strong>{counts[key]}<small>/{total}</small></strong>
          <Meter value={total ? (counts[key] / total) * 100 : 0} label={`${LABEL[key]} chapters`} tone={key === 'tested' ? 'green' : 'blue'} />
        </div>)}
      </div>
      <div className="jee-progress-compare">
        <div><span>Raw completion</span><strong><Pct value={progress.raw} /></strong></div>
        <div><span>Weighted completion</span><strong><Pct value={progress.weighted} /></strong></div>
      </div>
    </NotebookCard>
  </section>
}
