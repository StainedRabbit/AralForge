import { useParams } from 'react-router-dom'
import type { AuthedRequest, RouteData } from '../app/types'
import { ModuleSubmissionForm } from '../components/activityForms'
import { Icon } from '../components/Icon'
import { MetaStrip, NotFoundState, Page, PageHeader, SectionHeading } from '../components/ui'
import { activityTypeLabel, hasActiveModuleAccess } from '../utils/student'
import { formatDateTime, numeric } from '../utils/format'

export function ActivityDetailPage({
  api,
  data,
  refresh,
}: {
  api: AuthedRequest
  data: RouteData
  refresh: () => Promise<void>
}) {
  const { activityId } = useParams()
  const activity = data.activities.find((item) => item.id === Number(activityId))

  if (!activity) {
    return (
      <Page>
        <NotFoundState
          message="Choose an activity from a module to submit work."
          to="/modules"
        />
      </Page>
    )
  }

  const module = data.modules.find((item) => item.id === activity.module)

  if (module && !hasActiveModuleAccess(data, module)) {
    return (
      <Page>
        <NotFoundState
          message="This activity is not available for your active classes."
          to="/modules"
        />
      </Page>
    )
  }

  const existingSubmission = data.submissions.find(
    (submission) => submission.activity === activity.id,
  )

  return (
    <Page>
      <PageHeader
        eyebrow={activityTypeLabel(activity.activity_type)}
        title={activity.title}
        description={module ? module.title : 'Module activity'}
        actions={
          existingSubmission ? (
            <span className="status-pill status-pill--success">
              <Icon name="check" />
              Submitted
            </span>
          ) : null
        }
      />

      <section className="content-grid">
        <article className="reading-panel">
          <SectionHeading
            subtitle={`${numeric(activity.points_possible)} points possible`}
            title="Instructions"
          />
          <div className="rich-text">
            {activity.instructions.split('\n').map((paragraph) =>
              paragraph.trim() ? <p key={paragraph}>{paragraph}</p> : null,
            )}
          </div>
          <MetaStrip
            items={[
              ['Due', activity.due_at ? formatDateTime(activity.due_at) : 'No due date'],
              ['Text', activity.accepts_text ? 'Accepted' : 'Off'],
              ['File', activity.accepts_file ? 'Accepted' : 'Off'],
            ]}
          />
        </article>

        <aside className="section-block">
          <ModuleSubmissionForm
            activity={activity}
            api={api}
            currentUser={data.currentUser}
            existingSubmission={existingSubmission}
            onSubmitted={refresh}
          />
        </aside>
      </section>
    </Page>
  )
}
