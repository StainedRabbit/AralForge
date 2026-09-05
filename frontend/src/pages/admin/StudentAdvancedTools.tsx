import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { asArray } from '../../api'
import type { AuthedRequest, RouteData } from '../../app/types'
import {
  AdminResourcePanel,
  type AdminField,
} from '../../components/admin/AdminResourcePanel'
import { Icon } from '../../components/Icon'
import { SectionHeading } from '../../components/ui'
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
import { fullName, fullRecordName } from '../../utils/student'
import { countReplacementCharacters, replacementCharacterWarning } from '../../utils/textFile'

export function StudentAdvancedTools({ api, data, refresh, onFormStateChange }: {
  api: AuthedRequest; data: RouteData; refresh: () => Promise<void>
  onFormStateChange: (id: string, state: { dirty: boolean; busy: boolean } | null) => void
}) {
  const moduleOptions = toOptions(data.modules, (module) => module.id, (module) => module.title)
  return <div className="students-advanced">
      <BulkModuleAccessPanel
        api={api}
        data={data}
        onSaved={refresh}
        onFormStateChange={(state) => onFormStateChange('bulk', state)}
        moduleOptions={moduleOptions}
      />

      <AdminResourcePanel<User>
        api={api}
        endpoint="/accounts/users/"
        fields={userFields}
        getSearchText={(user) =>
          `${user.username} ${user.email} ${user.first_name} ${user.middle_name ?? ''} ${user.last_name} ${user.role}`
        }
        items={data.users}
        noun="User"
        onRefresh={refresh}
        onChanged={refresh}
        onFormStateChange={(state) => onFormStateChange('accounts', state)}
        serverSide
        title="User Accounts"
        columns={[
          { header: 'Name', render: (user) => <StudentAccountName user={user} /> },
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
          `${profile.student_number} ${fullRecordName(profile.user_detail ?? null)}`
        }
        items={data.profiles}
        noun="Student profile"
        onRefresh={refresh}
        onChanged={refresh}
        onFormStateChange={(state) => onFormStateChange('profiles', state)}
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
        onChanged={refresh}
        onFormStateChange={(state) => onFormStateChange('enrollments', state)}
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
        onChanged={refresh}
        onFormStateChange={(state) => onFormStateChange('grants', state)}
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

  </div>
}

function BulkModuleAccessPanel({
  api,
  data,
  moduleOptions,
  onSaved,
  onFormStateChange,
}: {
  api: AuthedRequest
  data: RouteData
  moduleOptions: { label: string; value: number | string }[]
  onSaved: () => Promise<void>
  onFormStateChange: (state: { dirty: boolean; busy: boolean } | null) => void
}) {
  const [moduleId, setModuleId] = useState('')
  const [scheduleId, setScheduleId] = useState('')
  const [baseline, setBaseline] = useState('["",""]')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const dirty = JSON.stringify([moduleId, scheduleId]) !== baseline
  useEffect(() => {
    onFormStateChange({ dirty, busy: saving })
    return () => onFormStateChange(null)
  }, [dirty, saving, onFormStateChange])
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
      setBaseline(JSON.stringify([moduleId, scheduleId]))
      await onSaved()
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
  { label: 'First name', name: 'first_name', type: 'text', validate: validateStudentNameField },
  { label: 'Middle name', name: 'middle_name', type: 'text', validate: validateStudentNameField },
  { label: 'Last name', name: 'last_name', type: 'text', validate: validateStudentNameField },
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

function validateStudentNameField(value: boolean | File | null | string | string[]) {
  if (typeof value !== 'string') return ''
  const replacementCount = countReplacementCharacters(value)
  return replacementCount ? replacementCharacterWarning(replacementCount) : ''
}

function StudentAccountName({ user }: { user: User }) {
  const replacementCount = countReplacementCharacters(`${user.first_name}${user.middle_name ?? ''}${user.last_name}`)
  return (
    <span className="student-name-with-warning">
      <strong>{fullName(user)}</strong>
      {replacementCount ? (
        <small className="name-correction-warning" role="status">
          Name needs correction. Edit this User Account.
        </small>
      ) : null}
    </span>
  )
}

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
