import type { RouteData } from '../app/types'
import { Icon } from '../components/Icon'
import { EmptyState, Page, PageHeader, SectionHeading, StatCard } from '../components/ui'
import type { SubjectSchedule } from '../types'
import { calculateLevelState, gradeCategoryLabel, subjectLabel } from '../utils/student'
import { displayScore, formatDateTime, numeric, percent } from '../utils/format'

export function GradesPage({ data }: { data: RouteData }) {
  const totalPoints = data.points.reduce((sum, item) => sum + item.points, 0)
  const levelState = calculateLevelState(data.levels, totalPoints)
  const schedules = data.schedules.filter((schedule) => hasScheduleGrades(data, schedule.id))
  const hasLegacy = data.finalGrades.some((grade) => grade.schedule === null)
    || data.periodGrades.some((grade) => grade.schedule === null)
    || data.categoryGrades.some((grade) => grade.schedule === null)

  return (
    <Page>
      <PageHeader
        eyebrow="Performance"
        title="Grades"
        description="Track final grades, period standing, and graded work separately for each class."
      />

      <section className="stat-grid">
        <StatCard icon="grade" label="Class records" value={schedules.length} detail="Separate class summaries" />
        <StatCard icon="activity" label="Category grades" value={data.categoryGrades.filter((grade) => grade.schedule !== null).length} detail="Weighted components" />
        <StatCard icon="spark" label="Points" value={totalPoints} detail={`${data.points.length} ledger entries`} />
        <StatCard icon="award" label="Level" value={levelState.current?.level ?? 1} detail={levelState.current?.name ?? 'Getting started'} />
      </section>

      {schedules.map((schedule) => (
        <ClassGradeSection data={data} key={schedule.id} schedule={schedule} />
      ))}

      {!schedules.length && !hasLegacy ? (
        <section className="section-block">
          <EmptyState icon="grade" title="No grade records" message="Your class grades will appear here after scores are recorded." />
        </section>
      ) : null}

      {hasLegacy ? <LegacyGradeSection data={data} /> : null}

      <section className="content-grid">
        <div className="section-block">
          <SectionHeading subtitle="Recent gamification events." title="Points" />
          <div className="timeline-list">
            {data.points.length ? data.points.slice(0, 8).map((item) => (
              <div className="timeline-item" key={item.id}>
                <div className="timeline-dot"><Icon name="spark" /></div>
                <div>
                  <strong>{item.points} points</strong>
                  <span>{item.description || item.source}</span>
                  <small>{formatDateTime(item.created_at)}</small>
                </div>
              </div>
            )) : <EmptyState icon="spark" title="No point activity" message="Point ledger entries will appear after graded work." />}
          </div>
        </div>

        <aside className="level-panel">
          <SectionHeading subtitle="Gamified progress." title="Level Progress" />
          <div className="level-ring">
            <strong>{levelState.current?.level ?? 1}</strong>
            <span>{levelState.current?.name ?? 'Student'}</span>
          </div>
          <div className="progress-line"><span style={{ width: `${levelState.progress}%` }} /></div>
          <p>{levelState.next
            ? `${Math.max(levelState.next.points_required - totalPoints, 0)} points until ${levelState.next.name}.`
            : 'You have reached the highest configured level.'}</p>
        </aside>
      </section>
    </Page>
  )
}

function ClassGradeSection({ data, schedule }: { data: RouteData; schedule: SubjectSchedule }) {
  const finalGrade = data.finalGrades.find((grade) => grade.schedule === schedule.id)
  const periods = data.periodGrades.filter((grade) => grade.schedule === schedule.id)
  const categories = data.categoryGrades.filter((grade) => grade.schedule === schedule.id)

  return (
    <section className="section-block student-class-grades">
      <SectionHeading
        subtitle={[schedule.section || 'No section', schedule.term_name, schedule.days].filter(Boolean).join(' · ')}
        title={`${schedule.subject_code} — ${schedule.subject_name}`}
      />
      <div className="grade-summary-grid">
        {(['PRELIM', 'MIDTERM', 'PREFINAL', 'FINAL'] as const).map((period, index) => {
          const record = periods.find((grade) => grade.grading_period === period)
          return <GradeSummary
            key={period}
            label={['Prelim', 'Midterm', 'Prefinal', 'Final period'][index]}
            value={record?.completion_status === 'COMPLETE' ? record.raw_score : null}
            pending={record?.withheld_reason || 'Required work has not been resolved.'}
          />
        })}
        <GradeSummary
          label="Overall"
          value={finalGrade?.completion_status === 'COMPLETE' ? finalGrade.final_grade : null}
          pending={finalGrade?.withheld_reason || 'All grading periods must be complete.'}
        />
      </div>
      {finalGrade?.remarks ? <p className="grade-remarks"><strong>Remarks</strong><span>{finalGrade.remarks}</span></p> : null}
      <CategoryBreakdown data={data} grades={categories} />
    </section>
  )
}

