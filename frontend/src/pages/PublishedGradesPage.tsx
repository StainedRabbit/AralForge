import { EmptyState, Page, PageHeader, SectionHeading } from '../components/ui'
import { displayScore, formatDateTime } from '../utils/format'

export type PublishedGradeSnapshot = {
  student_id: number
  period: string
  schedule: { id: number; subject_code: string; subject_name: string; section: string; term_name: string }
  summary: Record<string, string | null>
  categories: Array<{ id: number; name: string; raw_score: string | null; total_score: string | null; weighted_score: string | null; completion_status: string }>
  items: Array<{ id: number; title: string; raw_score: string | null; points_possible: string; status: string; remarks: string }>
}

export type GradePublicationRecord = {
  id: number
  period: string
  revision: number
  publication_note: string
  published_by_name: string
  published_at: string
  student_snapshots: Array<{ id: number; snapshot: PublishedGradeSnapshot; snapshot_sha256: string }>
}

export function PublishedGradesPage({ publications }: { publications: GradePublicationRecord[] }) {
  return <Page>
    <PageHeader
      eyebrow="Official releases"
      title="Published grades"
      description="Only grade snapshots explicitly released by your teacher appear here. Working gradebook calculations remain private."
    />
    {!publications.length ? <section className="section-block">
      <EmptyState icon="grade" title="No grades published" message="Your teacher has not published a grade summary yet." />
    </section> : publications.map(publication => {
      const snapshot = publication.student_snapshots[0]?.snapshot
      if (!snapshot) return null
      const overall = publication.period === 'OVERALL'
      return <section className="section-block student-class-grades" key={publication.id}>
        <SectionHeading
          subtitle={`${snapshot.schedule.section || 'No section'} · ${snapshot.schedule.term_name} · ${publication.period} revision ${publication.revision}`}
          title={`${snapshot.schedule.subject_code} — ${snapshot.schedule.subject_name}`}
        />
        <p className="grade-remarks">
          <strong>Published {formatDateTime(publication.published_at)}</strong>
          <span>by {publication.published_by_name}{publication.publication_note ? ` · ${publication.publication_note}` : ''}</span>
        </p>
        <div className="grade-summary-grid">
          {overall ? <>
            <GradeValue label="Prelim" value={snapshot.summary.prelim_grade} />
            <GradeValue label="Midterm" value={snapshot.summary.midterm_grade} />
            <GradeValue label="Prefinal" value={snapshot.summary.prefinal_grade} />
            <GradeValue label="Final period" value={snapshot.summary.final_period_grade} />
            <GradeValue label="Overall" value={snapshot.summary.final_grade} />
          </> : <GradeValue label={publication.period} value={snapshot.summary.raw_score} />}
        </div>
        {snapshot.categories.length ? <div className="grade-breakdown">
          {snapshot.categories.map(category => <article className="grade-row" key={category.id}>
            <div><strong>{category.name}</strong><span>{category.completion_status}</span></div>
            <div className="grade-row__score"><strong>{category.raw_score ?? '—'} / {category.total_score ?? '—'}</strong><span>{category.weighted_score ?? '—'} weighted</span></div>
          </article>)}
        </div> : null}
        {snapshot.items.length ? <div className="table-wrap"><table><thead><tr><th>Item</th><th>Score</th><th>Remarks</th></tr></thead><tbody>
          {snapshot.items.map(item => <tr key={item.id}><td>{item.title}</td><td>{item.status === 'EXCUSED' ? 'Excused' : `${item.raw_score ?? '—'} / ${item.points_possible}`}</td><td>{item.remarks || '—'}</td></tr>)}
        </tbody></table></div> : null}
      </section>
    })}
  </Page>
}

function GradeValue({ label, value }: { label: string; value: string | null | undefined }) {
  return <div className="grade-summary-item"><span>{label}</span><strong>{value == null ? '—' : displayScore(value)}</strong></div>
}
