import { useState } from 'react'
import type { AuthedRequest, RouteData } from '../../app/types'
import type { AttendanceRecord, AttendanceSession, User } from '../../types'
import { numeric, percent, toErrorMessage } from '../../utils/format'
import { studentDisplayName, summarizeAttendance } from './attendanceHelpers'

type AttendanceStatus = AttendanceRecord['status']

export function AttendanceSessionDetails({ api, data, refresh, session }: {
  api: AuthedRequest
  data: RouteData
  refresh: () => Promise<void>
  session: AttendanceSession
}) {
  const [savingStudentId, setSavingStudentId] = useState<number | null>(null)
  const [message, setMessage] = useState('')
  const records = data.attendanceRecords.filter((record) => record.session === session.id)
  const recordsByStudent = new Map(records.map((record) => [record.student, record]))
  const students = historyStudents(data, session, records)
  const summary = summarizeAttendance(records)

  async function updateStatus(student: User, status: AttendanceStatus) {
    const record = recordsByStudent.get(student.id)
    setSavingStudentId(student.id)
    setMessage('')
    try {
      await api(record ? `/attendance/records/${record.id}/` : '/attendance/records/', {
        body: JSON.stringify({
          points_earned: pointsForStatus(status, numeric(session.points_possible)),
          remarks: record?.remarks ?? '',
          session: session.id,
          status,
          student: student.id,
        }),
        method: record ? 'PATCH' : 'POST',
      })
      setMessage('Attendance status updated.')
      await refresh()
    } catch (caughtError) {
      setMessage(toErrorMessage(caughtError))
    } finally {
      setSavingStudentId(null)
    }
  }

  async function updateRemarks(record: AttendanceRecord | undefined, remarks: string) {
    if (!record || record.remarks === remarks) return
    setSavingStudentId(record.student)
    setMessage('')
    try {
      await api(`/attendance/records/${record.id}/`, {
        body: JSON.stringify({ remarks }),
        method: 'PATCH',
      })
      setMessage('Remarks updated.')
      await refresh()
    } catch (caughtError) {
      setMessage(toErrorMessage(caughtError))
    } finally {
      setSavingStudentId(null)
    }
  }

  return <>
    <div className="attendance-breakdown__stats">
      <AttendanceStat label="Present" value={summary.present} />
      <AttendanceStat label="Late" value={summary.late} />
      <AttendanceStat label="Absent" value={summary.absent} />
      <AttendanceStat label="Excused" value={summary.excused} />
      <AttendanceStat label="Rate" value={`${percent(summary.attended, records.length)}%`} />
    </div>
    {message ? <p className="admin-message">{message}</p> : null}
    <div className="table-wrap">
      <table className="admin-table attendance-breakdown__table">
        <thead><tr><th>Student</th><th>Status</th><th>Points</th><th>Remarks</th><th>Edit</th></tr></thead>
        <tbody>{students.map((student) => {
          const record = recordsByStudent.get(student.id)
          return <tr key={student.id}>
            <td>{studentDisplayName(student)}</td>
            <td><span className={`attendance-status attendance-status--${(record?.status ?? 'unmarked').toLowerCase()}`}>{record?.status ?? 'UNMARKED'}</span></td>
            <td>{record ? numeric(record.points_earned) : 0}</td>
            <td><input className="attendance-remarks-input" defaultValue={record?.remarks ?? ''} disabled={!record || savingStudentId === student.id} onBlur={(event) => void updateRemarks(record, event.target.value)} placeholder={record ? 'Add remarks' : 'Set status first'} type="text" /></td>
            <td><select className="attendance-status-select" disabled={savingStudentId === student.id} onChange={(event) => void updateStatus(student, event.target.value as AttendanceStatus)} value={record?.status ?? ''}>
              <option value="">Set status</option><option value="PRESENT">Present</option><option value="LATE">Late</option><option value="ABSENT">Absent</option><option value="EXCUSED">Excused</option>
            </select></td>
          </tr>
        })}</tbody>
      </table>
    </div>
  </>
}

function AttendanceStat({ label, value }: { label: string; value: number | string }) {
  return <div className="attendance-breakdown__stat"><strong>{value}</strong><span>{label}</span></div>
}

function historyStudents(data: RouteData, session: AttendanceSession, records: AttendanceRecord[]) {
  const studentIds = new Set(records.map((record) => record.student))
  if (session.schedule) {
    data.enrollments
      .filter((item) => item.schedule === session.schedule && item.is_active)
      .forEach((item) => studentIds.add(item.student))
  }
  return data.users
    .filter((user) => studentIds.has(user.id))
    .sort((first, second) => studentDisplayName(first).localeCompare(studentDisplayName(second), undefined, { sensitivity: 'base' }))
}

function pointsForStatus(status: AttendanceStatus, possible: number) {
  if (status === 'PRESENT' || status === 'EXCUSED') return possible.toFixed(2)
  if (status === 'LATE') return (possible / 2).toFixed(2)
  return '0.00'
}
