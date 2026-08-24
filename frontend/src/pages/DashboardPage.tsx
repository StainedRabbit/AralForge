import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import type { AuthedRequest } from '../app/types'
import type { Module, ModuleActivity, User } from '../types'
import dashboardJourney from '../assets/aralforge-dashboard-journey.webp'
import { Icon } from '../components/Icon'
import { EmptyState, Page, SectionHeading, SkeletonList, StatCard, StatusBanner } from '../components/ui'
import { queryKeys } from '../queries/queryKeys'
import { formatDateTime } from '../utils/format'
import { greeting } from '../utils/student'

type StudentDashboard = {
  role: 'student'
  metrics: {
    module_count: number; completed_modules: number; pending_activities: number
    submitted_activities: number; problem_count: number; blank_count: number
    total_points: number; earned_badges: number
  }
  recent_modules: Module[]
  upcoming_activities: ModuleActivity[]
}

export function DashboardPage({ api, currentUser }: { api: AuthedRequest; currentUser: User }) {
  const dashboard = useQuery({
    queryKey: queryKeys.dashboard,
    queryFn: ({ signal }) => api<StudentDashboard>('/overview/dashboard/', { signal }),
    staleTime: 30_000,
  })

  if (dashboard.isPending) return <Page><SkeletonList count={4} /></Page>
  if (dashboard.error || !dashboard.data) return <Page><StatusBanner tone="warning" title="Dashboard could not load" message="Retry the dashboard request." /></Page>
  const { metrics, recent_modules: modules, upcoming_activities: activities } = dashboard.data

  return <Page>
    <section className="dashboard-hero">
      <img
        src={dashboardJourney}
        alt="An open book connecting code, ideas, and a rising learning path."
        decoding="async"
        fetchPriority="high"
        height="800"
        width="1600"
      />
      <div className="dashboard-hero__content">
        <p className="eyebrow">Today in AralForge</p><h1>{greeting(currentUser)}</h1>
        <p>Keep your modules, coding work, assessments, and grades moving from one focused academic workspace.</p>
        <div className="hero-actions">
          <Link className="button button--primary" to="/modules"><Icon name="book" /><span>Continue learning</span></Link>
          <button className="button button--ghost" onClick={() => dashboard.refetch()} type="button"><Icon name="spark" /><span>Refresh</span></button>
        </div>
      </div>
    </section>
    <section className="stat-grid" aria-label="Learning summary">
      <StatCard icon="module" label="Published modules" value={metrics.module_count} detail={`${metrics.completed_modules} completed`} />
      <StatCard icon="activity" label="Pending activities" value={metrics.pending_activities} detail={`${metrics.submitted_activities} submitted`} />
      <StatCard icon="code" label="Coding problems" value={metrics.problem_count} detail={`${metrics.blank_count} fill blanks`} />
      <StatCard icon="award" label="Total points" value={metrics.total_points} detail={`${metrics.earned_badges} earned badges`} />
    </section>
    <section className="content-grid content-grid--dashboard">
      <div className="section-block"><SectionHeading action={<Link to="/modules">View all</Link>} subtitle="Your recently updated course material." title="Continue Modules" />
        <div className="card-list">{modules.length ? modules.map((module) => <Link className="module-row" key={module.id} to={`/modules/${module.id}`}><span><strong>{module.title}</strong><small>{module.description || 'Learning module'}</small></span><Icon name="arrow-right" /></Link>) : <EmptyState icon="book" title="No modules yet" message="Published modules will appear here." />}</div>
      </div>
      <div className="section-block"><SectionHeading action={<Link to="/modules">Open modules</Link>} subtitle="Unsubmitted work sorted by due date." title="Upcoming Work" />
        <div className="timeline-list">{activities.length ? activities.map((activity) => <Link className="timeline-item" key={activity.id} to={`/activities/${activity.id}`}><span className="timeline-dot"><Icon name="activity" /></span><span><strong>{activity.title}</strong><small>{activity.due_at ? formatDateTime(activity.due_at) : 'No due date'}</small></span></Link>) : <EmptyState icon="check" title="Nothing pending" message="All visible activities have a submission." />}</div>
      </div>
    </section>
  </Page>
}
