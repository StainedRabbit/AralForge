import type { AuthedRequest, WorkspaceData } from '../../app/types'
import {
  AdminResourcePanel,
  type AdminField,
} from '../../components/admin/AdminResourcePanel'
import { Page, PageHeader } from '../../components/ui'
import type {
  SchoolYear,
  SchoolYearSemester,
  Subject,
  SubjectSchedule,
} from '../../types'
import {
  booleanLabel,
  subjectName,
  toOptions,
} from '../../admin/adminHelpers'
import { formatTime } from '../../utils/format'

const semesterOptions = [
  { label: '1st Semester', value: 'FIRST' },
  { label: '2nd Semester', value: 'SECOND' },
  { label: 'Summer', value: 'SUMMER' },
]

export function AdminClassesPage({
  api,
  data,
  refresh,
}: {
  api: AuthedRequest
  data: WorkspaceData
  refresh: () => Promise<void>
}) {
  const schoolYearOptions = toOptions(
    data.schoolYears,
    (year) => year.id,
    (year) => year.name,
  )
  const termOptions = toOptions(data.terms, (term) => term.id, (term) => term.name)
  const subjectOptions = toOptions(
    data.subjects,
    (subject) => subject.id,
    (subject) => `${subject.code} ${subject.name}`,
  )

  return (
    <Page>
      <PageHeader
        eyebrow="Academic structure"
        title="Classes"
        description="Manage subjects, academic years, terms, and class schedules."
      />

      <AdminResourcePanel<Subject>
        api={api}
        columns={[
          { header: 'Code', render: (subject) => subject.code },
          { header: 'Name', render: (subject) => subject.name },
          { header: 'Active', render: (subject) => booleanLabel(subject.is_active) },
        ]}
        endpoint="/subjects/subjects/"
        fields={subjectFields}
        getSearchText={(subject) =>
          `${subject.code} ${subject.name} ${subject.description}`
        }
        items={data.subjects}
        noun="Subject"
        onRefresh={refresh}
        title="Subjects"
      />

      <AdminResourcePanel<SchoolYear>
        api={api}
        columns={[
          { header: 'School year', render: (year) => year.name },
          { header: 'Start', render: (year) => year.start_year },
          { header: 'End', render: (year) => year.end_year },
          { header: 'Active', render: (year) => booleanLabel(year.is_active) },
        ]}
        endpoint="/subjects/school-years/"
        fields={schoolYearFields}
        getSearchText={(year) => year.name}
        items={data.schoolYears}
        noun="School year"
        onRefresh={refresh}
        title="School Years"
      />

      <AdminResourcePanel<SchoolYearSemester>
        api={api}
        columns={[
          { header: 'Term', render: (term) => term.name },
          { header: 'Semester', render: (term) => term.semester_display },
          { header: 'Year', render: (term) => term.school_year_name },
          { header: 'Active', render: (term) => booleanLabel(term.is_active) },
        ]}
        endpoint="/subjects/school-year-semesters/"
        fields={termFields(schoolYearOptions)}
        getSearchText={(term) => `${term.name} ${term.school_year_name}`}
        items={data.terms}
        noun="Term"
        onRefresh={refresh}
        title="Terms"
      />

      <AdminResourcePanel<SubjectSchedule>
        api={api}
        columns={[
          {
            header: 'Subject',
            render: (schedule) => subjectName(data.subjects, schedule.subject),
          },
          { header: 'Section', render: (schedule) => schedule.section || 'None' },
          { header: 'Days', render: (schedule) => schedule.days },
          {
            header: 'Time',
            render: (schedule) =>
              `${formatTime(schedule.start_time)} - ${formatTime(schedule.end_time)}`,
          },
          { header: 'Active', render: (schedule) => booleanLabel(schedule.is_active) },
        ]}
        endpoint="/subjects/subject-schedules/"
        fields={scheduleFields(subjectOptions, termOptions)}
        getSearchText={(schedule) =>
          `${schedule.subject_code} ${schedule.subject_name} ${schedule.section} ${schedule.days} ${schedule.room}`
        }
        items={data.schedules}
        noun="Schedule"
        onRefresh={refresh}
        title="Subject Schedules"
      />
    </Page>
  )
}

const subjectFields: AdminField<Subject>[] = [
  { label: 'Code', name: 'code', required: true, type: 'text' },
  { label: 'Name', name: 'name', required: true, type: 'text' },
  { label: 'Description', name: 'description', rows: 3, type: 'textarea' },
  {
    defaultValue: true,
    label: 'Active',
    name: 'is_active',
    type: 'checkbox',
  },
]

const schoolYearFields: AdminField<SchoolYear>[] = [
  { label: 'Start year', name: 'start_year', required: true, type: 'number' },
  { label: 'End year', name: 'end_year', required: true, type: 'number' },
  {
    defaultValue: true,
    label: 'Active',
    name: 'is_active',
    type: 'checkbox',
  },
]

function termFields(schoolYearOptions: { label: string; value: number | string }[]) {
  return [
    {
      label: 'School year',
      name: 'school_year',
      options: schoolYearOptions,
      parse: Number,
      required: true,
      type: 'select',
    },
    {
      defaultValue: 'FIRST',
      label: 'Semester',
      name: 'semester',
      options: semesterOptions,
      required: true,
      type: 'select',
    },
    {
      defaultValue: true,
      label: 'Active',
      name: 'is_active',
      type: 'checkbox',
    },
  ] satisfies AdminField<SchoolYearSemester>[]
}

function scheduleFields(
  subjectOptions: { label: string; value: number | string }[],
  termOptions: { label: string; value: number | string }[],
) {
  return [
    {
      label: 'Subject',
      name: 'subject',
      options: subjectOptions,
      parse: Number,
      required: true,
      type: 'select',
    },
    {
      label: 'Term',
      name: 'school_year_semester',
      options: termOptions,
      parse: Number,
      required: true,
      type: 'select',
    },
    { label: 'Days', name: 'days', placeholder: 'MWF', required: true, type: 'text' },
    { label: 'Start time', name: 'start_time', required: true, type: 'time' },
    { label: 'End time', name: 'end_time', required: true, type: 'time' },
    { label: 'Section', name: 'section', type: 'text' },
    { label: 'Room', name: 'room', type: 'text' },
    {
      defaultValue: true,
      label: 'Active',
      name: 'is_active',
      type: 'checkbox',
    },
  ] satisfies AdminField<SubjectSchedule>[]
}
