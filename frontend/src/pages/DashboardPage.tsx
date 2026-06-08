import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import type { WorkspaceData } from '../app/types'
import heroImage from '../assets/academic-dashboard.png'
import { ActivityTimelineItem, ModuleRow } from '../components/cards'
import { Icon } from '../components/Icon'
import { EmptyState, Page, SectionHeading, SkeletonList, StatCard } from '../components/ui'
import { buildDashboardMetrics, compareActivitiesByDueDate, greeting, hasSubmission } from '../utils/student'

export function DashboardPage({
  data,
  refresh,
}: {
  data: WorkspaceData & { refresh: () => Promise<void> }
  refresh: () => Promise<void>
}) {
  const dashboard = useMemo(() => buildDashboardMetrics(data), [data])
  const nextActivities = useMemo(
    () =>
      data.activities
        .filter((activity) => !hasSubmission(data, activity.id))
        .sort(compareActivitiesByDueDate)
        .slice(0, 5),
    [data],
  )
  const recentModules = data.modules.slice(0, 4)

  return (
    <Page>
      <section className="dashboard-hero">
        <img src={heroImage} alt="" />
        <div className="dashboard-hero__content">
          <p className="eyebrow">Today in Ezoryx</p>
          <h1>{greeting(data.currentUser)}</h1>
          <p>
            Keep your modules, coding work, assessments, and grades moving from
            one focused academic workspace.
          </p>
          <div className="hero-actions">
            <Link className="button button--primary" to="/modules">
              <Icon name="book" />
              <span>Continue learning</span>
            </Link>
            <button className="button button--ghost" onClick={refresh} type="button">
              <Icon name="spark" />
              <span>Refresh</span>
            </button>
          </div>
        </div>
      </section>

      <section className="stat-grid" aria-label="Learning summary">
        <StatCard
          icon="module"
          label="Published modules"
          value={dashboard.moduleCount}
          detail={`${dashboard.completedModules} completed`}
        />
        <StatCard
          icon="activity"
          label="Pending activities"
          value={dashboard.pendingActivities}
          detail={`${dashboard.submittedActivities} submitted`}
        />
        <StatCard
          icon="code"
          label="Coding problems"
          value={dashboard.problemCount}
          detail={`${dashboard.blankCount} fill blanks`}
        />
        <StatCard
          icon="award"
          label="Total points"
          value={dashboard.totalPoints}
          detail={`${data.studentBadges.length} earned badges`}
        />
      </section>

      <section className="content-grid content-grid--dashboard">
        <div className="section-block">
          <SectionHeading
            action={<Link to="/modules">View all</Link>}
            subtitle="Course material from the Django modules API."
            title="Continue Modules"
          />
          <div className="card-list">
            {data.loading ? (
              <SkeletonList count={3} />
            ) : recentModules.length ? (
              recentModules.map((module) => (
                <ModuleRow data={data} key={module.id} module={module} />
              ))
            ) : (
              <EmptyState
                icon="book"
                title="No modules yet"
                message="Published modules from your backend will appear here."
              />
            )}
          </div>
        </div>

        <div className="section-block">
          <SectionHeading
            action={<Link to="/modules">Open modules</Link>}
            subtitle="Unsubmitted work sorted by due date."
            title="Upcoming Work"
          />
          <div className="timeline-list">
            {data.loading ? (
              <SkeletonList count={4} />
            ) : nextActivities.length ? (
              nextActivities.map((activity) => (
                <ActivityTimelineItem
                  activity={activity}
                  data={data}
                  key={activity.id}
                />
              ))
            ) : (
              <EmptyState
                icon="check"
                title="Nothing pending"
                message="All visible activities have a submission."
              />
            )}
          </div>
        </div>
      </section>
    </Page>
  )
}
