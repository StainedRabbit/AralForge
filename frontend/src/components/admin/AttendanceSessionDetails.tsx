import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
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
    <AttendanceLetterIndex students={filteredStudents} />
    <div className="table-wrap attendance-student-browser__table">
      <table className="admin-table attendance-breakdown__table mobile-card-table">
        <thead><tr><th>Student</th><th>Status</th><th>Points</th><th>Remarks</th><th>Edit</th></tr></thead>
        <tbody>{filteredStudents.map((student) => {
          const record = recordsByStudent.get(student.id)
          return <tr data-attendance-student={student.id} data-attendance-letter={studentLetter(student)} key={student.id}>
            <td data-label="Student">{studentDisplayName(student)}</td>
            <td data-label="Status"><span className={`attendance-status attendance-status--${(record?.status ?? 'unmarked').toLowerCase()}`}>{record?.status ?? 'UNMARKED'}</span></td>
            <td data-label="Points">{record ? numeric(record.points_earned) : 0}</td>
            <td data-label="Remarks"><input className="attendance-remarks-input" defaultValue={record?.remarks ?? ''} disabled={!record || savingStudentId === student.id} onBlur={(event) => void updateRemarks(record, event.target.value)} placeholder={record ? 'Add remarks' : 'Set status first'} type="text" /></td>
            <td data-label="Edit"><select className="attendance-status-select" disabled={savingStudentId === student.id} onChange={(event) => updateStatus(student, event.target.value as AttendanceStatus | '')} value={record?.status ?? ''}>
              <option value="">Set status</option><option value="PRESENT">Present</option><option value="LATE">Late</option><option value="ABSENT">Absent</option><option value="EXCUSED">Excused</option>
            </select></td>
          </tr>
        })}</tbody>
      </table>
    </div>
    </div> : <p className="attendance-student-search__empty">No students match “{studentQuery.trim()}”.</p>}
  </>
}

const LETTERS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '#']

function AttendanceLetterIndex({ students }: { students: User[] }) {
  const railRef = useRef<HTMLElement>(null)
  const hideTimer = useRef<number | undefined>(undefined)
  const dragging = useRef(false)
  const lastPointerLetter = useRef<string | null>(null)
  const [active, setActive] = useState<string | null>(null)
  const [visible, setVisible] = useState(true)
  const [bounds, setBounds] = useState({ top: 0, right: 0, height: 0 })
  const studentIds = students.map((student) => student.id).join(',')

  const showBriefly = useCallback(() => {
    setVisible(true)
    window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => {
      if (!dragging.current && !railRef.current?.matches(':hover, :focus-within')) setVisible(false)
    }, 1400)
  }, [])

  const measure = useCallback(() => {
    const table = railRef.current?.parentElement?.querySelector<HTMLElement>('.attendance-student-browser__table')
    if (!table) return
    const rect = table.getBoundingClientRect()
    let top = Math.max(0, rect.top)
    let bottom = Math.min(window.innerHeight, rect.bottom)
    let right = Math.min(window.innerWidth, rect.right)
    for (let parent = table.parentElement; parent; parent = parent.parentElement) {
      if (!/(auto|scroll|hidden)/.test(getComputedStyle(parent).overflowY)) continue
      const clip = parent.getBoundingClientRect()
      top = Math.max(top, clip.top)
      bottom = Math.min(bottom, clip.bottom)
      right = Math.min(right, clip.right)
    }
    if (!dragging.current) setBounds({ top, right: Math.max(0, window.innerWidth - right), height: Math.max(0, bottom - top) })
    const first = [...table.querySelectorAll<HTMLElement>('tr[data-attendance-letter]')]
      .find((row) => row.getBoundingClientRect().bottom > top && row.getBoundingClientRect().top < bottom)
    if (first && !dragging.current) setActive(first.dataset.attendanceLetter ?? null)
  }, [])

  useEffect(() => {
    const table = railRef.current?.parentElement?.querySelector<HTMLElement>('.attendance-student-browser__table')
    if (!table) return
    const onScroll = () => { measure(); showBriefly() }
    measure()
    showBriefly()
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', measure)
    const observer = new ResizeObserver(measure)
    observer.observe(table)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', measure)
      observer.disconnect()
      window.clearTimeout(hideTimer.current)
    }
  }, [measure, showBriefly, studentIds])

  function jump(requested: string) {
    const start = LETTERS.indexOf(requested)
    const next = [requested, ...LETTERS.slice(start + 1), ...LETTERS.slice(0, start)]
      .find((letter) => students.some((student) => studentLetter(student) === letter))
    const student = students.find((item) => studentLetter(item) === next)
    if (!student) return
    setActive(next ?? null)
    showBriefly()
    railRef.current?.parentElement?.querySelector<HTMLElement>(`[data-attendance-student="${student.id}"]`)
      ?.scrollIntoView({ block: 'start', behavior: 'auto' })
  }

  function selectAtPointer(event: PointerEvent<HTMLElement>) {
    const rect = railRef.current?.getBoundingClientRect()
    if (!rect?.height) return
    const index = Math.min(LETTERS.length - 1, Math.max(0, Math.floor((event.clientY - rect.top) / rect.height * LETTERS.length)))
    const letter = LETTERS[index]
    if (lastPointerLetter.current === letter) return
    lastPointerLetter.current = letter
    jump(letter)
  }

  return <nav ref={railRef} aria-label="Jump to students by last name"
    className={`attendance-letter-rail${visible ? ' attendance-letter-rail--visible' : ''}`}
    style={{ top: bounds.top, right: bounds.right, height: bounds.height }}
    onPointerEnter={showBriefly}
    onPointerDown={(event) => { dragging.current = true; lastPointerLetter.current = null; event.currentTarget.setPointerCapture(event.pointerId); selectAtPointer(event) }}
    onPointerMove={(event) => { if (dragging.current) selectAtPointer(event) }}
    onPointerUp={() => { dragging.current = false; lastPointerLetter.current = null; measure(); if (railRef.current?.contains(document.activeElement)) (document.activeElement as HTMLElement).blur(); showBriefly() }}
    onPointerCancel={() => { dragging.current = false; lastPointerLetter.current = null; measure(); showBriefly() }}>
    {LETTERS.map((letter) => <button key={letter} type="button"
      aria-label={`Jump to ${letter === '#' ? 'other' : letter} last names`}
      aria-current={active === letter ? 'true' : undefined}
      className={active === letter ? 'is-active' : ''}
      onClick={(event) => { if (event.detail === 0) jump(letter) }}>{letter}</button>)}
  </nav>
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
