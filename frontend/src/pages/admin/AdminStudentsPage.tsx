import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { asArray } from '../../api'
import type { AuthedRequest, RouteData } from '../../app/types'
import {
  AdminResourcePanel,
  type AdminField,
} from '../../components/admin/AdminResourcePanel'
import { ManageStudentModulesDialog } from '../../components/admin/ManageStudentModulesDialog'
import { Icon } from '../../components/Icon'
import { Page, PageHeader, SectionHeading } from '../../components/ui'
import type {
  ApiList,
  ModuleAccess,
  ScheduleStudent,
  StudentProfile,
  SubjectSchedule,
  User,
} from '../../types'
import { queryKeys } from '../../queries/queryKeys'
import {
  booleanLabel,
  compactDateTime,
  moduleName,
  roleOptions,
  toOptions,
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
  const [managedStudent, setManagedStudent] = useState<{ id: number; name: string } | null>(null)
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
        api={api}
        onManage={setManagedStudent}
      />

      <BulkModuleAccessPanel
        api={api}
        data={data}
        moduleOptions={moduleOptions}
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
        serverSide
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
          `${profile.student_number} ${fullName(profile.user_detail ?? null)}`
        }
        items={data.profiles}
        noun="Student profile"
        onRefresh={refresh}
        serverSide
        title="Student Profiles"
        columns={[
          { header: 'Student', render: (profile) => fullName(profile.user_detail ?? null) },
          { header: 'Number', render: (profile) => profile.student_number },
          { header: 'Active', render: (profile) => booleanLabel(profile.is_active) },
        ]}
      />

      <AdminResourcePanel<ScheduleStudent>
        api={api}
        endpoint="/subjects/schedule-students/"
        fields={enrollmentFields()}
        getSearchText={(enrollment) =>
          `${enrollment.student_name} ${enrollment.subject_code} ${enrollment.term_name}`
        }
        items={data.enrollments}
        noun="Enrollment"
        onRefresh={refresh}
        serverSide
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
        fields={accessFields(moduleOptions)}
        getSearchText={(grant) =>
          `${grant.student_name} ${grant.module_title} ${grant.status} ${grant.access_type}`
        }
        items={data.moduleAccess}
        noun="Module access"
        onRefresh={refresh}
        serverSide
        title="Module Access Grants"
        columns={[
          { header: 'Student', render: (grant) => grant.student_name },
          { header: 'Module', render: (grant) => moduleName(data.modules, grant.module) },
          { header: 'Type', render: (grant) => grant.access_type === 'ENROLLED' ? 'Enrolled' : 'Advance study' },
          { header: 'Status', render: (grant) => grant.status },
          { header: 'Expires', render: (grant) => compactDateTime(grant.expires_at) },
        ]}
      />

      {managedStudent ? (
        <ManageStudentModulesDialog
          api={api}
          data={data}
          onClose={() => setManagedStudent(null)}
          studentId={managedStudent.id}
          studentName={managedStudent.name}
        />
      ) : null}
    </Page>
  )
}

