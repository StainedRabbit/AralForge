import { Link } from 'react-router-dom'
import type { WorkspaceData } from '../../app/types'
import { Icon } from '../../components/Icon'
import { Page, PageHeader, SectionHeading, StatCard } from '../../components/ui'
import { displayScore, formatDateTime, numeric } from '../../utils/format'
import { fullName } from '../../utils/student'
import {
  activityName,
  moduleName,
  subjectName,
  userName,
} from '../../admin/adminHelpers'

export function AdminDashboardPage({
  data,
  refresh,
}: {
  data: WorkspaceData
  refresh: () => Promise<void>
}) {
  const students = data.users.filter((user) => user.role === 'STUDENT')
  const lockedPaidModules = data.modules.filter(
    (module) => module.is_paid && module.is_published,
  )
  const ungradedModuleSubmissions = data.submissions.filter(
    (submission) => submission.score === null,
  )
  const ungradedAnswers = data.answers.filter(
    (answer) => answer.points_earned === null,
  )
  const attendanceToday = data.attendanceSessions.filter((session) => {
    const today = new Date().toISOString().slice(0, 10)
    return session.date === today
  })

  return (
    <Page>
      <PageHeader
        eyebrow="Admin workspace"
        title={`Teacher Console, ${fullName(data.currentUser)}.`}
        description="Manage students, classes, paid access, modules, assessments, attendance, grades, and rewards."
        actions={
          <button className="button button--secondary" onClick={refresh} type="button">
            <Icon name="spark" />
            <span>Refresh</span>
          </button>
        }
      />

      <section className="stat-grid" aria-label="Admin summary">
        <StatCard
          icon="users"
          label="Students"
          value={students.length}
          detail={`${data.profiles.length} profiles`}
        />
        <StatCard
          icon="module"
          label="Modules"
          value={data.modules.length}
          detail={`${lockedPaidModules.length} paid published`}
        />
        <StatCard
          icon="assessment"
          label="Assessments"
          value={data.assessments.length}
          detail={`${data.questions.length} questions`}
        />
        <StatCard
          icon="grade"
          label="Grade queue"
          value={ungradedModuleSubmissions.length + ungradedAnswers.length}
          detail="Ungraded work"
        />
      </section>

      <section className="admin-quick-grid">
        <AdminQuickLink
          detail={`${data.moduleAccess.length} module grants`}
          icon="shield"
          label="Paid access"
          to="/admin/students"
        />
        <AdminQuickLink
          detail={`${data.schedules.length} schedules`}
          icon="calendar"
          label="Classes"
          to="/admin/classes"
        />
        <AdminQuickLink
          detail={`${data.problems.length} problems`}
          icon="code"
          label="Coding lab"
          to="/admin/coding"
        />
        <AdminQuickLink
          detail={`${data.gradeCategories.length} categories`}
          icon="grade"
          label="Grades"
          to="/admin/grades"
        />
      </section>

      <section className="content-grid">
        <div className="section-block">
          <SectionHeading
            subtitle={`${ungradedModuleSubmissions.length} module submission${ungradedModuleSubmissions.length === 1 ? '' : 's'}`}
            title="Submission Queue"
          />
          <div className="admin-feed">
            {ungradedModuleSubmissions.slice(0, 8).map((submission) => (
              <div className="admin-feed__item" key={submission.id}>
                <span className="timeline-dot">
                  <Icon name="activity" />
                </span>
                <div>
                  <strong>{activityName(data.activities, submission.activity)}</strong>
                  <span>{userName(data.users, submission.student)}</span>
                  <small>{formatDateTime(submission.submitted_at)}</small>
                </div>
                <Link className="button button--secondary" to="/admin/modules">
                  <Icon name="edit" />
                  <span>Grade</span>
                </Link>
              </div>
            ))}
            {!ungradedModuleSubmissions.length ? (
              <p className="admin-empty-line">No ungraded module submissions.</p>
            ) : null}
          </div>
        </div>

        <div className="section-block">
          <SectionHeading
            subtitle={`${data.attempts.length} total attempts`}
            title="Assessment Activity"
          />
          <div className="admin-feed">
            {data.attempts.slice(0, 8).map((attempt) => (
              <div className="admin-feed__item" key={attempt.id}>
                <span className="timeline-dot">
                  <Icon name={attempt.is_submitted ? 'check' : 'assessment'} />
                </span>
                <div>
                  <strong>{userName(data.users, attempt.student)}</strong>
                  <span>
                    Attempt {attempt.attempt_number} - Score:{' '}
                    {displayScore(attempt.score)}
                  </span>
                  <small>{formatDateTime(attempt.started_at)}</small>
                </div>
              </div>
            ))}
            {!data.attempts.length ? (
              <p className="admin-empty-line">No assessment attempts yet.</p>
            ) : null}
          </div>
        </div>
      </section>

      <section className="content-grid">
        <div className="section-block">
          <SectionHeading
            subtitle={`${data.moduleAccess.filter((grant) => grant.is_available).length} active grants`}
            title="Module Access"
          />
          <div className="admin-feed">
            {data.moduleAccess.slice(0, 8).map((grant) => (
              <div className="admin-feed__item" key={grant.id}>
                <span className="timeline-dot">
                  <Icon name="shield" />
                </span>
                <div>
                  <strong>{grant.student_name}</strong>
                  <span>
                    {moduleName(data.modules, grant.module)} - {grant.payment_status}
                  </span>
                  <small>{grant.is_available ? 'Available' : 'Inactive'}</small>
                </div>
              </div>
            ))}
            {!data.moduleAccess.length ? (
              <p className="admin-empty-line">No module grants yet.</p>
            ) : null}
          </div>
        </div>

        <div className="section-block">
          <SectionHeading
            subtitle={`${attendanceToday.length} session${attendanceToday.length === 1 ? '' : 's'} today`}
            title="Attendance"
          />
          <div className="admin-feed">
            {data.attendanceSessions.slice(0, 8).map((session) => (
              <div className="admin-feed__item" key={session.id}>
                <span className="timeline-dot">
                  <Icon name="calendar" />
                </span>
                <div>
                  <strong>{subjectName(data.subjects, session.subject)}</strong>
                  <span>{session.title || 'Class meeting'}</span>
                  <small>
                    {session.date} - {numeric(session.points_possible)} pts
                  </small>
                </div>
              </div>
            ))}
            {!data.attendanceSessions.length ? (
              <p className="admin-empty-line">No attendance sessions yet.</p>
            ) : null}
          </div>
        </div>
      </section>
    </Page>
  )
}

function AdminQuickLink({
  detail,
  icon,
  label,
  to,
}: {
  detail: string
  icon: 'calendar' | 'code' | 'grade' | 'shield'
  label: string
  to: string
}) {
  return (
    <Link className="admin-quick-link" to={to}>
      <span className="stat-card__icon">
        <Icon name={icon} />
      </span>
      <span>
        <strong>{label}</strong>
        <small>{detail}</small>
      </span>
    </Link>
  )
}
