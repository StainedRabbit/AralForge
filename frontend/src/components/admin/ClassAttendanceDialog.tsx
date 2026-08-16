import { useMemo, useState } from 'react'
import type { AuthedRequest, RouteData } from '../../app/types'
import type { AttendanceRecord, AttendanceSession, SubjectSchedule, User } from '../../types'
import { formatDate, numeric, percent, toErrorMessage } from '../../utils/format'
import { fullName } from '../../utils/student'
import { Icon } from '../Icon'
import { AttendanceSessionDetails } from './AttendanceSessionDetails'
import { summarizeAttendance } from './attendanceHelpers'

type AttendanceStatus = AttendanceRecord['status']
type AttendanceDraft = { remarks: string; status: AttendanceStatus | '' }
export type AttendanceDialogTab = 'history' | 'take'

export function ClassAttendanceDialog({ api, data, initialTab, onClose, refresh, schedule }: {
  api: AuthedRequest
  data: RouteData
  initialTab: AttendanceDialogTab
  onClose: () => void
  refresh: () => Promise<void>
  schedule: SubjectSchedule
}) {
  const [tab, setTab] = useState<AttendanceDialogTab>(initialTab)
  const [sessionDate, setSessionDate] = useState(todayInputValue)
  const [sessionTitle, setSessionTitle] = useState('Class attendance')
  const [pointsPossible, setPointsPossible] = useState('1.00')
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null)
  const [drafts, setDrafts] = useState<Record<number, AttendanceDraft>>({})
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const students = useMemo(() => getScheduleStudents(data, schedule.id), [data, schedule.id])
  const matchingSession = data.attendanceSessions.find((session) =>
    session.schedule === schedule.id && session.date === sessionDate && session.title === sessionTitle)
  const activeSession = data.attendanceSessions.find((session) => session.id === activeSessionId) ??
    (matchingSession?.id === activeSessionId ? matchingSession : null)

  async function startAttendance() {
    if (!students.length) {
      setMessage('Add at least one active student before starting attendance.')
      return
    }
    setSaving(true)
    setMessage('')
    try {
      const session = matchingSession ?? await api<AttendanceSession>('/attendance/sessions/', {
        body: JSON.stringify({ date: sessionDate, notes: '', points_possible: pointsPossible, schedule: schedule.id, title: sessionTitle }),
        method: 'POST',
      })
      const records = data.attendanceRecords.filter((record) => record.session === session.id)
      const recordsByStudent = new Map(records.map((record) => [record.student, record]))
      setDrafts(Object.fromEntries(students.map((student) => {
        const record = recordsByStudent.get(student.id)
        return [student.id, { remarks: record?.remarks ?? '', status: record?.status ?? '' }]
      })))
      setActiveSessionId(session.id)
      setPointsPossible(session.points_possible)
      setMessage(matchingSession ? 'Existing session loaded.' : 'Attendance session started.')
      await refresh()
    } catch (caughtError) {
      setMessage(toErrorMessage(caughtError))
    } finally {
      setSaving(false)
    }
  }

  async function saveAttendance() {
    if (!activeSession) return
    const unmarkedCount = students.filter((student) => !drafts[student.id]?.status).length
    if (unmarkedCount) {
      setMessage(`Mark all students before saving. ${unmarkedCount} still unmarked.`)
      return
    }
    setSaving(true)
    setMessage('')
    try {
      await api(`/attendance/sessions/${activeSession.id}/roster/`, {
        body: JSON.stringify({ records: students.map((student) => ({
          remarks: drafts[student.id]?.remarks ?? '',
          status: drafts[student.id]?.status,
          student: student.id,
        })) }),
        method: 'PUT',
      })
      setMessage('Attendance saved.')
      await refresh()
    } catch (caughtError) {
      setMessage(toErrorMessage(caughtError))
    } finally {
      setSaving(false)
    }
  }

  function updateDraft(studentId: number, changes: Partial<AttendanceDraft>) {
    setDrafts((current) => ({ ...current, [studentId]: {
      remarks: current[studentId]?.remarks ?? '',
      status: current[studentId]?.status ?? '',
      ...changes,
    } }))
  }

  const markedCount = students.filter((student) => drafts[student.id]?.status).length

  return (
    <div aria-labelledby="class-attendance-title" aria-modal="true" className="attendance-modal" role="dialog">
      <div className="attendance-modal__backdrop" onClick={onClose} />
      <div className="attendance-modal__panel attendance-modal__panel--wide class-attendance-dialog">
        <div className="attendance-modal__header">
          <div>
            <strong id="class-attendance-title">Class attendance</strong>
            <span>{schedule.subject_code} {schedule.section || 'No section'} - {schedule.term_name}</span>
          </div>
          <button className="icon-button" disabled={saving} onClick={onClose} title="Close" type="button"><Icon name="close" /></button>
        </div>

        <div aria-label="Attendance views" className="class-attendance-dialog__tabs" role="tablist">
          <button aria-selected={tab === 'take'} className={tab === 'take' ? 'active' : ''} disabled={saving} onClick={() => setTab('take')} role="tab" type="button">Take attendance</button>
          <button aria-selected={tab === 'history'} className={tab === 'history' ? 'active' : ''} disabled={saving} onClick={() => setTab('history')} role="tab" type="button">History</button>
        </div>

        {tab === 'take' ? <>
          <div className="attendance-session-form class-attendance-dialog__setup">
            <label className="admin-field"><span>Date</span><input disabled={Boolean(activeSessionId)} onChange={(event) => setSessionDate(event.target.value)} type="date" value={sessionDate} /></label>
            <label className="admin-field"><span>Title</span><input disabled={Boolean(activeSessionId)} onChange={(event) => setSessionTitle(event.target.value)} type="text" value={sessionTitle} /></label>
            <label className="admin-field"><span>Points possible</span><input disabled={Boolean(activeSessionId)} min="0" onChange={(event) => setPointsPossible(event.target.value)} step="0.01" type="number" value={pointsPossible} /></label>
            <button className="button button--primary attendance-start-button" disabled={saving || Boolean(activeSessionId) || !sessionDate || !sessionTitle.trim()} onClick={() => void startAttendance()} type="button">
              <Icon name="check" /><span>{saving ? 'Starting...' : matchingSession ? 'Continue session' : 'Start session'}</span>
            </button>
          </div>
          {message ? <p className="admin-message">{message}</p> : null}
          {activeSessionId ? <>
            <div className="class-attendance-dialog__summary">
              <strong>{markedCount}/{students.length} marked</strong>
              <span>{formatDate(sessionDate)} - {numeric(pointsPossible)} point{numeric(pointsPossible) === 1 ? '' : 's'}</span>
            </div>
            <div className="table-wrap class-attendance-dialog__table-wrap">
              <table className="admin-table class-attendance-dialog__table">
                <thead><tr><th>Student</th><th>Status</th><th>Remarks</th></tr></thead>
                <tbody>{students.map((student) => <tr key={student.id}>
                  <td><strong>{studentDisplayName(student)}</strong></td>
                  <td><select disabled={saving} onChange={(event) => updateDraft(student.id, { status: event.target.value as AttendanceStatus | '' })} value={drafts[student.id]?.status ?? ''}>
                    <option value="">Unmarked</option><option value="PRESENT">Present</option><option value="LATE">Late</option><option value="ABSENT">Absent</option><option value="EXCUSED">Excused</option>
                  </select></td>
                  <td><input disabled={saving} onChange={(event) => updateDraft(student.id, { remarks: event.target.value })} placeholder="Optional remarks" type="text" value={drafts[student.id]?.remarks ?? ''} /></td>
                </tr>)}</tbody>
              </table>
            </div>
            <div className="class-modal-actions">
              <button className="button button--secondary" disabled={saving} onClick={onClose} type="button">Close</button>
              <button className="button button--primary" disabled={saving || markedCount !== students.length} onClick={() => void saveAttendance()} type="button"><Icon name="save" /><span>{saving ? 'Saving...' : 'Save attendance'}</span></button>
            </div>
          </> : <div className="admin-empty-line">Start or continue a session to mark this class roster.</div>}
        </> : <ClassAttendanceHistory api={api} data={data} refresh={refresh} schedule={schedule} />}
      </div>
    </div>
  )
}

