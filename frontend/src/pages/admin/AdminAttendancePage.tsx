import { useMemo, useState } from 'react'
import type { AuthedRequest, WorkspaceData } from '../../app/types'
import { Icon } from '../../components/Icon'
import { Page, PageHeader, SectionHeading } from '../../components/ui'
import type {
  AttendanceRecord,
  AttendanceSession,
  SchoolYearSemester,
  Subject,
  User,
} from '../../types'
import { toOptions } from '../../admin/adminHelpers'
import {
  formatDate,
  formatTime,
  numeric,
  percent,
  toErrorMessage,
} from '../../utils/format'
import { fullName } from '../../utils/student'

type AttendanceStatus = AttendanceRecord['status']

export function AdminAttendancePage({
  api,
  data,
  refresh,
}: {
  api: AuthedRequest
  data: WorkspaceData
  refresh: () => Promise<void>
}) {
  const activeTerm = getActiveTerm(data.terms)
  const [selectedTermId, setSelectedTermId] = useState('')
  const [selectedSubjectId, setSelectedSubjectId] = useState('')
  const [subjectQuery, setSubjectQuery] = useState('')
  const effectiveTermId = selectedTermId || activeTerm?.id.toString() || ''

  const selectedTerm = data.terms.find(
    (term) => term.id === Number(effectiveTermId),
  )
  const subjectsForTerm = getSubjectsForTerm(data, selectedTerm?.id)
  const visibleSubjects = filterSubjects(subjectsForTerm, subjectQuery)
  const selectedSubject =
    data.subjects.find((subject) => subject.id === Number(selectedSubjectId)) ??
    null

  const termOptions = toOptions(data.terms, (term) => term.id, (term) => term.name)

  return (
    <Page>
      <PageHeader
        eyebrow="Attendance"
        title="Attendance"
        description="Take attendance one student at a time, sorted alphabetically by last name, with history by subject and school-year semester."
      />

      <section className="attendance-setup__grid">
        <div className="attendance-setup__panel section-block">
          <SectionHeading
            subtitle={`${visibleSubjects.length} subject${visibleSubjects.length === 1 ? '' : 's'}`}
            title="Find Subject"
          />
          <AttendanceSubjectPicker
            data={data}
            selectedSubject={selectedSubject}
            selectedTermId={effectiveTermId}
            setSelectedSubjectId={setSelectedSubjectId}
            setSelectedTermId={setSelectedTermId}
            setSubjectQuery={setSubjectQuery}
            subjectQuery={subjectQuery}
            termOptions={termOptions}
            visibleSubjects={visibleSubjects}
          />
        </div>

        <div className="attendance-setup__panel section-block">
          <SectionHeading
            subtitle={selectedTerm?.name ?? 'Select a school-year semester'}
            title="Start Attendance"
          />
          <AttendanceFlashRunner
            api={api}
            data={data}
            selectedSubject={selectedSubject}
            selectedTerm={selectedTerm ?? null}
            refresh={refresh}
          />
        </div>
      </section>

      <AttendanceHistory
        api={api}
        data={data}
        refresh={refresh}
        selectedSubject={selectedSubject}
        selectedTerm={selectedTerm ?? null}
      />
    </Page>
  )
}

