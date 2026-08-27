import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { AuthedRequest, RouteData } from '../../app/types'
import { Icon } from '../../components/Icon'
import { AttendanceSessionDetails } from '../../components/admin/AttendanceSessionDetails'
import { studentDisplayName, summarizeAttendance } from '../../components/admin/attendanceHelpers'
import { Page, PageHeader, SectionHeading } from '../../components/ui'
import type { AttendanceSession, SubjectSchedule } from '../../types'
import { formatDate, percent } from '../../utils/format'

export function AdminAttendancePage({ api, data, refresh }: {
  api: AuthedRequest
  data: RouteData
  refresh: () => Promise<void>
}) {
  const [searchParams] = useSearchParams()
  const activeTerm = data.terms.find((term) => term.is_active) ?? data.terms[0]
  const requestedSchedule = data.schedules.find(
    (schedule) => schedule.id === Number(searchParams.get('schedule')),
  )
  const [termId, setTermId] = useState(
    requestedSchedule?.school_year_semester.toString() ?? activeTerm?.id.toString() ?? '',
  )
  const [scheduleId, setScheduleId] = useState(
    requestedSchedule?.id.toString() ?? '',
  )
  const [query, setQuery] = useState('')
  const requestedSessionId = Number(searchParams.get('session'))
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(
    data.attendanceSessions.some((session) => session.id === requestedSessionId)
      ? requestedSessionId
      : null,
  )
  const schedules = data.schedules.filter(
    (schedule) => !termId || schedule.school_year_semester === Number(termId),
  )
  const sessions = useMemo(
    () => filterSessions(data, termId, scheduleId, query),
    [data, query, scheduleId, termId],
  )
  const selectedSession =
    data.attendanceSessions.find((session) => session.id === selectedSessionId) ?? null

  return (
    <Page>
      <PageHeader
        eyebrow="Attendance archive"
        title="Attendance"
        description="Review, correct, and export attendance history. Start new attendance from the selected class roster."
      />

      <section className="section-block">
        <SectionHeading
          action={
            <button className="button button--secondary" disabled={!sessions.length} onClick={() => exportAttendance(data, sessions)} type="button">
              <Icon name="file" />
              <span>Export CSV</span>
            </button>
          }
          subtitle={`${sessions.length} session${sessions.length === 1 ? '' : 's'}`}
          title="Attendance History"
        />

        <div className="attendance-history-filters">
          <label className="admin-field">
            <span>School-year semester</span>
            <select onChange={(event) => { setTermId(event.target.value); setScheduleId('') }} value={termId}>
              <option value="">All terms</option>
              {data.terms.map((term) => <option key={term.id} value={term.id}>{term.name}</option>)}
            </select>
          </label>
          <label className="admin-field">
            <span>Class</span>
            <select onChange={(event) => setScheduleId(event.target.value)} value={scheduleId}>
              <option value="">All classes and legacy sessions</option>
              {schedules.map((schedule) => <option key={schedule.id} value={schedule.id}>{classLabel(schedule)}</option>)}
            </select>
          </label>
          <label className="admin-field">
            <span>Search history</span>
            <input onChange={(event) => setQuery(event.target.value)} placeholder="Class, section, or session title" type="search" value={query} />
          </label>
        </div>

        <div className="table-wrap">
          <table className="admin-table">
            <thead><tr><th>Date</th><th>Class</th><th>Session</th><th>Present</th><th>Late</th><th>Absent</th><th>Rate</th><th>Details</th></tr></thead>
            <tbody>
              {sessions.map((session) => {
                const records = data.attendanceRecords.filter((record) => record.session === session.id)
                const summary = summarizeAttendance(records)
                return <tr key={session.id}>
                  <td>{formatDate(session.date)}</td>
                  <td>{sessionClassLabel(data, session)}</td>
                  <td>{session.title || 'Class meeting'}</td>
                  <td>{summary.present}</td><td>{summary.late}</td><td>{summary.absent}</td>
                  <td>{percent(summary.attended, records.length)}%</td>
                  <td><button className="button button--secondary button--compact" onClick={() => setSelectedSessionId(session.id)} type="button"><Icon name="search" /><span>View</span></button></td>
                </tr>
              })}
              {!sessions.length ? <tr><td colSpan={8}>No attendance sessions match these filters.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      {selectedSession ? <AttendanceHistoryDialog api={api} data={data} onClose={() => setSelectedSessionId(null)} refresh={refresh} session={selectedSession} /> : null}
    </Page>
  )
}

function AttendanceHistoryDialog({ api, data, onClose, refresh, session }: {
  api: AuthedRequest
  data: RouteData
  onClose: () => void
  refresh: () => Promise<void>
  session: AttendanceSession
}) {
  return (
    <div aria-labelledby="attendance-history-title" aria-modal="true" className="attendance-modal" role="dialog">
      <div className="attendance-modal__backdrop" onClick={onClose} />
      <div className="attendance-modal__panel attendance-modal__panel--wide">
        <div className="attendance-modal__header">
          <div><strong id="attendance-history-title">{session.title || 'Class meeting'}</strong><span>{sessionClassLabel(data, session)} · {formatDate(session.date)}</span></div>
          <button className="icon-button" onClick={onClose} title="Close" type="button"><Icon name="close" /></button>
        </div>
        <AttendanceSessionDetails api={api} data={data} refresh={refresh} session={session} />
      </div>
    </div>
  )
}

function filterSessions(data: RouteData, termId: string, scheduleId: string, query: string) {
  const normalized = query.trim().toLowerCase()
  return data.attendanceSessions.filter((session) => {
    const schedule = session.schedule ? data.schedules.find((item) => item.id === session.schedule) : null
    const sessionTermId = schedule?.school_year_semester ?? session.school_year_semester
    if (termId && sessionTermId !== Number(termId)) return false
    if (scheduleId && session.schedule !== Number(scheduleId)) return false
    if (!normalized) return true
    return `${sessionClassLabel(data, session)} ${session.title}`.toLowerCase().includes(normalized)
  }).sort((first, second) => second.date.localeCompare(first.date) || second.id - first.id)
}

function sessionClassLabel(data: RouteData, session: AttendanceSession) {
  const schedule = session.schedule ? data.schedules.find((item) => item.id === session.schedule) : null
  if (schedule) return classLabel(schedule)
  const subject = data.subjects.find((item) => item.id === session.subject)
  return `${subject?.code ?? 'Unknown subject'} · Legacy/unassigned`
}

function classLabel(schedule: SubjectSchedule) {
  return [schedule.subject_code, schedule.section || 'No section', schedule.days].join(' · ')
}

function exportAttendance(data: RouteData, sessions: AttendanceSession[]) {
  const rows = [['Date', 'Class', 'Session', 'Student', 'Status', 'Points earned', 'Remarks']]
  sessions.forEach((session) => {
    data.attendanceRecords.filter((record) => record.session === session.id).forEach((record) => {
      const student = data.users.find((user) => user.id === record.student)
      rows.push([session.date, sessionClassLabel(data, session), session.title || 'Class meeting', student ? studentDisplayName(student) : 'Unknown student', record.status, record.points_earned, record.remarks])
    })
  })
  const blob = new Blob([rows.map((row) => row.map(escapeCsv).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'attendance-history.csv'
  link.click()
  window.URL.revokeObjectURL(url)
}

function escapeCsv(value: string) {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}