function ClassAttendanceHistory({ api, data, refresh, schedule }: {
  api: AuthedRequest
  data: RouteData
  refresh: () => Promise<void>
  schedule: SubjectSchedule
}) {
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null)
  const sessions = data.attendanceSessions
    .filter((session) => session.schedule === schedule.id)
    .sort((first, second) => second.date.localeCompare(first.date) || second.id - first.id)
  const selectedSession = sessions.find((session) => session.id === selectedSessionId) ?? null

  if (selectedSession) {
    return <div className="class-attendance-history__details">
      <div className="class-attendance-history__heading">
        <button className="button button--secondary button--compact" onClick={() => setSelectedSessionId(null)} type="button"><Icon name="arrow-left" /><span>Back to history</span></button>
        <div><strong>{selectedSession.title || 'Class meeting'}</strong><span>{formatDate(selectedSession.date)}</span></div>
      </div>
      <AttendanceSessionDetails api={api} data={data} refresh={refresh} session={selectedSession} />
    </div>
  }

  return <div className="class-attendance-history">
    <div className="table-wrap">
      <table className="admin-table">
        <thead><tr><th>Date</th><th>Session</th><th>Present</th><th>Late</th><th>Absent</th><th>Rate</th><th>Details</th></tr></thead>
        <tbody>
          {sessions.map((session) => {
            const records = data.attendanceRecords.filter((record) => record.session === session.id)
            const summary = summarizeAttendance(records)
            return <tr key={session.id}>
              <td>{formatDate(session.date)}</td><td>{session.title || 'Class meeting'}</td><td>{summary.present}</td><td>{summary.late}</td><td>{summary.absent}</td><td>{percent(summary.attended, records.length)}%</td>
              <td><button className="button button--secondary button--compact" onClick={() => setSelectedSessionId(session.id)} type="button"><Icon name="search" /><span>View</span></button></td>
            </tr>
          })}
          {!sessions.length ? <tr><td colSpan={7}>No attendance history for this class yet.</td></tr> : null}
        </tbody>
      </table>
    </div>
  </div>
}

function getScheduleStudents(data: RouteData, scheduleId: number) {
  const studentIds = new Set(data.enrollments.filter((item) => item.schedule === scheduleId && item.is_active).map((item) => item.student))
  return data.users.filter((user) => user.role === 'STUDENT' && studentIds.has(user.id))
    .sort((first, second) => studentDisplayName(first).localeCompare(studentDisplayName(second), undefined, { sensitivity: 'base' }))
}

function studentDisplayName(user: User) {
  return [user.last_name, user.first_name].filter(Boolean).join(', ') || fullName(user)
}

function todayInputValue() {
  const today = new Date()
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
}
