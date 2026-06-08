import type { AuthedRequest, WorkspaceData } from '../../app/types'
import {
  AdminResourcePanel,
  type AdminField,
} from '../../components/admin/AdminResourcePanel'
import { Page, PageHeader } from '../../components/ui'
import type {
  Module,
  ModuleActivity,
  ModuleActivitySubmission,
  ModuleProgress,
} from '../../types'
import {
  activitySummary,
  activityTypeOptions,
  booleanLabel,
  compactDateTime,
  moduleName,
  money,
  problemName,
  subjectName,
  studentUsers,
  toOptions,
  userName,
} from '../../admin/adminHelpers'
import { formatDateTime, numeric } from '../../utils/format'

export function AdminModulesPage({
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
  const moduleOptions = toOptions(
    data.modules,
    (module) => module.id,
    (module) => module.title,
  )
  const problemOptions = toOptions(
    data.problems,
    (problem) => problem.id,
    (problem) => problem.title,
  )
  const activityOptions = toOptions(
    data.activities,
    (activity) => activity.id,
    (activity) => activity.title,
  )
  const studentOptions = toOptions(studentUsers(data.users), (user) => user.id, userNameFromItem)

  return (
    <Page>
      <PageHeader
        eyebrow="Learning content"
        title="Modules"
        description="Create paid or free modules, publish activities, and grade submitted module work."
      />

      <AdminResourcePanel<Module>
        api={api}
        columns={[
          { header: 'Title', render: (module) => module.title },
          {
            header: 'Subjects',
            render: (module) =>
              module.subjects
                .map((subject) => subjectName(data.subjects, subject))
                .join(', ') || 'General',
          },
          { header: 'Price', render: (module) => money(module.price) },
          { header: 'Published', render: (module) => booleanLabel(module.is_published) },
        ]}
        endpoint="/modules/modules/"
        fields={moduleFields(subjectOptions)}
        getSearchText={(module) =>
          `${module.title} ${module.slug} ${module.description} ${module.content}`
        }
        items={data.modules}
        noun="Module"
        onRefresh={refresh}
        title="Modules"
      />

      <AdminResourcePanel<ModuleActivity>
        api={api}
        columns={[
          { header: 'Activity', render: (activity) => activity.title },
          { header: 'Module', render: (activity) => moduleName(data.modules, activity.module) },
          { header: 'Type', render: (activity) => activitySummary(activity) },
          {
            header: 'Problem',
            render: (activity) =>
              problemName(data.problems, activity.programming_problem),
          },
          { header: 'Published', render: (activity) => booleanLabel(activity.is_published) },
        ]}
        endpoint="/modules/activities/"
        fields={activityFields(moduleOptions, problemOptions)}
        getSearchText={(activity) =>
          `${activity.title} ${activity.instructions} ${activity.activity_type}`
        }
        items={data.activities}
        noun="Activity"
        onRefresh={refresh}
        title="Module Activities"
      />

      <AdminResourcePanel<ModuleActivitySubmission>
        api={api}
        columns={[
          {
            header: 'Student',
            render: (submission) => userName(data.users, submission.student),
          },
          {
            header: 'Activity',
            render: (submission) =>
              data.activities.find((activity) => activity.id === submission.activity)
                ?.title ?? 'Activity',
          },
          {
            header: 'Submitted',
            render: (submission) => formatDateTime(submission.submitted_at),
          },
          {
            header: 'Score',
            render: (submission) =>
              submission.score === null ? 'Pending' : numeric(submission.score),
          },
          {
            header: 'Graded',
            render: (submission) => compactDateTime(submission.graded_at),
          },
        ]}
        endpoint="/modules/submissions/"
        fields={submissionFields(activityOptions, studentOptions)}
        getSearchText={(submission) =>
          `${submission.text_answer} ${submission.code} ${submission.feedback}`
        }
        items={data.submissions}
        noun="Submission"
        onRefresh={refresh}
        title="Module Submission Grading"
      />

      <AdminResourcePanel<ModuleProgress>
        api={api}
        columns={[
          { header: 'Student', render: (progress) => userName(data.users, progress.student) },
          { header: 'Module', render: (progress) => moduleName(data.modules, progress.module) },
          { header: 'Started', render: (progress) => formatDateTime(progress.started_at) },
          { header: 'Completed', render: (progress) => compactDateTime(progress.completed_at) },
        ]}
        endpoint="/modules/progress/"
        fields={progressFields(moduleOptions, studentOptions)}
        getSearchText={(progress) =>
          `${userName(data.users, progress.student)} ${moduleName(data.modules, progress.module)}`
        }
        items={data.progress}
        noun="Progress"
        onRefresh={refresh}
        title="Module Progress"
      />
    </Page>
  )
}

function userNameFromItem(user: { first_name: string; last_name: string; username: string }) {
  return [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username
}

function moduleFields(subjectOptions: { label: string; value: number | string }[]) {
  return [
    { label: 'Title', name: 'title', required: true, type: 'text' },
    { label: 'Slug', name: 'slug', required: true, type: 'text' },
    { label: 'Description', name: 'description', rows: 3, type: 'textarea' },
    { label: 'Content', name: 'content', rows: 8, type: 'textarea' },
    { label: 'PDF file', name: 'pdf_file', type: 'file' },
    {
      defaultValue: true,
      label: 'Paid module',
      name: 'is_paid',
      type: 'checkbox',
    },
    { defaultValue: '0.00', label: 'Price', name: 'price', type: 'number' },
    {
      label: 'Subjects',
      name: 'subjects',
      options: subjectOptions,
      type: 'multiselect',
    },
    {
      defaultValue: false,
      label: 'Published',
      name: 'is_published',
      type: 'checkbox',
    },
  ] satisfies AdminField<Module>[]
}

function activityFields(
  moduleOptions: { label: string; value: number | string }[],
  problemOptions: { label: string; value: number | string }[],
) {
  return [
    {
      label: 'Module',
      name: 'module',
      options: moduleOptions,
      parse: Number,
      required: true,
      type: 'select',
    },
    {
      label: 'Programming problem',
      name: 'programming_problem',
      nullable: true,
      options: problemOptions,
      parse: (value) => (value ? Number(value) : null),
      type: 'select',
    },
    { label: 'Title', name: 'title', required: true, type: 'text' },
    { label: 'Instructions', name: 'instructions', required: true, rows: 5, type: 'textarea' },
    {
      defaultValue: 'TEXT',
      label: 'Activity type',
      name: 'activity_type',
      options: activityTypeOptions,
      required: true,
      type: 'select',
    },
    { defaultValue: '0', label: 'Order', name: 'order', type: 'number' },
    { defaultValue: '100.00', label: 'Points', name: 'points_possible', type: 'number' },
    { label: 'Due at', name: 'due_at', nullable: true, type: 'datetime-local' },
    { defaultValue: true, label: 'Accepts text', name: 'accepts_text', type: 'checkbox' },
    { defaultValue: false, label: 'Accepts file', name: 'accepts_file', type: 'checkbox' },
    { defaultValue: false, label: 'Accepts code', name: 'accepts_code', type: 'checkbox' },
    { defaultValue: false, label: 'Published', name: 'is_published', type: 'checkbox' },
  ] satisfies AdminField<ModuleActivity>[]
}

function submissionFields(
  activityOptions: { label: string; value: number | string }[],
  studentOptions: { label: string; value: number | string }[],
) {
  return [
    {
      label: 'Activity',
      name: 'activity',
      options: activityOptions,
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
    { label: 'Text answer', name: 'text_answer', rows: 4, type: 'textarea' },
    { label: 'Code', name: 'code', rows: 5, type: 'textarea' },
    { label: 'Score', name: 'score', nullable: true, type: 'number' },
    { label: 'Feedback', name: 'feedback', rows: 3, type: 'textarea' },
    { label: 'Graded at', name: 'graded_at', nullable: true, type: 'datetime-local' },
  ] satisfies AdminField<ModuleActivitySubmission>[]
}

function progressFields(
  moduleOptions: { label: string; value: number | string }[],
  studentOptions: { label: string; value: number | string }[],
) {
  return [
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
    { label: 'Completed at', name: 'completed_at', nullable: true, type: 'datetime-local' },
  ] satisfies AdminField<ModuleProgress>[]
}
