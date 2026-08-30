import { useEffect, useState } from 'react'
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
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [students, setStudents] = useState<ModuleTeacherSummaryStudent[]>([])
  const [nextOffset, setNextOffset] = useState<number | null>(null)
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
    const params = new URLSearchParams({
      access_status: 'AVAILED',
      limit: String(PAGE_SIZE),
      offset: '0',
    })
    if (scheduleId) params.set('schedule', String(scheduleId))
    if (debouncedQuery) params.set('search', debouncedQuery)
    api<ModuleTeacherSummary>(`/modules/modules/${module.id}/teacher-summary/?${params.toString()}`)
      .then((payload) => {
        if (!ignore) {
          setSummary(payload)
          setStudents(payload.students)
          setNextOffset(payload.next)
        }
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
  }, [api, debouncedQuery, module, scheduleId])

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 250)
    return () => window.clearTimeout(timer)
  }, [query])

  const hasMore = nextOffset !== null

  async function loadMore() {
    if (!module || nextOffset === null || loading) return
    setLoading(true)
    setMessage('')
    try {
      const params = new URLSearchParams({
        access_status: 'AVAILED',
        limit: String(PAGE_SIZE),
        offset: String(nextOffset),
      })
      if (scheduleId) params.set('schedule', String(scheduleId))
      if (debouncedQuery) params.set('search', debouncedQuery)
      const payload = await api<ModuleTeacherSummary>(
        `/modules/modules/${module.id}/teacher-summary/?${params.toString()}`,
      )
      setStudents((current) => [...current, ...payload.students])
      setNextOffset(payload.next)
    } catch (caughtError) {
      setMessage(toErrorMessage(caughtError))
    } finally {
      setLoading(false)
    }
  }

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
            <SummaryMetric label="Students" value={summary?.total_students ?? 0} />
            <SummaryMetric label="Active" value={summary?.active_access_count ?? 0} />
            <SummaryMetric label="Completed" value={summary?.completed_count ?? 0} />
            <SummaryMetric label="Ungraded" value={summary?.ungraded_submission_count ?? 0} />
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
              void loadMore()
            }
          }}
        >
          <table className="admin-table module-teacher-table mobile-card-table">
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
              {students.map((student) => (
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
              onClick={() => void loadMore()}
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
      <td data-label="Student">
        <strong>{student.student_name}</strong>
        <span className="admin-table-muted">
          {student.schedule_display || student.username}
          {!student.is_enrolled ? ' - advance access' : ''}
        </span>
      </td>
      <td data-label="Availed">{student.access_activated_at ? formatDateTime(student.access_activated_at) : '-'}</td>
      <td data-label="Access">
        <span className={`module-access-pill module-access-pill--${student.access_status.toLowerCase()}`}>
          {accessStatusLabel(student.access_status)}
        </span>
        {student.access_expires_at ? (
          <small className="admin-table-muted">Until {formatDateTime(student.access_expires_at)}</small>
        ) : null}
      </td>
      <td data-label="Lesson progress">
        <strong>{progress.percent_complete}%</strong>
        <span className="admin-table-muted">
          {progress.completed_count}/{progress.total_count} lessons complete
        </span>
      </td>
      <td data-label="Last viewed">
        <span>{progress.last_viewed_lesson || '-'}</span>
        {progress.last_viewed_at ? (
          <small className="admin-table-muted">{formatDateTime(progress.last_viewed_at)}</small>
        ) : null}
      </td>
      <td data-label="Activities">
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