function StudentModuleAccessPanel({
  api,
  onManage,
}: {
  api: AuthedRequest
  onManage: (student: { id: number; name: string }) => void
}) {
  const [studentId, setStudentId] = useState('')
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 250)
    return () => window.clearTimeout(timer)
  }, [query])
  const path = `/accounts/students/?pagination=cursor&limit=20&search=${encodeURIComponent(debouncedQuery)}`
  const studentsQuery = useQuery({
    queryKey: queryKeys.resource(path),
    queryFn: ({ signal }) => api<ApiList<StudentProfile>>(path, { signal }),
    enabled: debouncedQuery.length >= 2,
    staleTime: 60_000,
  })
  const profiles = asArray(studentsQuery.data ?? [])
  const selectedProfile = profiles.find((profile) => profile.user === Number(studentId))

  return (
    <section className="admin-resource section-block">
      <SectionHeading
        subtitle="Grant one student an additional module without changing enrollment."
        title="Student Module Access"
      />
      <div className="student-module-access-launcher">
        <label className="admin-field" htmlFor="student-access-search">
          <span>Search student</span>
          <input
            id="student-access-search"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name or student number"
            type="search"
            value={query}
          />
        </label>
        <label className="admin-field" htmlFor="student-access-result">
          <span>Student</span>
          <select
            id="student-access-result"
            onChange={(event) => setStudentId(event.target.value)}
            value={studentId}
          >
            <option value="">Select a student</option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.user}>
                {fullName(profile.user_detail ?? null)} ({profile.student_number})
              </option>
            ))}
          </select>
        </label>
        <button
          className="button button--primary"
          disabled={!studentId}
          onClick={() => selectedProfile && onManage({
            id: selectedProfile.user,
            name: fullName(selectedProfile.user_detail ?? null),
          })}
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
}: {
  api: AuthedRequest
  data: RouteData
  moduleOptions: { label: string; value: number | string }[]
}) {
  const [moduleId, setModuleId] = useState('')
  const [scheduleId, setScheduleId] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [scheduleQuery, setScheduleQuery] = useState('')
  const [debouncedScheduleQuery, setDebouncedScheduleQuery] = useState('')
  const selectedModule = data.modules.find((module) => module.id === Number(moduleId))
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedScheduleQuery(scheduleQuery.trim()), 250)
    return () => window.clearTimeout(timer)
  }, [scheduleQuery])
  const schedulesPath = `/subjects/subject-schedules/?limit=20&search=${encodeURIComponent(debouncedScheduleQuery)}`
  const schedulesQuery = useQuery({
    queryKey: queryKeys.resource(schedulesPath),
    queryFn: ({ signal }) => api<ApiList<SubjectSchedule>>(schedulesPath, { signal }),
    enabled: debouncedScheduleQuery.length >= 2,
    staleTime: 60_000,
  })
  const schedules = asArray(schedulesQuery.data ?? [])
  const selectedSchedule = schedules.find((schedule) => schedule.id === Number(scheduleId))

  async function grantAccess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!selectedModule || !scheduleId) {
      setMessage('Select a module and class schedule.')
      return
    }

    setSaving(true)
    setMessage('')

    try {
      const result = await api<{ student_count: number }>('/modules/access/batch-activate/', {
        body: JSON.stringify({
          module: selectedModule.id,
          notes: `Activated from ${selectedSchedule?.subject_code ?? 'class'} ${selectedSchedule?.section ?? ''}`.trim(),
          schedule: Number(scheduleId),
        }),
        method: 'POST',
      })
      setMessage(`${result.student_count} module access grants saved.`)
    } catch (caughtError) {
      setMessage(toErrorMessage(caughtError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="admin-resource section-block">
      <SectionHeading
        subtitle="Activate access for every active student in one class"
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
          <span>Search class schedule</span>
          <input
            onChange={(event) => setScheduleQuery(event.target.value)}
            placeholder="Subject, section, or room"
            type="search"
            value={scheduleQuery}
          />
          <select
            onChange={(event) => setScheduleId(event.target.value)}
            required
            value={scheduleId}
          >
            <option value="">Select</option>
            {schedules.map((schedule) => (
              <option key={schedule.id} value={schedule.id}>
                {schedule.subject_code} {schedule.section} - {schedule.days}
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

function enrollmentFields() {
  return [
    {
      label: 'Schedule',
      name: 'schedule',
      parse: Number,
      remoteOptions: {
        endpoint: '/subjects/subject-schedules/',
        map: (item) => {
          const schedule = item as SubjectSchedule
          return {
            label: `${schedule.subject_code} ${schedule.section} - ${schedule.days}`,
            value: schedule.id,
          }
        },
      },
      required: true,
      type: 'remote-select',
    },
    {
      label: 'Student',
      name: 'student',
      parse: Number,
      remoteOptions: {
        endpoint: '/accounts/students/',
        map: (item) => {
          const profile = item as StudentProfile
          return {
            label: `${fullName(profile.user_detail ?? null)} (${profile.student_number})`,
            value: profile.user,
          }
        },
      },
      required: true,
      type: 'remote-select',
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
      parse: Number,
      remoteOptions: {
        endpoint: '/accounts/students/',
        map: (item) => {
          const profile = item as StudentProfile
          return {
            label: `${fullName(profile.user_detail ?? null)} (${profile.student_number})`,
            value: profile.user,
          }
        },
      },
      required: true,
      type: 'remote-select',
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
