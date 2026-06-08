import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import type { AuthedRequest, WorkspaceData } from '../../app/types'
import {
  AdminResourcePanel,
  type AdminField,
} from '../../components/admin/AdminResourcePanel'
import { Page, PageHeader, SectionHeading } from '../../components/ui'
import { Icon } from '../../components/Icon'
import type { AttendanceRecord, AttendanceSession } from '../../types'
import {
  attendanceSessionName,
  attendanceStatusOptions,
  subjectName,
  studentUsers,
  toOptions,
  userName,
} from '../../admin/adminHelpers'
import { formatDate, numeric, toErrorMessage } from '../../utils/format'
import { fullName } from '../../utils/student'

export function AdminAttendancePage({
  api,
  data,
  refresh,
}: {
  api: AuthedRequest
  data: WorkspaceData
  refresh: () => Promise<void>
}) {
  const subjectOptions = toOptions(
    data.subjects,
    (subject) => subject.id,
    (subject) => `${subject.code} ${subject.name}`,
  )
  const sessionOptions = toOptions(
    data.attendanceSessions,
    (session) => session.id,
    (session) => attendanceSessionName(data.attendanceSessions, data.subjects, session.id),
  )
  const studentOptions = toOptions(studentUsers(data.users), (user) => user.id, fullName)

  return (
    <Page>
      <PageHeader
        eyebrow="Attendance"
        title="Attendance"
        description="Create attendance sessions and record student attendance points."
      />

      <BulkAttendancePanel api={api} data={data} refresh={refresh} />

      <AdminResourcePanel<AttendanceSession>
        api={api}
        columns={[
          { header: 'Subject', render: (session) => subjectName(data.subjects, session.subject) },
          { header: 'Title', render: (session) => session.title || 'Class meeting' },
          { header: 'Date', render: (session) => formatDate(session.date) },
          { header: 'Points', render: (session) => numeric(session.points_possible) },
        ]}
        endpoint="/attendance/sessions/"
        fields={sessionFields(subjectOptions)}
        getSearchText={(session) => `${session.title} ${session.date} ${session.notes}`}
        items={data.attendanceSessions}
        noun="Session"
        onRefresh={refresh}
        title="Attendance Sessions"
      />

      <AdminResourcePanel<AttendanceRecord>
        api={api}
        columns={[
          { header: 'Student', render: (record) => userName(data.users, record.student) },
          {
            header: 'Session',
            render: (record) =>
              attendanceSessionName(data.attendanceSessions, data.subjects, record.session),
          },
          { header: 'Status', render: (record) => record.status },
          { header: 'Points', render: (record) => numeric(record.points_earned) },
        ]}
        endpoint="/attendance/records/"
        fields={recordFields(sessionOptions, studentOptions)}
        getSearchText={(record) =>
          `${userName(data.users, record.student)} ${record.status} ${record.remarks}`
        }
        items={data.attendanceRecords}
        noun="Attendance record"
        onRefresh={refresh}
        title="Attendance Records"
      />
    </Page>
  )
}

function BulkAttendancePanel({
  api,
  data,
  refresh,
}: {
  api: AuthedRequest
  data: WorkspaceData
  refresh: () => Promise<void>
}) {
  const [sessionId, setSessionId] = useState('')
  const [status, setStatus] = useState('PRESENT')
  const [pointsEarned, setPointsEarned] = useState('1.00')
  const [remarks, setRemarks] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  const session = data.attendanceSessions.find(
    (item) => item.id === Number(sessionId),
  )
  const students = useMemo(() => {
    if (!session) {
      return []
    }

    const enrolledIds = new Set(
      data.enrollments
        .filter(
          (enrollment) =>
            enrollment.is_active && enrollment.subject === session.subject,
        )
        .map((enrollment) => enrollment.student),
    )

    return data.users.filter(
      (user) => user.role === 'STUDENT' && enrolledIds.has(user.id),
    )
  }, [data.enrollments, data.users, session])

  async function submitBulkAttendance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!session || !students.length) {
      setMessage('No enrolled students found for this session.')
      return
    }

    setSaving(true)
    setMessage('')

    try {
      await Promise.all(
        students.map((student) => {
          const existing = data.attendanceRecords.find(
            (record) =>
              record.session === session.id && record.student === student.id,
          )
          const endpoint = existing
            ? `/attendance/records/${existing.id}/`
            : '/attendance/records/'

          return api(endpoint, {
            body: JSON.stringify({
              points_earned: pointsEarned,
              remarks,
              session: session.id,
              status,
              student: student.id,
            }),
            method: existing ? 'PATCH' : 'POST',
          })
        }),
      )
      setMessage(`${students.length} attendance records saved.`)
      await refresh()
    } catch (caughtError) {
      setMessage(toErrorMessage(caughtError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="admin-resource section-block">
      <SectionHeading
        subtitle={`${students.length} enrolled student${students.length === 1 ? '' : 's'}`}
        title="Bulk Attendance"
      />
      <form className="admin-inline-form" onSubmit={submitBulkAttendance}>
        <label className="admin-field">
          <span>Session</span>
          <select
            onChange={(event) => setSessionId(event.target.value)}
            required
            value={sessionId}
          >
            <option value="">Select</option>
            {data.attendanceSessions.map((item) => (
              <option key={item.id} value={item.id}>
                {attendanceSessionName(data.attendanceSessions, data.subjects, item.id)}
              </option>
            ))}
          </select>
        </label>
        <label className="admin-field">
          <span>Status</span>
          <select
            onChange={(event) => setStatus(event.target.value)}
            required
            value={status}
          >
            {attendanceStatusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="admin-field">
          <span>Points</span>
          <input
            onChange={(event) => setPointsEarned(event.target.value)}
            required
            type="number"
            value={pointsEarned}
          />
        </label>
        <label className="admin-field">
          <span>Remarks</span>
          <input
            onChange={(event) => setRemarks(event.target.value)}
            type="text"
            value={remarks}
          />
        </label>
        <button className="button button--primary" disabled={saving} type="submit">
          <Icon name="save" />
          <span>{saving ? 'Saving...' : 'Save attendance'}</span>
        </button>
        {message ? <p className="admin-message">{message}</p> : null}
      </form>
    </section>
  )
}

function sessionFields(subjectOptions: { label: string; value: number | string }[]) {
  return [
    {
      label: 'Subject',
      name: 'subject',
      options: subjectOptions,
      parse: Number,
      required: true,
      type: 'select',
    },
    { label: 'Title', name: 'title', type: 'text' },
    { label: 'Date', name: 'date', required: true, type: 'date' },
    { defaultValue: '1.00', label: 'Points possible', name: 'points_possible', type: 'number' },
    { label: 'Notes', name: 'notes', rows: 3, type: 'textarea' },
  ] satisfies AdminField<AttendanceSession>[]
}

function recordFields(
  sessionOptions: { label: string; value: number | string }[],
  studentOptions: { label: string; value: number | string }[],
) {
  return [
    {
      label: 'Session',
      name: 'session',
      options: sessionOptions,
      parse: Number,
      required: true,
      type: 'select',
    },
    {
      label: 'Student',
      name: 'student',
      options: studentOptions,
      parse: Number,
      required: true,
      type: 'select',
    },
    {
      defaultValue: 'PRESENT',
      label: 'Status',
      name: 'status',
      options: attendanceStatusOptions,
      required: true,
      type: 'select',
    },
    { defaultValue: '1.00', label: 'Points earned', name: 'points_earned', type: 'number' },
    { label: 'Remarks', name: 'remarks', rows: 3, type: 'textarea' },
  ] satisfies AdminField<AttendanceRecord>[]
}
