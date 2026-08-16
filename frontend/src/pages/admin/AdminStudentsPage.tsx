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
  const userOptions = toOptions(data.users, (user) => user.id, fullName)
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
        description="Create accounts, maintain student profiles, enroll students, and record cash module payments."
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
        fields={profileFields(userOptions)}
        getSearchText={(profile) =>
          `${profile.student_number} ${profile.section} ${userName(data.users, profile.user)}`
        }
        items={data.profiles}
        noun="Student profile"
        onRefresh={refresh}
        title="Student Profiles"
        columns={[
          { header: 'Student', render: (profile) => userName(data.users, profile.user) },
          { header: 'Number', render: (profile) => profile.student_number },
          { header: 'Section', render: (profile) => profile.section || 'Not set' },
          {
            header: 'Year',
            render: (profile) => profile.year_level?.toString() ?? 'Not set',
          },
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
          `${grant.student_name} ${grant.module_title} ${grant.payment_status} ${grant.payment_reference}`
        }
        items={data.moduleAccess.filter((grant) => grant.access_type === 'PAYMENT')}
        noun="Module access"
        onRefresh={refresh}
        title="Module Payment Records"
        columns={[
          { header: 'Student', render: (grant) => grant.student_name },
          { header: 'Module', render: (grant) => moduleName(data.modules, grant.module) },
          { header: 'Status', render: (grant) => grant.payment_status },
          { header: 'Available', render: (grant) => booleanLabel(grant.is_available) },
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
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [email, setEmail] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [studentNumber, setStudentNumber] = useState('')
  const [section, setSection] = useState('')
  const [yearLevel, setYearLevel] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  async function createStudent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setMessage('')

    try {
      const user = await api<User>('/accounts/users/', {
        body: JSON.stringify({
          email,
          first_name: firstName,
          is_active: true,
          last_name: lastName,
          password,
          role: 'STUDENT',
          username,
        }),
        method: 'POST',
      })

      await api('/accounts/students/', {
        body: JSON.stringify({
          is_active: true,
          section,
          student_number: studentNumber,
          user: user.id,
          year_level: yearLevel ? Number(yearLevel) : null,
        }),
        method: 'POST',
      })

      setUsername('')
      setPassword('')
      setEmail('')
      setFirstName('')
      setLastName('')
      setStudentNumber('')
      setSection('')
      setYearLevel('')
      setMessage('Student account created.')
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
          <span>Username</span>
          <input
            onChange={(event) => setUsername(event.target.value)}
            required
            type="text"
            value={username}
          />
        </label>
        <label className="admin-field">
          <span>Password</span>
          <input
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
        </label>
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
        <label className="admin-field">
          <span>Section</span>
          <input
            onChange={(event) => setSection(event.target.value)}
            type="text"
            value={section}
          />
        </label>
        <label className="admin-field">
          <span>Year level</span>
          <input
            onChange={(event) => setYearLevel(event.target.value)}
            type="number"
            value={yearLevel}
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
  const [amountPaid, setAmountPaid] = useState('0.00')
  const [reference, setReference] = useState('')
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
              grant.access_type === 'PAYMENT' &&
              grant.module === selectedModule.id &&
              grant.student === student.id,
          )
          const endpoint = existing
            ? `/modules/access/${existing.id}/`
            : '/modules/access/'

          return api(endpoint, {
            body: JSON.stringify({
              amount_paid: amountPaid || selectedModule.price,
              access_type: 'PAYMENT',
              is_active: true,
              module: selectedModule.id,
              notes: `Activated from ${scheduleName(data.schedules, data.subjects, Number(scheduleId))}`,
              payment_reference: reference,
              payment_status: 'PAID',
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
            onChange={(event) => {
              const nextModule = data.modules.find(
                (module) => module.id === Number(event.target.value),
              )
              setModuleId(event.target.value)
              setAmountPaid(nextModule?.price ?? '0.00')
            }}
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
        <label className="admin-field">
          <span>Amount</span>
          <input
            onChange={(event) => setAmountPaid(event.target.value)}
            required
            type="number"
            value={amountPaid}
          />
        </label>
        <label className="admin-field admin-field--wide">
          <span>Reference</span>
          <input
            onChange={(event) => setReference(event.target.value)}
            type="text"
            value={reference}
          />
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
    defaultValue: 'STUDENT',
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

function profileFields(userOptions: { label: string; value: number | string }[]) {
  return [
    {
      label: 'User',
      name: 'user',
      options: userOptions,
      parse: Number,
      required: true,
      type: 'select',
    },
    { label: 'Student number', name: 'student_number', required: true, type: 'text' },
    { label: 'Section', name: 'section', type: 'text' },
    { label: 'Year level', name: 'year_level', nullable: true, type: 'number' },
    {
      defaultValue: true,
      label: 'Active',
      name: 'is_active',
      type: 'checkbox',
    },
  ] satisfies AdminField<StudentProfile>[]
}

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
      defaultValue: 'PAYMENT',
      label: 'Access type',
      name: 'access_type',
      options: [
        { label: 'Enrolled module', value: 'PAYMENT' },
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
    {
      defaultValue: 'PAID',
      label: 'Payment status',
      name: 'payment_status',
      options: [{ label: 'Paid', value: 'PAID' }],
      required: true,
      type: 'select',
    },
    { defaultValue: '0.00', label: 'Amount paid', name: 'amount_paid', type: 'number' },
    { label: 'Reference', name: 'payment_reference', type: 'text' },
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
