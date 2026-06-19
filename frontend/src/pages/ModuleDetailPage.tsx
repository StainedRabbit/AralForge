import { Link, useParams } from 'react-router-dom'
import { ActivityCard } from '../components/cards'
import { Icon } from '../components/Icon'
import { EmptyState, NotFoundState, Page, PageHeader, SectionHeading } from '../components/ui'
import type { WorkspaceData } from '../app/types'
import { getModuleActivities, hasActiveModuleAccess, moduleAccessLabel } from '../utils/student'
import { resolveMediaUrl } from '../utils/format'

export function ModuleDetailPage({ data }: { data: WorkspaceData }) {
  const { moduleId } = useParams()
  const module = data.modules.find((item) => item.id === Number(moduleId))

  if (!module || !hasActiveModuleAccess(data, module)) {
    return (
      <Page>
        <NotFoundState
          message="This module is not available for your active classes."
          to="/modules"
        />
      </Page>
    )
  }

  const activities = getModuleActivities(data, module.id)
  const subjects = module.subjects
    .map((id) => data.subjects.find((subject) => subject.id === id))
    .filter(Boolean)
  const lessonSections = getLessonSections(module)
  const mockAssessments = data.assessments.filter(
    (assessment) =>
      (assessment.kind === 'MOCK_EXAM' || assessment.kind === 'MOCK_QUIZ') &&
      data.questions.some(
        (question) =>
          question.assessment === assessment.id &&
          question.topics.includes(module.id),
      ),
  )

  return (
    <Page>
      <PageHeader
        eyebrow={subjects.map((subject) => subject?.code).join(' / ') || 'Module'}
        title={module.title}
        description={module.description || 'Learning module'}
        actions={
          <>
            <span
              className={
                module.is_accessible
                  ? 'status-pill status-pill--success'
                  : 'status-pill'
              }
            >
              <Icon name={module.is_paid ? 'shield' : 'spark'} />
              {moduleAccessLabel(data, module)}
            </span>
            {module.pdf_file ? (
              <a
                className="button button--secondary"
                href={resolveMediaUrl(module.pdf_file)}
                rel="noreferrer"
                target="_blank"
              >
                <Icon name="file" />
                <span>Open PDF</span>
              </a>
            ) : null}
          </>
        }
      />

      <section className="content-grid">
        <article className="reading-panel">
          <SectionHeading
            subtitle="Teacher-ready lesson material from your backend."
            title="Lesson Material"
          />
          {lessonSections.length ? (
            <div className="lesson-material">
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
              message="Add objectives, discussion, examples, and resources in the module editor."
            />
          )}
        </article>

        <aside className="section-block">
          <SectionHeading subtitle="Printable and linked materials" title="Resources" />
          <div className="card-list lesson-side-list">
            {module.pdf_file ? (
              <a
                className="resource-row"
                href={resolveMediaUrl(module.pdf_file)}
                rel="noreferrer"
                target="_blank"
              >
                <span className="resource-row__icon">
                  <Icon name="file" />
                </span>
                <div>
                  <strong>Printable lesson PDF</strong>
                  <span>Open or download for printing</span>
                </div>
              </a>
            ) : (
              <div className="lesson-side-note">No printable PDF attached yet.</div>
            )}
            {mockAssessments.map((assessment) => (
              <Link
                className="resource-row"
                key={assessment.id}
                to={`/assessments/${assessment.id}`}
              >
                <span className="resource-row__icon">
                  <Icon name="assessment" />
                </span>
                <div>
                  <strong>{assessment.title}</strong>
                  <span>{assessment.kind}</span>
                </div>
              </Link>
            ))}
          </div>

          <SectionHeading
            subtitle={`${activities.length} activity${activities.length === 1 ? '' : 'ies'}`}
            title="Activity Path"
          />
          <div className="card-list">
            {activities.length ? (
              activities.map((activity) => (
                <ActivityCard activity={activity} data={data} key={activity.id} />
              ))
            ) : (
              <EmptyState
                icon="activity"
                title="No activities"
                message="Activities linked to this module will appear here."
              />
            )}
          </div>
        </aside>
      </section>
    </Page>
  )
}

function getLessonSections(module: {
  content: string
  detailed_discussion: string
  examples: string
  learning_objectives: string
  lesson_overview: string
  resources: string
  student_activities: string
  teacher_notes: string
}) {
  const sections = [
    ['Learning Objectives', module.learning_objectives],
    ['Lesson Overview', module.lesson_overview],
    ['Detailed Discussion', module.detailed_discussion],
    ['Examples', module.examples],
    ['Teacher Notes / Guide', module.teacher_notes],
    ['Student Activities', module.student_activities],
    ['Resources / References', module.resources],
  ]
    .filter(([, content]) => content.trim())
    .map(([title, content]) => ({ title, content }))

  if (sections.length || !module.content.trim()) {
    return sections
  }

  return [{ title: 'Lesson Notes', content: module.content }]
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
