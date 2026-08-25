import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import type { AuthedRequest, RouteData } from '../../app/types'
import {
  AdminResourcePanel,
  type AdminField,
} from '../../components/admin/AdminResourcePanel'
import { ManageStudentModulesDialog } from '../../components/admin/ManageStudentModulesDialog'
import { Icon } from '../../components/Icon'
import { Page, PageHeader, SectionHeading } from '../../components/ui'
import type {
  ModuleAccess,
  ScheduleStudent,
  StudentProfile,
  User,
} from '../../types'
import {
  booleanLabel,
  compactDateTime,
  moduleName,
  roleOptions,
  scheduleName,
  studentUsers,
  toOptions,
  userName,
} from '../../admin/adminHelpers'
import { toErrorMessage } from '../../utils/format'
import { fullName } from '../../utils/student'

export function AdminStudentsPage({
  api,
  data,
  refresh,
}: {
  api: AuthedRequest
  data: RouteData
  refresh: () => Promise<void>
}) {
  const [managedStudentId, setManagedStudentId] = useState<number | null>(null)
  const students = studentUsers(data.users)
  const studentOptions = toOptions(students, (user) => user.id, fullName)
  const scheduleOptions = toOptions(
    data.schedules,
    (schedule) => schedule.id,
    (schedule) => scheduleName(data.schedules, data.subjects, schedule.id),
  )
  const moduleOptions = toOptions(
    data.modules,
    (module) => module.id,
    (module) => module.title,
  )

  return (
    <Page>
      <PageHeader
        eyebrow="People and access"
        title="Students"
        description="Create accounts, maintain student profiles, enroll students, and manage module access."
      />

      <QuickStudentSetupPanel api={api} refresh={refresh} />

      <StudentModuleAccessPanel
        onManage={setManagedStudentId}
        students={students}
      />

      <BulkModuleAccessPanel
        api={api}
        data={data}
        moduleOptions={moduleOptions}
        refresh={refresh}
        scheduleOptions={scheduleOptions}
      />

      <AdminResourcePanel<User>
        api={api}
        endpoint="/accounts/users/"
        fields={userFields}
        getSearchText={(user) =>
          `${user.username} ${user.email} ${user.first_name} ${user.last_name} ${user.role}`
        }
        items={data.users}
        noun="User"
        onRefresh={refresh}
        title="User Accounts"
        columns={[
          { header: 'Name', render: (user) => fullName(user) },
          { header: 'Username', render: (user) => user.username },
          { header: 'Role', render: (user) => user.role },
          { header: 'Active', render: (user) => booleanLabel(user.is_active) },
        ]}
      />

      <AdminResourcePanel<StudentProfile>
        api={api}
        endpoint="/accounts/students/"
        fields={profileFields}
        getSearchText={(profile) =>
          `${profile.student_number} ${userName(data.users, profile.user)}`
        }
        items={data.profiles}
        noun="Student profile"
        onRefresh={refresh}
        title="Student Profiles"
        columns={[
          { header: 'Student', render: (profile) => userName(data.users, profile.user) },
          { header: 'Number', render: (profile) => profile.student_number },
          { header: 'Active', render: (profile) => booleanLabel(profile.is_active) },
        ]}
      />

      <AdminResourcePanel<ScheduleStudent>
        api={api}
        endpoint="/subjects/schedule-students/"
        fields={enrollmentFields(scheduleOptions, studentOptions)}
        getSearchText={(enrollment) =>
          `${enrollment.student_name} ${enrollment.subject_code} ${enrollment.term_name}`
        }
        items={data.enrollments}
        noun="Enrollment"
        onRefresh={refresh}
        title="Class Enrollments"
        columns={[
          { header: 'Student', render: (enrollment) => enrollment.student_name },
          { header: 'Subject', render: (enrollment) => enrollment.subject_code },
          { header: 'Term', render: (enrollment) => enrollment.term_name },
          {
            header: 'Active',
            render: (enrollment) => booleanLabel(enrollment.is_active),
          },
        ]}
      />

      <AdminResourcePanel<ModuleAccess>
        api={api}
        endpoint="/modules/access/"
        fields={accessFields(moduleOptions, studentOptions)}
        getSearchText={(grant) =>
          `${grant.student_name} ${grant.module_title} ${grant.status} ${grant.access_type}`
        }
        items={data.moduleAccess}
        noun="Module access"
        onRefresh={refresh}
        title="Module Access Grants"
        columns={[
          { header: 'Student', render: (grant) => grant.student_name },
          { header: 'Module', render: (grant) => moduleName(data.modules, grant.module) },
          { header: 'Type', render: (grant) => grant.access_type === 'ENROLLED' ? 'Enrolled' : 'Advance study' },
          { header: 'Status', render: (grant) => grant.status },
          { header: 'Expires', render: (grant) => compactDateTime(grant.expires_at) },
        ]}
      />

      {managedStudentId ? (
        <ManageStudentModulesDialog
          api={api}
          data={data}
          onClose={() => setManagedStudentId(null)}
          refresh={refresh}
          studentId={managedStudentId}
          studentName={fullName(
            students.find((student) => student.id === managedStudentId) ?? null,
          )}
        />
      ) : null}
    </Page>
  )
}

