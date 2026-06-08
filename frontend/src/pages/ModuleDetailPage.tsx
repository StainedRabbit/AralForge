import { useParams } from 'react-router-dom'
import { ActivityCard } from '../components/cards'
import { Icon } from '../components/Icon'
import { EmptyState, NotFoundState, Page, PageHeader, SectionHeading } from '../components/ui'
import type { WorkspaceData } from '../app/types'
import { getModuleActivities, moduleAccessLabel } from '../utils/student'
import { resolveMediaUrl } from '../utils/format'

export function ModuleDetailPage({ data }: { data: WorkspaceData }) {
  const { moduleId } = useParams()
  const module = data.modules.find((item) => item.id === Number(moduleId))

  if (!module) {
    return (
      <Page>
        <NotFoundState
          message="This module is not available in the current API response."
          to="/modules"
        />
      </Page>
    )
  }

  const activities = getModuleActivities(data, module.id)
  const subjects = module.subjects
    .map((id) => data.subjects.find((subject) => subject.id === id))
    .filter(Boolean)

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
            subtitle="Module content from your backend."
            title="Lesson Notes"
          />
          {module.content ? (
            <div className="rich-text">
              {module.content.split('\n').map((paragraph) =>
                paragraph.trim() ? <p key={paragraph}>{paragraph}</p> : null,
              )}
            </div>
          ) : (
            <EmptyState
              icon="book"
              title="No notes yet"
              message="Add module content in Django admin or your teacher tools."
            />
          )}
        </article>

        <aside className="section-block">
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