function LegacyGradeSection({ data }: { data: RouteData }) {
  const finals = data.finalGrades.filter((grade) => grade.schedule === null)
  const periods = data.periodGrades.filter((grade) => grade.schedule === null)
  const categories = data.categoryGrades.filter((grade) => grade.schedule === null)

  return (
    <section className="section-block student-class-grades student-class-grades--legacy">
      <SectionHeading
        subtitle="These historical records could not be safely matched to a section or term."
        title="Unassigned Subject Records"
      />
      {finals.map((grade) => (
        <div className="grade-summary-grid" key={grade.id}>
          <GradeSummary label={subjectLabel(data, grade.subject)} value={grade.final_grade} />
          <GradeSummary label="Prelim" value={grade.prelim_grade} />
          <GradeSummary label="Midterm" value={grade.midterm_grade} />
          <GradeSummary label="Prefinal" value={grade.prefinal_grade} />
          <GradeSummary label="Final period" value={grade.final_period_grade} />
        </div>
      ))}
      {!finals.length && periods.length ? (
        <div className="period-grid">
          {periods.map((grade) => (
            <article className="period-card" key={grade.id}>
              <span className="subject-chip">{grade.grading_period}</span>
              <h2>{subjectLabel(data, grade.subject)}</h2>
              <strong>{displayScore(grade.raw_score)}</strong>
            </article>
          ))}
        </div>
      ) : null}
      <CategoryBreakdown data={data} grades={categories} />
    </section>
  )
}

function CategoryBreakdown({ data, grades }: { data: RouteData; grades: RouteData['categoryGrades'] }) {
  if (!grades.length) return <p className="admin-empty-line">No category grades recorded yet.</p>

  return (
    <div className="grade-breakdown">
      {grades.map((grade) => {
        const category = data.gradeCategories.find((item) => item.id === grade.grade_category)
        const rawPercent = percent(numeric(grade.raw_score), numeric(grade.total_score))
        return (
          <article className="grade-row" key={grade.id}>
            <div>
              <strong>{category?.name ?? 'Grade category'}</strong>
              <span>{category ? gradeCategoryLabel(category) : subjectLabel(data, grade.subject)}</span>
            </div>
            <div className="grade-row__score">
              <strong>{grade.completion_status === 'COMPLETE' ? `${numeric(grade.raw_score)}/${numeric(grade.total_score)}` : 'Pending'}</strong>
              {grade.completion_status === 'COMPLETE'
                ? <span>{rawPercent}% raw · {displayScore(grade.weighted_score)} weighted</span>
                : <span>{grade.pending_item_count} required item(s) unresolved</span>}
            </div>
            <div className="progress-line"><span style={{ width: `${rawPercent}%` }} /></div>
          </article>
        )
      })}
    </div>
  )
}

function GradeSummary({ label, value, pending }: { label: string; value: string | null; pending?: string }) {
  return <div className="grade-summary-item" title={value === null ? pending : undefined}>
    <span>{label}</span><strong>{value === null ? 'Pending' : displayScore(value)}</strong>
    {value === null && pending ? <small>{pending}</small> : null}
  </div>
}

function hasScheduleGrades(data: RouteData, scheduleId: number) {
  return data.finalGrades.some((grade) => grade.schedule === scheduleId)
    || data.periodGrades.some((grade) => grade.schedule === scheduleId)
    || data.categoryGrades.some((grade) => grade.schedule === scheduleId)
}
