import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { AuthedRequest, WorkspaceData } from '../../app/types'
import {
  AdminResourcePanel,
  type AdminField,
} from '../../components/admin/AdminResourcePanel'
import { Icon } from '../../components/Icon'
import { EmptyState, MetaStrip, Page, PageHeader, SearchBox, SectionHeading } from '../../components/ui'
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
  problemName,
  studentUsers,
  toOptions,
  userName,
} from '../../admin/adminHelpers'
import { formatDateTime, numeric, resolveMediaUrl } from '../../utils/format'
import { getLessonSections, moduleSearchText, modulesForSubject, subjectName } from '../../utils/modules'

export function AdminModulesPage({
  api,
  data,
  refresh,
}: {
  api: AuthedRequest
  data: WorkspaceData
  refresh: () => Promise<void>
}) {
  const [searchParams, setSearchParams] = useSearchParams()
  const initialSubject = Number(searchParams.get('subject')) || data.subjects[0]?.id || null
  const initialModule = Number(searchParams.get('module')) || null
  const [selectedSubjectId, setSelectedSubjectId] = useState<number | null>(initialSubject)
  const [selectedModuleId, setSelectedModuleId] = useState<number | null>(initialModule)
  const [query, setQuery] = useState('')

  const visibleModules = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()

    return modulesForSubject(data.modules, selectedSubjectId).filter(
      (module) =>
        !normalizedQuery ||
        moduleSearchText(module).toLowerCase().includes(normalizedQuery),
    )
  }, [data.modules, query, selectedSubjectId])

  useEffect(() => {
    if (selectedSubjectId || !data.subjects.length) {
      return
    }

    setSelectedSubjectId(data.subjects[0].id)
  }, [data.subjects, selectedSubjectId])

  useEffect(() => {
    if (selectedModuleId && visibleModules.some((module) => module.id === selectedModuleId)) {
      return
    }

    setSelectedModuleId(visibleModules[0]?.id ?? null)
  }, [selectedModuleId, visibleModules])

  useEffect(() => {
    const nextParams = new URLSearchParams()
    if (selectedSubjectId) {
      nextParams.set('subject', String(selectedSubjectId))
    }
    if (selectedModuleId) {
      nextParams.set('module', String(selectedModuleId))
    }
    setSearchParams(nextParams, { replace: true })
  }, [selectedModuleId, selectedSubjectId, setSearchParams])

  const selectedModule =
    data.modules.find((module) => module.id === selectedModuleId) ?? null
  const selectedActivities = selectedModule
    ? data.activities.filter((activity) => activity.module === selectedModule.id)
    : []
  const selectedActivityIds = new Set(selectedActivities.map((activity) => activity.id))
  const selectedSubmissions = data.submissions.filter((submission) =>
    selectedActivityIds.has(submission.activity),
  )
  const selectedProgress = selectedModule
    ? data.progress.filter((progress) => progress.module === selectedModule.id)
    : []
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
    selectedActivities.length ? selectedActivities : data.activities,
    (activity) => activity.id,
    (activity) => activity.title,
  )
  const studentOptions = toOptions(studentUsers(data.users), (user) => user.id, userNameFromItem)

  return (
    <Page>
      <PageHeader
        eyebrow="Learning content"
        title="Modules"
        description="Select a subject, open a topic, and manage lesson material like a real teaching workspace."
        actions={
          <Link
            className="button button--primary"
            to={`/admin/modules/new${selectedSubjectId ? `?subject=${selectedSubjectId}` : ''}`}
          >
            <Icon name="plus" />
            <span>Create Module</span>
          </Link>
        }
      />

      <section className="module-workspace">
        <aside className="module-workspace__picker section-block">
          <SectionHeading
            subtitle={`${data.subjects.length} subject${data.subjects.length === 1 ? '' : 's'}`}
            title="Find Subject"
          />
          <label className="admin-field">
            <span>Subject</span>
            <select
              onChange={(event) => {
                setSelectedSubjectId(Number(event.target.value) || null)
                setSelectedModuleId(null)
              }}
              value={selectedSubjectId ?? ''}
            >
              {data.subjects.map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.code} - {subject.name}
                </option>
              ))}
            </select>
          </label>
          <SearchBox
            onChange={setQuery}
            placeholder="Search topics"
            value={query}
          />
          <div className="class-list">
            {visibleModules.map((module) => (
              <button
                className={
                  selectedModule?.id === module.id
                    ? 'class-list__item active'
                    : 'class-list__item'
                }
                key={module.id}
                onClick={() => setSelectedModuleId(module.id)}
                type="button"
              >
                <span className="class-list__top">
                  <strong>{module.title}</strong>
                  <small>{module.is_published ? 'Published' : 'Draft'}</small>
                </span>
                <span>{module.description || 'Lesson material'}</span>
                <small>{module.is_paid ? `Paid ${numeric(module.price).toFixed(2)}` : 'Free module'}</small>
              </button>
            ))}
            {!visibleModules.length ? (
              <p className="admin-empty-line">No topics found for this subject.</p>
            ) : null}
          </div>
        </aside>

        <main className="module-workspace__main section-block">
          {selectedModule ? (
            <ModulePreview
              activities={selectedActivities}
              data={data}
              module={selectedModule}
              progressCount={selectedProgress.length}
              submissionCount={selectedSubmissions.length}
              subjectId={selectedSubjectId}
            />
          ) : (
            <EmptyState
              icon="book"
              title="No topic selected"
              message="Create a module or choose a subject with existing topics."
            />
          )}
        </main>
      </section>

      {selectedModule ? (
        <section className="module-context-grid">
          <AdminResourcePanel<ModuleActivity>
            api={api}
            columns={[
              { header: 'Activity', render: (activity) => activity.title },
              { header: 'Type', render: (activity) => activitySummary(activity) },
              {
                header: 'Problem',
                render: (activity) =>
                  problemName(data.problems, activity.programming_problem),
              },
              { header: 'Published', render: (activity) => booleanLabel(activity.is_published) },
            ]}
            endpoint="/modules/activities/"
            fields={activityFields(moduleOptions, problemOptions, selectedModule.id)}
            getSearchText={(activity) =>
              `${activity.title} ${activity.instructions} ${activity.activity_type}`
            }
            items={selectedActivities}
            key={`activities-${selectedModule.id}`}
            noun="Activity"
            onRefresh={refresh}
            title="Topic Activities"
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
            items={selectedSubmissions}
            key={`submissions-${selectedModule.id}`}
            noun="Submission"
            onRefresh={refresh}
            title="Submission Grading"
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
            fields={progressFields(moduleOptions, studentOptions, selectedModule.id)}
            getSearchText={(progress) =>
              `${userName(data.users, progress.student)} ${moduleName(data.modules, progress.module)}`
            }
            items={selectedProgress}
            key={`progress-${selectedModule.id}`}
            noun="Progress"
            onRefresh={refresh}
            title="Topic Progress"
          />
        </section>
      ) : null}
    </Page>
  )
}

