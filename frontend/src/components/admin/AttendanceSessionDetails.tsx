import { Fragment, useRef, useState } from 'react'
import type { AuthedRequest, RouteData } from '../../app/types'
import type { AttendanceRecord, AttendanceSession, User } from '../../types'
import { numeric, percent, toErrorMessage } from '../../utils/format'
import { compareStudentsByLastName } from '../../utils/student'
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
  const [excusedStudentId, setExcusedStudentId] = useState<number | null>(null)
  const [excuseReason, setExcuseReason] = useState('')
  const [excuseError, setExcuseError] = useState('')
  const [studentQuery, setStudentQuery] = useState('')
  const [activeLetter, setActiveLetter] = useState<string | null>(null)
  const railHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const records = data.attendanceRecords.filter((record) => record.session === session.id)
  const recordsByStudent = new Map(records.map((record) => [record.student, record]))
  const students = historyStudents(data, session, records)
  const filteredStudents = (() => {
    const normalized = studentQuery.trim().toLocaleLowerCase()
    if (!normalized) return students
    return students.filter((student) => {
      const profile = data.profiles.find((item) => item.user === student.id)
      return `${student.first_name} ${student.middle_name ?? ''} ${student.last_name} ${student.display_name ?? ''} ${student.full_name ?? ''} ${profile?.student_number ?? ''}`
        .toLocaleLowerCase().includes(normalized)
    })
  })()
  const alphabetGroups = (() => {
    const groups = new Map<string, User[]>()
    filteredStudents.forEach((student) => {
      const letter = studentLetter(student)
      groups.set(letter, [...(groups.get(letter) ?? []), student])
    })
    return groups
  })()
  const alphabet = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '#']
  const summary = summarizeAttendance(records)

  async function saveStatus(student: User, status: AttendanceStatus, remarks = '') {
    const record = recordsByStudent.get(student.id)
    setSavingStudentId(student.id)
    setMessage('')
    try {
      if (session.schedule) {
        await api(`/attendance/sessions/${session.id}/mark/`, {
          body: JSON.stringify({ remarks, status, student: student.id }),
          method: 'PUT',
        })
      } else {
        await api(record ? `/attendance/records/${record.id}/` : '/attendance/records/', {
          body: JSON.stringify({ remarks, session: session.id, status, student: student.id }),
          method: record ? 'PATCH' : 'POST',
        })
      }
      setMessage('Attendance status updated.')
      setExcusedStudentId(null)
      setExcuseReason('')
      await refresh()
    } catch (caughtError) {
      setMessage(toErrorMessage(caughtError))
    } finally {
      setSavingStudentId(null)
    }
  }

  function updateStatus(student: User, status: AttendanceStatus | '') {
    if (!status) return
    const record = recordsByStudent.get(student.id)
    if (status === 'EXCUSED') {
      setExcusedStudentId(student.id)
      setExcuseReason(record?.status === 'EXCUSED' ? record.remarks : '')
      setExcuseError('')
      return
    }
    void saveStatus(student, status, record?.status === 'EXCUSED' ? '' : record?.remarks ?? '')
  }

  function confirmExcused() {
    const student = students.find((item) => item.id === excusedStudentId)
    const reason = excuseReason.trim()
    if (!student) return
    if (!reason) {
      setExcuseError('Enter an excuse reason.')
      return
    }
    void saveStatus(student, 'EXCUSED', reason)
  }

  function jumpToLetter(letter: string) {
    document.getElementById(`attendance-students-${session.id}-${letter}`)?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'start',
    })
    setActiveLetter(letter)
    if (railHideTimer.current) clearTimeout(railHideTimer.current)
    railHideTimer.current = setTimeout(() => setActiveLetter(null), 900)
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
    {excusedStudentId ? <div className="attendance-excuse-form">
      <label className="admin-field" htmlFor={`history-excuse-${excusedStudentId}`}>
        <span>Excuse reason for {studentDisplayName(students.find((student) => student.id === excusedStudentId)!)}</span>
        <textarea autoFocus id={`history-excuse-${excusedStudentId}`} onChange={(event) => { setExcuseReason(event.target.value); setExcuseError('') }} rows={3} value={excuseReason} />
      </label>
      {excuseError ? <small className="class-score-field-error">{excuseError}</small> : null}
      <div className="attendance-excuse-form__actions">
        <button className="button button--secondary" onClick={() => { setExcusedStudentId(null); setExcuseError('') }} type="button">Cancel</button>
        <button className="button button--primary" disabled={savingStudentId !== null} onClick={confirmExcused} type="button">Confirm Excused</button>
      </div>
    </div> : null}
    <label className="admin-field attendance-student-search">
      <span>Find a student</span>
      <input onChange={(event) => setStudentQuery(event.target.value)} placeholder="Search name or student number" type="search" value={studentQuery} />
    </label>
    {filteredStudents.length ? <div className="attendance-student-browser">
    <nav aria-label="Jump to students by last name" className="attendance-letter-rail" onPointerMove={(event) => {
      if (event.buttons === 0) return
      const button = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLButtonElement>('button[data-letter]')
      if (button && !button.disabled && button.dataset.letter !== activeLetter) jumpToLetter(button.dataset.letter!)
    }}>
      {alphabet.map((letter) => <button
        aria-label={`Jump to ${letter === '#' ? 'other' : letter} last names`}
        aria-pressed={activeLetter === letter}
        className={activeLetter === letter ? 'is-active' : ''}
        disabled={!alphabetGroups.has(letter)}
        data-letter={letter}
        key={letter}
        onClick={() => jumpToLetter(letter)}
        onPointerDown={() => { setActiveLetter(letter); if (railHideTimer.current) clearTimeout(railHideTimer.current) }}
        onPointerUp={() => { if (railHideTimer.current) clearTimeout(railHideTimer.current); railHideTimer.current = setTimeout(() => setActiveLetter(null), 900) }}
        type="button"
      >{letter}</button>)}
      {activeLetter ? <span aria-live="polite" className="attendance-letter-rail__label">Last names: {activeLetter === '#' ? 'Other' : activeLetter}</span> : null}
    </nav>
    <div className="table-wrap attendance-student-browser__table">
      <table className="admin-table attendance-breakdown__table mobile-card-table">
        <thead><tr><th>Student</th><th>Status</th><th>Points</th><th>Remarks</th><th>Edit</th></tr></thead>
        <tbody>{[...alphabetGroups.entries()].map(([letter, groupStudents]) => <Fragment key={letter}>
          <tr className="attendance-student-group" id={`attendance-students-${session.id}-${letter}`}><th colSpan={5} scope="rowgroup">{letter === '#' ? 'Other names' : letter}</th></tr>
          {groupStudents.map((student) => {
          const record = recordsByStudent.get(student.id)
          return <tr key={student.id}>
            <td data-label="Student">{studentDisplayName(student)}</td>
            <td data-label="Status"><span className={`attendance-status attendance-status--${(record?.status ?? 'unmarked').toLowerCase()}`}>{record?.status ?? 'UNMARKED'}</span></td>
            <td data-label="Points">{record ? numeric(record.points_earned) : 0}</td>
            <td data-label="Remarks"><input className="attendance-remarks-input" defaultValue={record?.remarks ?? ''} disabled={!record || savingStudentId === student.id} onBlur={(event) => void updateRemarks(record, event.target.value)} placeholder={record ? 'Add remarks' : 'Set status first'} type="text" /></td>
            <td data-label="Edit"><select className="attendance-status-select" disabled={savingStudentId === student.id} onChange={(event) => updateStatus(student, event.target.value as AttendanceStatus | '')} value={record?.status ?? ''}>
              <option value="">Set status</option><option value="PRESENT">Present</option><option value="LATE">Late</option><option value="ABSENT">Absent</option><option value="EXCUSED">Excused</option>
            </select></td>
          </tr>
          })}
        </Fragment>)}</tbody>
      </table>
    </div>
    </div> : <p className="attendance-student-search__empty">No students match “{studentQuery.trim()}”.</p>}
  </>
}

function AttendanceStat({ label, value }: { label: string; value: number | string }) {
  return <div className="attendance-breakdown__stat"><strong>{value}</strong><span>{label}</span></div>
}

function studentLetter(student: User) {
  const first = student.last_name.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').charAt(0).toLocaleUpperCase()
  return /^[A-Z]$/.test(first) ? first : '#'
}

function historyStudents(data: RouteData, session: AttendanceSession, records: AttendanceRecord[]) {
  const studentIds = new Set(records.map((record) => record.student))
  if (session.roster_students?.length) {
    session.roster_students.forEach((studentId) => studentIds.add(studentId))
  } else if (session.schedule) {
    data.enrollments
      .filter((item) => item.schedule === session.schedule && item.is_active)
      .forEach((item) => studentIds.add(item.student))
  }
  return data.users
    .filter((user) => studentIds.has(user.id))
    .sort(compareStudentsByLastName)
}
