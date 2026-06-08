import { Link } from 'react-router-dom'
import type { WorkspaceData } from '../app/types'
import { Icon } from '../components/Icon'
import { EmptyState, MetaStrip, Page, PageHeader, SkeletonCard, StatCard } from '../components/ui'
import { getStudentEnrollments, scheduleTime } from '../utils/student'

export function ClassesPage({ data }: { data: WorkspaceData }) {
  const enrollments = getStudentEnrollments(data)
  const activeEnrollments = enrollments.filter((enrollment) => enrollment.is_active)
  const scheduleCards = activeEnrollments
    .map((enrollment) => ({
      enrollment,
      schedule: data.schedules.find((item) => item.id === enrollment.schedule),
    }))
    .filter((item) => item.schedule)
  const uniqueSubjects = new Set(activeEnrollments.map((item) => item.subject))

  return (
    <Page>
      <PageHeader
        eyebrow="My classes"
        title="Class Schedule"
        description="Your enrolled subjects, class sections, meeting times, and room information."
      />

      <section className="stat-grid">
        <StatCard
          icon="users"
          label="Active classes"
          value={activeEnrollments.length}
          detail={`${uniqueSubjects.size} subjects`}
        />
        <StatCard
          icon="calendar"
          label="Terms"
          value={data.terms.filter((term) => term.is_active).length}
          detail="Active school periods"
        />
        <StatCard
          icon="module"
          label="Modules"
          value={data.modules.length}
          detail="Available lessons"
        />
        <StatCard
          icon="assessment"
          label="Assessments"
          value={data.assessments.length}
          detail="Published checks"
        />
      </section>

      <section className="class-grid">
        {data.loading ? (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        ) : scheduleCards.length ? (
          scheduleCards.map(({ enrollment, schedule }) => (
            <article className="class-card" key={enrollment.id}>
              <div className="module-card__top">
                <span className="subject-chip">{enrollment.subject_code}</span>
                <span className="status-pill">
                  <Icon name="calendar" />
                  {schedule?.days}
                </span>
              </div>
              <h2>{enrollment.subject_name}</h2>
              <MetaStrip
                items={[
                  ['Time', scheduleTime(schedule)],
                  ['Section', schedule?.section || enrollment.student_number || 'Not set'],
                  ['Room', schedule?.room || 'Not set'],
                  ['Term', enrollment.term_name || schedule?.term_name || 'No term'],
                ]}
              />
              <div className="class-card__actions">
                <Link className="button button--secondary" to="/modules">
                  <Icon name="book" />
                  <span>Open lessons</span>
                </Link>
                <Link className="button button--secondary" to="/attendance">
                  <Icon name="check" />
                  <span>Attendance</span>
                </Link>
              </div>
            </article>
          ))
        ) : (
          <EmptyState
            icon="users"
            title="No enrolled classes"
            message="Classes assigned through ScheduleStudent will appear here for students."
          />
        )}
      </section>
    </Page>
  )
}
