import type { WorkspaceData } from '../app/types'
import { Icon } from '../components/Icon'
import { EmptyState, Page, PageHeader, SectionHeading, StatCard } from '../components/ui'
import { calculateLevelState, gradeCategoryLabel, subjectLabel } from '../utils/student'
import { displayScore, formatDateTime, numeric, percent } from '../utils/format'

export function GradesPage({ data }: { data: WorkspaceData }) {
  const totalPoints = data.points.reduce((sum, item) => sum + item.points, 0)
  const levelState = calculateLevelState(data.levels, totalPoints)

  return (
    <Page>
      <PageHeader
        eyebrow="Performance"
        title="Grades"
        description="Track final grades, period standing, graded categories, attendance points, and earned rewards."
      />

      <section className="stat-grid">
        <StatCard
          icon="grade"
          label="Final records"
          value={data.finalGrades.length}
          detail="Subject summaries"
        />
        <StatCard
          icon="activity"
          label="Category grades"
          value={data.categoryGrades.length}
          detail="Weighted components"
        />
        <StatCard
          icon="spark"
          label="Points"
          value={totalPoints}
          detail={`${data.points.length} ledger entries`}
        />
        <StatCard
          icon="award"
          label="Level"
          value={levelState.current?.level ?? 1}
          detail={levelState.current?.name ?? 'Getting started'}
        />
      </section>

      <section className="content-grid">
        <div className="section-block">
          <SectionHeading subtitle="Computed subject outcomes." title="Final Grades" />
          {data.finalGrades.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Subject</th>
                    <th>Prelim</th>
                    <th>Midterm</th>
                    <th>Prefinal</th>
                    <th>Final</th>
                    <th>Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {data.finalGrades.map((grade) => (
                    <tr key={grade.id}>
                      <td>{subjectLabel(data, grade.subject)}</td>
                      <td>{displayScore(grade.prelim_grade)}</td>
                      <td>{displayScore(grade.midterm_grade)}</td>
                      <td>{displayScore(grade.prefinal_grade)}</td>
                      <td>{displayScore(grade.final_grade)}</td>
                      <td>{grade.remarks || 'Pending'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              icon="grade"
              title="No grade records"
              message="Final grade records from Django will appear here."
            />
          )}
        </div>

        <aside className="level-panel">
          <SectionHeading subtitle="Gamified progress." title="Level Progress" />
          <div className="level-ring">
            <strong>{levelState.current?.level ?? 1}</strong>
            <span>{levelState.current?.name ?? 'Student'}</span>
          </div>
          <div className="progress-line">
            <span style={{ width: `${levelState.progress}%` }} />
          </div>
          <p>
            {levelState.next
              ? `${Math.max(levelState.next.points_required - totalPoints, 0)} points until ${levelState.next.name}.`
              : 'You have reached the highest configured level.'}
          </p>
        </aside>
      </section>

      <section className="content-grid">
        <div className="section-block">
          <SectionHeading
            subtitle="Prelim, midterm, prefinal, and final standing."
            title="Period Grades"
          />
          {data.periodGrades.length ? (
            <div className="period-grid">
              {data.periodGrades.map((period) => (
                <article className="period-card" key={period.id}>
                  <span className="subject-chip">{period.grading_period}</span>
                  <h2>{subjectLabel(data, period.subject)}</h2>
                  <strong>{displayScore(period.raw_score)}</strong>
                  <p>{period.remarks || 'No remarks yet'}</p>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              icon="grade"
              title="No period grades"
              message="Computed period grades will appear here."
            />
          )}
        </div>

        <div className="section-block">
          <SectionHeading subtitle="Recent gamification events." title="Points" />
          <div className="timeline-list">
            {data.points.length ? (
              data.points.slice(0, 8).map((item) => (
                <div className="timeline-item" key={item.id}>
                  <div className="timeline-dot">
                    <Icon name="spark" />
                  </div>
                  <div>
                    <strong>{item.points} points</strong>
                    <span>{item.description || item.source}</span>
                    <small>{formatDateTime(item.created_at)}</small>
                  </div>
                </div>
              ))
            ) : (
              <EmptyState
                icon="spark"
                title="No point activity"
                message="Point ledger entries will appear after graded work."
              />
            )}
          </div>
        </div>
      </section>

      <section className="section-block">
        <SectionHeading
          subtitle="Raw, transmuted, and weighted grades by grading category."
          title="Grade Breakdown"
        />
        {data.categoryGrades.length ? (
          <div className="grade-breakdown">
            {data.categoryGrades.map((grade) => {
              const category = data.gradeCategories.find(
                (item) => item.id === grade.grade_category,
              )
              const rawPercent = percent(
                numeric(grade.raw_score),
                numeric(grade.total_score),
              )

              return (
                <article className="grade-row" key={grade.id}>
                  <div>
                    <strong>{category?.name ?? 'Grade item'}</strong>
                    <span>
                      {subjectLabel(data, grade.subject)} ·{' '}
                      {category ? gradeCategoryLabel(category) : 'Category'}
                    </span>
                  </div>
                  <div className="grade-row__score">
                    <strong>
                      {numeric(grade.raw_score)}/{numeric(grade.total_score)}
                    </strong>
                    <span>{rawPercent}% raw</span>
                  </div>
                  <div className="progress-line">
                    <span style={{ width: `${rawPercent}%` }} />
                  </div>
                </article>
              )
            })}
          </div>
        ) : (
          <EmptyState
            icon="activity"
            title="No category grades"
            message="Quiz, activity, attendance, coding, and exam grades will appear here."
          />
        )}
      </section>
    </Page>
  )
}