function AttendanceSubjectPicker({
  data,
  selectedSubject,
  selectedTermId,
  setSelectedSubjectId,
  setSelectedTermId,
  setSubjectQuery,
  subjectQuery,
  termOptions,
  visibleSubjects,
}: {
  data: WorkspaceData
  selectedSubject: Subject | null
  selectedTermId: string
  setSelectedSubjectId: (value: string) => void
  setSelectedTermId: (value: string) => void
  setSubjectQuery: (value: string) => void
  subjectQuery: string
  termOptions: { label: string; value: number | string }[]
  visibleSubjects: Subject[]
}) {
  return (
    <div className="attendance-picker">
      <div className="admin-form__fields">
        <label className="admin-field">
          <span>School-year semester</span>
          <select
            onChange={(event) => {
              setSelectedTermId(event.target.value)
              setSelectedSubjectId('')
            }}
            value={selectedTermId}
          >
            <option value="">Select term</option>
            {termOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="admin-field">
          <span>Search subject</span>
          <input
            onChange={(event) => setSubjectQuery(event.target.value)}
            placeholder="Search code or name"
            type="search"
            value={subjectQuery}
          />
        </label>
      </div>

      <div className="attendance-subject-list">
        {visibleSubjects.map((subject) => {
          const schedules = data.schedules.filter(
            (schedule) =>
              schedule.subject === subject.id &&
              (!selectedTermId ||
                schedule.school_year_semester === Number(selectedTermId)),
          )

          return (
            <button
              className={
                selectedSubject?.id === subject.id
                  ? 'attendance-subject active'
                  : 'attendance-subject'
              }
              key={subject.id}
              onClick={() => setSelectedSubjectId(subject.id.toString())}
              type="button"
            >
              <span className="attendance-subject__top">
                <strong>{subject.code}</strong>
                <small>{formatScheduleSummary(schedules)}</small>
              </span>
              <span className="attendance-subject__name">{subject.name}</span>
            </button>
          )
        })}
        {!visibleSubjects.length ? (
          <p className="admin-empty-line">No subjects found for this term.</p>
        ) : null}
      </div>
    </div>
  )
}

function AttendanceFlashRunner({
  api,
  data,
  refresh,
  selectedSubject,
  selectedTerm,
}: {
  api: AuthedRequest
  data: WorkspaceData
  refresh: () => Promise<void>
  selectedSubject: Subject | null
  selectedTerm: SchoolYearSemester | null
}) {
  const [sessionDate, setSessionDate] = useState(getTodayInputValue())
  const [sessionTitle, setSessionTitle] = useState('Class attendance')
  const [pointsPossible, setPointsPossible] = useState('1.00')
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [excuseReason, setExcuseReason] = useState('')
  const [showExcuseReason, setShowExcuseReason] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  const students = useMemo(
    () => getRoster(data, selectedSubject?.id, selectedTerm?.id),
    [data, selectedSubject?.id, selectedTerm?.id],
  )
  const activeSession =
    data.attendanceSessions.find((session) => session.id === activeSessionId) ??
    null
  const currentStudent = students[currentIndex] ?? null
  const activeSessionRecords = activeSession
    ? data.attendanceRecords.filter((record) => record.session === activeSession.id)
    : []
  const sessionSummary = summarizeAttendance(activeSessionRecords)
  const recordedCount = activeSession
    ? activeSessionRecords.length
    : 0
  const existingSession = selectedSubject && selectedTerm
    ? data.attendanceSessions.find(
        (session) =>
          session.subject === selectedSubject.id &&
          session.school_year_semester === selectedTerm.id &&
          session.date === sessionDate &&
          (session.title || '') === sessionTitle,
      )
    : null

  async function startAttendance() {
    if (!selectedSubject || !selectedTerm) {
      setMessage('Choose a term and subject before starting attendance.')
      return
    }

    if (!students.length) {
      setMessage('No active enrolled students were found for this subject and term.')
      return
    }

    setSaving(true)
    setMessage('')

    try {
      const session =
        existingSession ??
        (await api<AttendanceSession>('/attendance/sessions/', {
          body: JSON.stringify({
            date: sessionDate,
            notes: '',
            points_possible: pointsPossible,
            school_year_semester: selectedTerm.id,
            subject: selectedSubject.id,
            title: sessionTitle,
          }),
          method: 'POST',
        }))

      setActiveSessionId(session.id)
      setCurrentIndex(getFirstUnrecordedIndex(data.attendanceRecords, students, session.id))
      setMessage('Attendance started.')
      setIsModalOpen(true)
      await refresh()
    } catch (caughtError) {
      setMessage(toErrorMessage(caughtError))
    } finally {
      setSaving(false)
    }
  }

  async function markStudent(status: AttendanceStatus, remarks?: string) {
    if (!activeSession || !currentStudent) {
      return
    }

    setSaving(true)
    setMessage('')

    try {
      const existing = data.attendanceRecords.find(
        (record) =>
          record.session === activeSession.id && record.student === currentStudent.id,
      )
      const endpoint = existing
        ? `/attendance/records/${existing.id}/`
        : '/attendance/records/'

      await api(endpoint, {
        body: JSON.stringify({
          points_earned: pointsForStatus(status, numeric(activeSession.points_possible)),
          remarks: remarks ?? existing?.remarks ?? '',
          session: activeSession.id,
          status,
          student: currentStudent.id,
        }),
        method: existing ? 'PATCH' : 'POST',
      })

      setCurrentIndex((index) => Math.min(index + 1, students.length))
      setExcuseReason('')
      setShowExcuseReason(false)
      await refresh()
    } catch (caughtError) {
      setMessage(toErrorMessage(caughtError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="attendance-runner">
      <div className="attendance-session-form">
        <label className="admin-field">
          <span>Date</span>
          <input
            onChange={(event) => setSessionDate(event.target.value)}
            type="date"
            value={sessionDate}
          />
        </label>
        <label className="admin-field">
          <span>Title</span>
          <input
            onChange={(event) => setSessionTitle(event.target.value)}
            type="text"
            value={sessionTitle}
          />
        </label>
        <label className="admin-field">
          <span>Points possible</span>
          <input
            onChange={(event) => setPointsPossible(event.target.value)}
            step="0.01"
            type="number"
            value={pointsPossible}
          />
        </label>
        <button
          className="button button--primary attendance-start-button"
          disabled={saving || !selectedSubject || !selectedTerm}
          onClick={() => void startAttendance()}
          type="button"
        >
          <Icon name="send" />
          <span>
            {activeSession || existingSession ? 'Continue session' : 'Start attendance'}
          </span>
        </button>
      </div>

      <div className="attendance-summary">
        <span className="stat-card__icon">
          <Icon name="users" />
        </span>
        <div>
          <small>Selected class</small>
          <strong>{selectedSubject ? selectedSubject.name : 'Choose a subject'}</strong>
          <span>
            {students.length
              ? `${students.length} students ready, sorted by last name.`
              : 'Select a subject with active enrollments.'}
          </span>
        </div>
      </div>

      {message ? <p className="admin-message">{message}</p> : null}

      {activeSession && isModalOpen ? (
        <div
          aria-labelledby="attendance-modal-title"
          aria-modal="true"
          className="attendance-modal"
          role="dialog"
        >
          <div
            className="attendance-modal__backdrop"
            onClick={() => setIsModalOpen(false)}
          />
          <div className="attendance-modal__panel">
            <div className="attendance-modal__header">
              <div>
                <strong id="attendance-modal-title">
                  {selectedSubject?.code ?? 'Attendance'}
                </strong>
                <span>
                  {sessionTitle} - {selectedTerm?.name ?? 'Selected term'}
                </span>
              </div>
              <button
                className="icon-button"
                onClick={() => setIsModalOpen(false)}
                title="Close"
                type="button"
              >
                <Icon name="close" />
              </button>
            </div>

            <div className="attendance-card">
              {currentStudent ? (
                <>
                  <div className="attendance-card__meta">
                    <span className="subject-chip">
                      {currentIndex + 1}/{students.length}
                    </span>
                    <span className="status-pill">
                      {recordedCount}/{students.length} marked
                    </span>
                  </div>
                  <strong>{studentDisplayName(currentStudent)}</strong>
                  <div className="attendance-card__actions">
                    <button
                      className="button button--primary"
                      disabled={saving}
                      onClick={() => void markStudent('PRESENT')}
                      type="button"
                    >
                      <Icon name="check" />
                      <span>Present</span>
                    </button>
                    <button
                      className="button button--secondary"
                      disabled={saving}
                      onClick={() => void markStudent('LATE')}
                      type="button"
                    >
                      <Icon name="calendar" />
                      <span>Late</span>
                    </button>
                    <button
                      className="button attendance-action--absent"
                      disabled={saving}
                      onClick={() => void markStudent('ABSENT')}
                      type="button"
                    >
                      <Icon name="warning" />
                      <span>Absent</span>
                    </button>
                    <button
                      className="button attendance-action--excused"
                      disabled={saving}
                      onClick={() => setShowExcuseReason(true)}
                      type="button"
                    >
                      <Icon name="shield" />
                      <span>Excused</span>
                    </button>
                  </div>
                  {showExcuseReason ? (
                    <div className="attendance-excuse-form">
                      <label className="admin-field">
                        <span>Excuse reason</span>
                        <input
                          autoFocus
                          onChange={(event) => setExcuseReason(event.target.value)}
                          placeholder="Medical appointment, official excuse..."
                          type="text"
                          value={excuseReason}
                        />
                      </label>
                      <div className="attendance-excuse-form__actions">
                        <button
                          className="button button--secondary"
                          disabled={saving}
                          onClick={() => {
                            setExcuseReason('')
                            setShowExcuseReason(false)
                          }}
                          type="button"
                        >
                          Cancel
                        </button>
                        <button
                          className="button attendance-action--excused"
                          disabled={saving || !excuseReason.trim()}
                          onClick={() =>
                            void markStudent('EXCUSED', excuseReason.trim())
                          }
                          type="button"
                        >
                          <Icon name="shield" />
                          <span>Mark excused</span>
                        </button>
                      </div>
                    </div>
                  ) : null}
                  <div className="attendance-card__nav">
                    <button
                      className="button button--ghost"
                      disabled={saving || currentIndex === 0}
                      onClick={() =>
                        setCurrentIndex((index) => Math.max(index - 1, 0))
                      }
                      type="button"
                    >
                      Previous
                    </button>
                    <button
                      className="button button--ghost"
                      disabled={saving}
                      onClick={() =>
                        setCurrentIndex((index) =>
                          Math.min(index + 1, students.length),
                        )
                      }
                      type="button"
                    >
                      Skip
                    </button>
                  </div>
                </>
              ) : (
                <div className="attendance-card__done">
                  <Icon name="check" />
                  <strong>Attendance complete</strong>
                  <span>{students.length} students reviewed.</span>
                  <div className="attendance-complete-summary">
                    <AttendanceBreakdownStat
                      label="Present"
                      value={sessionSummary.present}
                    />
                    <AttendanceBreakdownStat
                      label="Late"
                      value={sessionSummary.late}
                    />
                    <AttendanceBreakdownStat
                      label="Absent"
                      value={sessionSummary.absent}
                    />
                    <AttendanceBreakdownStat
                      label="Excused"
                      value={sessionSummary.excused}
                    />
                    <AttendanceBreakdownStat
                      label="Rate"
                      value={`${percent(sessionSummary.attended, activeSessionRecords.length)}%`}
                    />
                  </div>
                  <button
                    className="button button--secondary attendance-done-button"
                    onClick={() => setIsModalOpen(false)}
                    type="button"
                  >
                    <Icon name="check" />
                    <span>Done</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function AttendanceHistory({
  api,
  data,
  refresh,
  selectedSubject,
  selectedTerm,
}: {
  api: AuthedRequest
  data: WorkspaceData
  refresh: () => Promise<void>
  selectedSubject: Subject | null
  selectedTerm: SchoolYearSemester | null
}) {
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null)
  const sessions =
    selectedSubject && selectedTerm
      ? data.attendanceSessions
          .filter(
            (session) =>
              session.subject === selectedSubject.id &&
              session.school_year_semester === selectedTerm.id,
          )
          .sort((first, second) => second.date.localeCompare(first.date))
      : []
  const selectedSession =
    sessions.find((session) => session.id === selectedSessionId) ?? null

  return (
    <section className="section-block">
      <SectionHeading
        action={
          <button
            className="button button--secondary"
            disabled={!sessions.length}
            onClick={() =>
              exportAttendanceHistory(data, sessions, selectedSubject, selectedTerm)
            }
            type="button"
          >
            <Icon name="file" />
            <span>Export CSV</span>
          </button>
        }
        subtitle={
          selectedSubject && selectedTerm
            ? `${selectedSubject.code} - ${selectedTerm.name}`
            : 'Choose a subject and term'
        }
        title="Attendance History"
      />
      <div className="table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Session</th>
              <th>Present</th>
              <th>Late</th>
              <th>Absent</th>
              <th>Rate</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((session) => {
              const records = data.attendanceRecords.filter(
                (record) => record.session === session.id,
              )
              const summary = summarizeAttendance(records)

              return (
                <tr key={session.id}>
                  <td>{formatDate(session.date)}</td>
                  <td>{session.title || 'Class meeting'}</td>
                  <td>{summary.present}</td>
                  <td>{summary.late}</td>
                  <td>{summary.absent}</td>
                  <td>{percent(summary.attended, records.length)}%</td>
                  <td>
                    <button
                      className="button button--secondary"
                      onClick={() => setSelectedSessionId(session.id)}
                      type="button"
                    >
                      <Icon name="search" />
                      <span>View</span>
                    </button>
                  </td>
                </tr>
              )
            })}
            {!sessions.length ? (
              <tr>
                <td colSpan={7}>No attendance history for this subject and term.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {selectedSession ? (
        <AttendanceBreakdownModal
          api={api}
          data={data}
          refresh={refresh}
          session={selectedSession}
          onClose={() => setSelectedSessionId(null)}
        />
      ) : null}
    </section>
  )
}

function AttendanceBreakdownModal({
  api,
  data,
  onClose,
  refresh,
  session,
}: {
  api: AuthedRequest
  data: WorkspaceData
  onClose: () => void
  refresh: () => Promise<void>
  session: AttendanceSession
}) {
  const [savingStudentId, setSavingStudentId] = useState<number | null>(null)
  const [message, setMessage] = useState('')
  const records = data.attendanceRecords.filter(
    (record) => record.session === session.id,
  )
  const summary = summarizeAttendance(records)
  const students = getRoster(
    data,
    session.subject,
    session.school_year_semester ?? undefined,
  )
  const rows = students.length
    ? students.map((student) => ({
        record: records.find((record) => record.student === student.id) ?? null,
        student,
      }))
    : records.map((record) => ({
        record,
        student: data.users.find((user) => user.id === record.student) ?? null,
      }))
  const subject = data.subjects.find((item) => item.id === session.subject)

  async function updateStudentStatus(
    student: User | null,
    record: AttendanceRecord | null,
    status: AttendanceStatus,
  ) {
    if (!student) {
      setMessage('This row is missing a student account.')
      return
    }

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

  async function updateRecordRemarks(record: AttendanceRecord | null, remarks: string) {
    if (!record || remarks === record.remarks) {
      return
    }

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

  return (
    <div
      aria-labelledby="attendance-breakdown-title"
      aria-modal="true"
      className="attendance-modal"
      role="dialog"
    >
      <div className="attendance-modal__backdrop" onClick={onClose} />
      <div className="attendance-modal__panel attendance-modal__panel--wide">
        <div className="attendance-modal__header">
          <div>
            <strong id="attendance-breakdown-title">
              {session.title || 'Class meeting'}
            </strong>
            <span>
              {subject ? `${subject.code} ${subject.name}` : 'Attendance'} -{' '}
              {session.term_name || 'No term'} - {formatDate(session.date)}
            </span>
          </div>
          <button
            className="icon-button"
            onClick={onClose}
            title="Close"
            type="button"
          >
            <Icon name="close" />
          </button>
        </div>

        <div className="attendance-breakdown__stats">
          <AttendanceBreakdownStat label="Present" value={summary.present} />
          <AttendanceBreakdownStat label="Late" value={summary.late} />
          <AttendanceBreakdownStat label="Absent" value={summary.absent} />
          <AttendanceBreakdownStat label="Excused" value={summary.excused} />
          <AttendanceBreakdownStat
            label="Rate"
            value={`${percent(summary.attended, records.length)}%`}
          />
        </div>

        {message ? <p className="admin-message">{message}</p> : null}

        <div className="table-wrap">
          <table className="admin-table attendance-breakdown__table">
            <thead>
              <tr>
                <th>Student</th>
                <th>Status</th>
                <th>Points</th>
                <th>Remarks</th>
                <th>Edit</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ record, student }) => (
                <tr key={student?.id ?? record?.id}>
                  <td>
                    {student ? studentDisplayName(student) : 'Unknown student'}
                  </td>
                  <td>
                    <span
                      className={`attendance-status attendance-status--${(record?.status ?? 'unmarked').toLowerCase()}`}
                    >
                      {record?.status ?? 'UNMARKED'}
                    </span>
                  </td>
                  <td>{record ? numeric(record.points_earned) : 0}</td>
                  <td>
                    <input
                      className="attendance-remarks-input"
                      defaultValue={record?.remarks ?? ''}
                      disabled={!record || savingStudentId === record.student}
                      onBlur={(event) =>
                        void updateRecordRemarks(record, event.target.value)
                      }
                      placeholder={record ? 'Add remarks' : 'Set status first'}
                      type="text"
                    />
                  </td>
                  <td>
                    <select
                      className="attendance-status-select"
                      disabled={!student || savingStudentId === student.id}
                      onChange={(event) =>
                        void updateStudentStatus(
                          student,
                          record,
                          event.target.value as AttendanceStatus,
                        )
                      }
                      value={record?.status ?? ''}
                    >
                      <option value="">Set status</option>
                      <option value="PRESENT">Present</option>
                      <option value="LATE">Late</option>
                      <option value="ABSENT">Absent</option>
                      <option value="EXCUSED">Excused</option>
                    </select>
                  </td>
                </tr>
              ))}
              {!rows.length ? (
                <tr>
                  <td colSpan={5}>No student records for this session.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function AttendanceBreakdownStat({
  label,
  value,
}: {
  label: string
  value: number | string
}) {
  return (
    <div className="attendance-breakdown__stat">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  )
}

function getActiveTerm(terms: SchoolYearSemester[]) {
  return terms.find((term) => term.is_active) ?? terms[0] ?? null
}

function getSubjectsForTerm(data: WorkspaceData, termId?: number) {
  if (!termId) {
    return data.subjects
  }

  const subjectIds = new Set(
    data.schedules
      .filter((schedule) => schedule.school_year_semester === termId)
      .map((schedule) => schedule.subject),
  )

  const subjects = data.subjects.filter((subject) => subjectIds.has(subject.id))
  return subjects.length ? subjects : data.subjects
}

function filterSubjects(subjects: Subject[], query: string) {
  const normalizedQuery = query.trim().toLowerCase()

  if (!normalizedQuery) {
    return subjects
  }

  return subjects.filter((subject) =>
    `${subject.code} ${subject.name}`.toLowerCase().includes(normalizedQuery),
  )
}

function formatScheduleSummary(
  schedules: {
    days: string
    end_time: string
    section: string
    start_time: string
  }[],
) {
  if (!schedules.length) {
    return 'No schedule'
  }

  return schedules
    .map((schedule) =>
      [
        schedule.section,
        schedule.days,
        `${formatTime(schedule.start_time)} - ${formatTime(schedule.end_time)}`,
      ]
        .filter(Boolean)
        .join(' '),
    )
    .join(' / ')
}

function getRoster(data: WorkspaceData, subjectId?: number, termId?: number) {
  if (!subjectId || !termId) {
    return []
  }

  const studentIds = new Set(
    data.enrollments
      .filter(
        (enrollment) =>
          enrollment.is_active &&
          enrollment.subject === subjectId &&
          enrollment.school_year_semester === termId,
      )
      .map((enrollment) => enrollment.student),
  )

  return data.users
    .filter((user) => user.role === 'STUDENT' && studentIds.has(user.id))
    .sort(compareStudentsByLastName)
}

function compareStudentsByLastName(first: User, second: User) {
  return studentSortKey(first).localeCompare(studentSortKey(second), undefined, {
    sensitivity: 'base',
  })
}

function studentSortKey(user: User) {
  return `${user.last_name || user.username} ${user.first_name || ''} ${user.username}`
}

function studentDisplayName(user: User) {
  return [user.last_name, user.first_name].filter(Boolean).join(', ') || fullName(user)
}

function getFirstUnrecordedIndex(
  records: AttendanceRecord[],
  students: User[],
  sessionId: number,
) {
  const recordedIds = new Set(
    records
      .filter((record) => record.session === sessionId)
      .map((record) => record.student),
  )
  const index = students.findIndex((student) => !recordedIds.has(student.id))
  return index === -1 ? students.length : index
}

function summarizeAttendance(records: AttendanceRecord[]) {
  const present = records.filter((record) => record.status === 'PRESENT').length
  const late = records.filter((record) => record.status === 'LATE').length
  const absent = records.filter((record) => record.status === 'ABSENT').length
  const excused = records.filter((record) => record.status === 'EXCUSED').length

  return {
    absent,
    attended: present + late + excused,
    excused,
    late,
    present,
  }
}

function exportAttendanceHistory(
  data: WorkspaceData,
  sessions: AttendanceSession[],
  selectedSubject: Subject | null,
  selectedTerm: SchoolYearSemester | null,
) {
  const rows = [
    ['Date', 'Session', 'Student', 'Status', 'Points earned', 'Remarks'],
    ...sessions.flatMap((session) => {
      const records = data.attendanceRecords.filter(
        (record) => record.session === session.id,
      )
      const students = getRoster(
        data,
        session.subject,
        session.school_year_semester ?? undefined,
      )
      const recordsByStudent = new Map(records.map((record) => [record.student, record]))
      const rowStudents = students.length
        ? students
        : records
            .map((record) => data.users.find((user) => user.id === record.student))
            .filter((user): user is User => Boolean(user))

      return rowStudents.map((student) => {
        const record = recordsByStudent.get(student.id)

        return [
          session.date,
          session.title || 'Class meeting',
          studentDisplayName(student),
          record?.status ?? 'UNMARKED',
          record?.points_earned ?? '0.00',
          record?.remarks ?? '',
        ]
      })
    }),
  ]
  const csv = rows.map((row) => row.map(escapeCsvCell).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement('a')
  const subjectCode = selectedSubject?.code ?? 'attendance'
  const termName = selectedTerm?.name.replace(/\s+/g, '-').toLowerCase() ?? 'history'

  link.href = url
  link.download = `${subjectCode}-${termName}-attendance.csv`
  link.click()
  window.URL.revokeObjectURL(url)
}

function escapeCsvCell(value: string | number) {
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function pointsForStatus(status: AttendanceStatus, pointsPossible: number) {
  if (status === 'PRESENT' || status === 'EXCUSED') {
    return pointsPossible.toFixed(2)
  }

  if (status === 'LATE') {
    return (pointsPossible / 2).toFixed(2)
  }

  return '0.00'
}

function getTodayInputValue() {
  const today = new Date()
  const year = today.getFullYear()
  const month = String(today.getMonth() + 1).padStart(2, '0')
  const day = String(today.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
