import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import type { AuthedRequest, RouteData } from '../../app/types'
import { Icon } from '../../components/Icon'
import { EmptyState, Page, PageHeader } from '../../components/ui'
import type {
  ModuleTeacherSummary,
  ModuleTeacherSummaryAccessStatus,
  ModuleTeacherSummaryStudent,
} from '../../types'
import { formatDateTime, toErrorMessage } from '../../utils/format'

const PAGE_SIZE = 30

export function ModuleProgressPage({
  api,
  data,
}: {
  api: AuthedRequest
  data: RouteData
}) {
  const { moduleId } = useParams()
  const [searchParams] = useSearchParams()
  const module = data.modules.find((item) => item.id === Number(moduleId)) ?? null
  const scheduleId = Number(searchParams.get('schedule')) || null
  const returnTo = safeReturnPath(searchParams.get('returnTo'))
  const schedule = scheduleId
    ? data.schedules.find((item) => item.id === scheduleId) ?? null
    : null
  const [summary, setSummary] = useState<ModuleTeacherSummary | null>(null)
  const [query, setQuery] = useState('')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!module) {
      return
    }

    let ignore = false
    queueMicrotask(() => {
      if (ignore) return
      setLoading(true)
      setMessage('')
      setSummary(null)
    })
    api<ModuleTeacherSummary>(`/modules/modules/${module.id}/teacher-summary/`)
      .then((payload) => {
        if (!ignore) setSummary(payload)
      })
      .catch((caughtError) => {
        if (!ignore) setMessage(toErrorMessage(caughtError))
      })
      .finally(() => {
        if (!ignore) setLoading(false)
      })
    return () => {
      ignore = true
    }
  }, [api, module])

  useEffect(() => {
    queueMicrotask(() => setVisibleCount(PAGE_SIZE))
  }, [query, scheduleId, module?.id])

  const students = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return (summary?.students ?? [])
      .filter((student) => !scheduleId || student.schedule_id === scheduleId)
      .filter((student) => student.access_status !== 'LOCKED')
      .filter((student) => {
        if (!normalizedQuery) return true
        return [
          student.student_name,
          student.username,
          student.email,
          student.schedule_display,
        ].join(' ').toLowerCase().includes(normalizedQuery)
      })
      .sort(compareByAvailedDate)
  }, [query, scheduleId, summary])
  const visibleStudents = students.slice(0, visibleCount)
  const hasMore = visibleCount < students.length

  if (!module) {
    return (
      <Page>
        <EmptyState
          icon="module"
          title="Module not found"
          message="Choose another module to view progress."
        />
      </Page>
    )
  }

  return (
    <Page>
      <PageHeader
        eyebrow={schedule ? `${schedule.subject_code} ${schedule.section}` : 'Module progress'}
        title={module.title}
        description="Review students who availed this module, newest access first."
        actions={
          <Link className="button button--secondary" to={returnTo}>
            <Icon name="arrow-left" />
            <span>Back</span>
          </Link>
        }
      />

      <section className="section-block module-progress-page">
        <div className="module-progress-toolbar">
          <div className="module-teacher-stats">
            <SummaryMetric label="Students" value={students.length} />
            <SummaryMetric label="Active" value={students.filter((student) => student.access_status === 'ACTIVE').length} />
            <SummaryMetric label="Completed" value={students.filter(isComplete).length} />
            <SummaryMetric label="Ungraded" value={students.reduce((sum, student) => sum + student.activity_submissions.ungraded_count, 0)} />
          </div>
          <label className="admin-search module-progress-search">
            <Icon name="search" />
            <input
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search student, username, email, or section"
              type="search"
              value={query}
            />
          </label>
        </div>

        {message ? <p className="admin-message">{message}</p> : null}

        <div
          className="module-progress-scroll module-progress-scroll--page"
          onScroll={(event) => {
            const target = event.currentTarget
            if (target.scrollTop + target.clientHeight >= target.scrollHeight - 48 && hasMore) {
              setVisibleCount((current) => current + PAGE_SIZE)
            }
          }}
        >
          <table className="admin-table module-teacher-table">
            <thead>
              <tr>
                <th>Student</th>
                <th>Availed</th>
                <th>Access</th>
                <th>Lesson progress</th>
                <th>Last viewed</th>
                <th>Activities</th>
              </tr>
            </thead>
            <tbody>
              {visibleStudents.map((student) => (
                <ModuleProgressRow key={student.student_id} student={student} />
              ))}
              {loading ? (
                <tr>
                  <td colSpan={6}>Loading module progress...</td>
                </tr>
              ) : null}
              {!loading && !students.length ? (
                <tr>
                  <td colSpan={6}>No availed students found for this view.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
          {hasMore ? (
            <button
              className="button button--secondary module-progress-load-more"
              onClick={() => setVisibleCount((current) => current + PAGE_SIZE)}
              type="button"
            >
              <Icon name="arrow-right" />
              <span>Load more</span>
            </button>
          ) : null}
        </div>
      </section>
    </Page>
  )
}

function ModuleProgressRow({ student }: { student: ModuleTeacherSummaryStudent }) {
  const progress = student.lesson_progress
  const submissions = student.activity_submissions

  return (
    <tr>
      <td>
        <strong>{student.student_name}</strong>
        <span className="admin-table-muted">
          {student.schedule_display || student.username}
          {!student.is_enrolled ? ' - advance access' : ''}
        </span>
      </td>
      <td>{student.access_activated_at ? formatDateTime(student.access_activated_at) : '-'}</td>
      <td>
        <span className={`module-access-pill module-access-pill--${student.access_status.toLowerCase()}`}>
          {accessStatusLabel(student.access_status)}
        </span>
        {student.access_expires_at ? (
          <small className="admin-table-muted">Until {formatDateTime(student.access_expires_at)}</small>
        ) : null}
      </td>
      <td>
        <strong>{progress.percent_complete}%</strong>
        <span className="admin-table-muted">
          {progress.completed_count}/{progress.total_count} lessons complete
        </span>
      </td>
      <td>
        <span>{progress.last_viewed_lesson || '-'}</span>
        {progress.last_viewed_at ? (
          <small className="admin-table-muted">{formatDateTime(progress.last_viewed_at)}</small>
        ) : null}
      </td>
      <td>
        <strong>
          {submissions.submitted_count}/{submissions.total_count} submitted
        </strong>
        <span className="admin-table-muted">
          {submissions.pending_count} pending - {submissions.ungraded_count} ungraded
        </span>
      </td>
    </tr>
  )
}

function SummaryMetric({ label, value }: { label: string; value: number }) {
  return (
    <span>
      <strong>{value}</strong>
      {label}
    </span>
  )
}

function compareByAvailedDate(
  first: ModuleTeacherSummaryStudent,
  second: ModuleTeacherSummaryStudent,
) {
  return dateValue(second.access_activated_at) - dateValue(first.access_activated_at)
}

function dateValue(value: string | null) {
  return value ? new Date(value).getTime() : 0
}

function isComplete(student: ModuleTeacherSummaryStudent) {
  const progress = student.lesson_progress
  return Boolean(progress.total_count && progress.completed_count >= progress.total_count)
}

function accessStatusLabel(status: ModuleTeacherSummaryAccessStatus) {
  const labels: Record<ModuleTeacherSummaryAccessStatus, string> = {
    ACTIVE: 'Active',
    EXPIRED: 'Expired',
    LOCKED: 'Locked',
    REVOKED: 'Revoked',
  }
  return labels[status]
}

function safeReturnPath(value: string | null) {
  if (!value || !value.startsWith('/admin')) {
    return '/admin/modules'
  }
  return value
}