function ModulePreview({
  activities,
  data,
  module,
  progressCount,
  subjectId,
  submissionCount,
}: {
  activities: ModuleActivity[]
  data: WorkspaceData
  module: Module
  progressCount: number
  subjectId: number | null
  submissionCount: number
}) {
  const lessonSections = getLessonSections(module)

  return (
    <div className="module-preview">
      <div className="module-preview__header">
        <div>
          <p className="eyebrow">{subjectName(data, subjectId)}</p>
          <h2>{module.title}</h2>
          <p>{module.description || 'Teaching-ready lesson material'}</p>
        </div>
        <div className="module-preview__actions">
          <Link
            className="button button--secondary"
            to={`/admin/modules/${module.id}/edit${subjectId ? `?subject=${subjectId}` : ''}`}
          >
            <Icon name="edit" />
            <span>Edit</span>
          </Link>
          {module.pdf_file ? (
            <a
              className="button button--secondary"
              href={resolveMediaUrl(module.pdf_file)}
              rel="noreferrer"
              target="_blank"
            >
              <Icon name="file" />
              <span>PDF</span>
            </a>
          ) : null}
        </div>
      </div>

      <MetaStrip
        items={[
          ['Status', module.is_published ? 'Published' : 'Draft'],
          ['Access', module.is_paid ? `Paid ${numeric(module.price).toFixed(2)}` : 'Free'],
          ['Activities', String(activities.length)],
          ['Submissions', String(submissionCount)],
          ['Progress', String(progressCount)],
          ['Slug', module.slug],
        ]}
      />

      {lessonSections.length ? (
        <div className="lesson-material module-preview__lesson">
          {lessonSections.map((section) => (
            <section className="lesson-section" key={section.title}>
              <h2>{section.title}</h2>
              <RichText value={section.content} />
            </section>
          ))}
        </div>
      ) : (
        <EmptyState
          icon="book"
          title="No lesson material yet"
          message="Open the editor and add objectives, discussion, examples, and resources."
        />
      )}
    </div>
  )
}

function RichText({ value }: { value: string }) {
  return (
    <div className="rich-text">
      {value.split('\n').map((paragraph) =>
        paragraph.trim() ? <p key={paragraph}>{paragraph}</p> : null,
      )}
    </div>
  )
}

function userNameFromItem(user: { first_name: string; last_name: string; username: string }) {
  return [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username
}

function activityFields(
  moduleOptions: { label: string; value: number | string }[],
  problemOptions: { label: string; value: number | string }[],
  selectedModuleId: number,
) {
  return [
    {
      defaultValue: selectedModuleId,
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
  selectedModuleId: number,
) {
  return [
    {
      defaultValue: selectedModuleId,
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