function StudentModuleAccessPanel({
  onManage,
  students,
}: {
  onManage: (studentId: number) => void
  students: User[]
}) {
  const [studentId, setStudentId] = useState('')

  return (
    <section className="admin-resource section-block">
      <SectionHeading
        subtitle="Grant one student an additional module without changing enrollment."
        title="Student Module Access"
      />
      <div className="student-module-access-launcher">
        <label className="admin-field">
          <span>Student</span>
          <select
            onChange={(event) => setStudentId(event.target.value)}
            value={studentId}
          >
            <option value="">Select a student</option>
            {students.map((student) => (
              <option key={student.id} value={student.id}>
                {fullName(student)} ({student.username})
              </option>
            ))}
          </select>
        </label>
        <button
          className="button button--primary"
          disabled={!studentId}
          onClick={() => onManage(Number(studentId))}
          type="button"
        >
          <Icon name="module" />
          <span>Manage Modules</span>
        </button>
      </div>
    </section>
  )
}

function QuickStudentSetupPanel({
  api,
  refresh,
}: {
  api: AuthedRequest
  refresh: () => Promise<void>
}) {
  const [email, setEmail] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [studentNumber, setStudentNumber] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  async function createStudent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setMessage('')

    try {
      await api<StudentProfile>('/accounts/students/', {
        body: JSON.stringify({
          email,
          first_name: firstName,
          is_active: true,
          last_name: lastName,
          student_number: studentNumber,
        }),
        method: 'POST',
      })

      setEmail('')
      setFirstName('')
      setLastName('')
      setStudentNumber('')
      setMessage('Student account created. The initial username and password are the student number.')
      await refresh()
    } catch (caughtError) {
      setMessage(toErrorMessage(caughtError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="admin-resource section-block">
      <SectionHeading subtitle="Student records" title="Quick Student Setup" />
      <form className="admin-inline-form" onSubmit={createStudent}>
        <label className="admin-field">
          <span>First name</span>
          <input
            onChange={(event) => setFirstName(event.target.value)}
            type="text"
            value={firstName}
          />
        </label>
        <label className="admin-field">
          <span>Last name</span>
          <input
            onChange={(event) => setLastName(event.target.value)}
            type="text"
            value={lastName}
          />
        </label>
        <label className="admin-field">
          <span>Email</span>
          <input
            onChange={(event) => setEmail(event.target.value)}
            type="email"
            value={email}
          />
        </label>
        <label className="admin-field">
          <span>Student number</span>
          <input
            onChange={(event) => setStudentNumber(event.target.value)}
            required
            type="text"
            value={studentNumber}
          />
        </label>
        <button className="button button--primary" disabled={saving} type="submit">
          <Icon name="save" />
          <span>{saving ? 'Creating...' : 'Create student'}</span>
        </button>
        {message ? <p className="admin-message">{message}</p> : null}
      </form>
    </section>
  )
}

function BulkModuleAccessPanel({
  api,
  data,
  moduleOptions,
  refresh,
  scheduleOptions,
}: {
  api: AuthedRequest
  data: RouteData
  moduleOptions: { label: string; value: number | string }[]
  refresh: () => Promise<void>
  scheduleOptions: { label: string; value: number | string }[]
}) {
  const [moduleId, setModuleId] = useState('')
  const [scheduleId, setScheduleId] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const selectedModule = data.modules.find((module) => module.id === Number(moduleId))

  const students = useMemo(() => {
    if (!scheduleId) {
      return []
    }

    const studentIds = new Set(
      data.enrollments
        .filter(
          (enrollment) =>
            enrollment.is_active && enrollment.schedule === Number(scheduleId),
        )
        .map((enrollment) => enrollment.student),
    )

    return data.users.filter(
      (user) => user.role === 'STUDENT' && studentIds.has(user.id),
    )
  }, [data.enrollments, data.users, scheduleId])

  async function grantAccess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!selectedModule || !students.length) {
      setMessage('No enrolled students found for this class.')
      return
    }

    setSaving(true)
    setMessage('')

    try {
      await Promise.all(
        students.map((student) => {
          const existing = data.moduleAccess.find(
            (grant) =>
              grant.access_type === 'ENROLLED' &&
              grant.module === selectedModule.id &&
              grant.student === student.id,
          )
          const endpoint = existing
            ? `/modules/access/${existing.id}/`
            : '/modules/access/'

          return api(endpoint, {
            body: JSON.stringify({
              access_type: 'ENROLLED',
              is_active: true,
              module: selectedModule.id,
              notes: `Activated from ${scheduleName(data.schedules, data.subjects, Number(scheduleId))}`,
              student: student.id,
            }),
            method: existing ? 'PATCH' : 'POST',
          })
        }),
      )
      setMessage(`${students.length} module access grants saved.`)
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
        title="Bulk Module Access"
      />
      <form className="admin-inline-form" onSubmit={grantAccess}>
        <label className="admin-field">
          <span>Module</span>
          <select
            onChange={(event) => setModuleId(event.target.value)}
            required
            value={moduleId}
          >
            <option value="">Select</option>
            {moduleOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="admin-field">
          <span>Class schedule</span>
          <select
            onChange={(event) => setScheduleId(event.target.value)}
            required
            value={scheduleId}
          >
            <option value="">Select</option>
            {scheduleOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <button className="button button--primary" disabled={saving} type="submit">
          <Icon name="shield" />
          <span>{saving ? 'Saving...' : 'Activate access'}</span>
        </button>
        {message ? <p className="admin-message">{message}</p> : null}
      </form>
    </section>
  )
}

const userFields: AdminField<User>[] = [
  { label: 'Username', name: 'username', required: true, type: 'text' },
  { label: 'Password', name: 'password', type: 'password' },
  { label: 'Email', name: 'email', type: 'text' },
  { label: 'First name', name: 'first_name', type: 'text' },
  { label: 'Last name', name: 'last_name', type: 'text' },
  {
    defaultValue: 'TEACHER',
    label: 'Role',
    name: 'role',
    options: roleOptions,
    required: true,
    type: 'select',
  },
  {
    defaultValue: true,
    label: 'Active',
    name: 'is_active',
    type: 'checkbox',
  },
]

const profileFields = [
  { label: 'Student number', name: 'student_number', required: true, type: 'text' },
  {
    defaultValue: true,
    label: 'Active',
    name: 'is_active',
    type: 'checkbox',
  },
] satisfies AdminField<StudentProfile>[]

function enrollmentFields(
  scheduleOptions: { label: string; value: number | string }[],
  studentOptions: { label: string; value: number | string }[],
) {
  return [
    {
      label: 'Schedule',
      name: 'schedule',
      options: scheduleOptions,
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
      defaultValue: true,
      label: 'Active',
      name: 'is_active',
      type: 'checkbox',
    },
  ] satisfies AdminField<ScheduleStudent>[]
}

function accessFields(
  moduleOptions: { label: string; value: number | string }[],
  studentOptions: { label: string; value: number | string }[],
) {
  return [
    {
      defaultValue: 'ENROLLED',
      label: 'Access type',
      name: 'access_type',
      options: [
        { label: 'Enrolled module', value: 'ENROLLED' },
        { label: 'Advance module', value: 'ADVANCE_STUDY' },
      ],
      readOnlyOnEdit: true,
      required: true,
      type: 'select',
    },
    {
      label: 'Module',
      name: 'module',
      options: moduleOptions,
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
    { label: 'Expires at', name: 'expires_at', nullable: true, type: 'datetime-local' },
    { label: 'Notes', name: 'notes', rows: 3, type: 'textarea' },
    {
      defaultValue: true,
      label: 'Active',
      name: 'is_active',
      type: 'checkbox',
    },
  ] satisfies AdminField<ModuleAccess>[]
}
