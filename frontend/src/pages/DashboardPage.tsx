import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import type { AuthedRequest } from '../app/types'
import type { Module, ModuleActivity, User } from '../types'
import dashboardJourney from '../assets/aralforge-dashboard-journey.webp'
import { Icon } from '../components/Icon'
import { InlineMarkdown } from '../components/RichLessonText'
import { EmptyState, Page, SectionHeading, SkeletonList, StatCard, StatusBanner } from '../components/ui'
import { queryKeys } from '../queries/queryKeys'
import { activityTypeLabel, greeting } from '../utils/student'

type LearningContext = {
  type: 'CLASS' | 'PERSONAL'
  schedule?: number
  schedule_display?: string
  term_name?: string
}

type DashboardModule = Pick<Module, 'id' | 'title' | 'description' | 'is_accessible' | 'access_status'> & {
  learning_contexts: LearningContext[]
}

type StudentDashboard = {
  role: 'student'
  metrics: {
    module_count: number; completed_modules: number; pending_activities: number
    submitted_activities: number
    total_points: number; earned_badges: number
  }
  recent_modules: DashboardModule[]
  upcoming_activities: Array<Pick<ModuleActivity, 'id' | 'title' | 'activity_type'>>
}

export function DashboardPage({ api, currentUser }: { api: AuthedRequest; currentUser: User }) {
  const navigate = useNavigate()
  const [contextModule, setContextModule] = useState<DashboardModule | null>(null)
  const dashboard = useQuery({
    queryKey: queryKeys.dashboard,
    queryFn: ({ signal }) => api<StudentDashboard>('/overview/dashboard/', { signal }),
    staleTime: 30_000,
  })

  if (dashboard.isPending) return <Page><SkeletonList count={4} /></Page>
  if (dashboard.error || !dashboard.data) return <Page><StatusBanner tone="warning" title="Dashboard could not load" message="Retry the dashboard request." /></Page>
  const { metrics, recent_modules: modules, upcoming_activities: activities } = dashboard.data
  const continueModule = modules.find((module) => module.is_accessible && module.learning_contexts.length > 0)
  const continueTarget = continueModule?.learning_contexts.length === 1
    ? moduleTarget(continueModule, continueModule.learning_contexts[0])
    : null

  return <Page className="student-dashboard">
    <section className="dashboard-hero">
      <img
        src={dashboardJourney}
        alt="An open book connecting ideas and a rising learning path."
        decoding="async"
        fetchPriority="high"
        height="800"
        width="1600"
      />
      <div className="dashboard-hero__content">
        <p className="eyebrow">Today in AralForge</p><h1>{greeting(currentUser)}</h1>
        <p>Pick up your modules and activities where you left off.</p>
        <div className="hero-actions">
          {continueTarget ? <Link className="button button--primary" to={continueTarget}><Icon name="book" /><span>Continue learning</span></Link>
            : continueModule ? <button className="button button--primary" onClick={() => setContextModule(continueModule)} type="button"><Icon name="book" /><span>Continue learning</span></button>
              : <Link className="button button--primary" to="/modules"><Icon name="book" /><span>Continue learning</span></Link>}
          <span className="dashboard-hero__destination">{continueModule ? `Opens ${continueModule.title}` : 'Browse your modules'}</span>
        </div>
      </div>
    </section>
    <section className="stat-grid" aria-label="Learning summary">
      <StatCard icon="module" label={metrics.module_count === 1 ? 'Module available' : 'Modules available'} value={metrics.module_count} detail={`${metrics.completed_modules} completed`} />
      <StatCard icon="activity" label={metrics.pending_activities === 1 ? 'Activity to submit' : 'Activities to submit'} value={metrics.pending_activities} detail={`${metrics.submitted_activities} ${metrics.submitted_activities === 1 ? 'activity' : 'activities'} submitted`} />
    </section>
    <section className="content-grid content-grid--dashboard">
      <div className="section-block"><SectionHeading action={<Link to="/modules">View all</Link>} subtitle="Your recently updated course material." title="Continue Modules" />
        <div className="card-list">{modules.length ? modules.map((module) => <DashboardModuleRow key={module.id} module={module} onChooseContext={() => setContextModule(module)} />) : <EmptyState icon="book" title="No modules yet" message="Published modules will appear here." />}</div>
      </div>
      <div className="section-block"><SectionHeading action={<Link to="/modules">Open modules</Link>} subtitle="Unsubmitted work from your active modules." title="Upcoming Work" />
        <div className="timeline-list">{activities.length ? activities.map((activity) => <article aria-label={`Open ${activity.title}`} className="timeline-item" key={activity.id} onClick={(event) => navigateDashboardActivity(event, navigate, `/activities/${activity.id}`)} onKeyDown={(event) => navigateDashboardActivityByKey(event, navigate, `/activities/${activity.id}`)} role="link" tabIndex={0}><span className="timeline-dot"><Icon name="activity" /></span><span className="timeline-item__body"><span className="timeline-item__title">{activity.activity_type === 'INTERACTIVE' ? <InlineMarkdown value={activity.title} /> : activity.title}</span><small>{activityTypeLabel(activity.activity_type)} · Not submitted</small></span><span className="timeline-item__action">Open <Icon name="arrow-right" /></span></article>) : <EmptyState icon="check" title="Nothing pending" message="All visible activities have a submission." />}</div>
      </div>
    </section>
    {contextModule ? <DashboardContextDialog module={contextModule} onClose={() => setContextModule(null)} onChoose={(context) => navigate(moduleTarget(contextModule, context))} /> : null}
  </Page>
}

function DashboardModuleRow({ module, onChooseContext }: { module: DashboardModule; onChooseContext: () => void }) {
  const content = <><span><strong>{module.title}</strong><small>{module.description || 'Learning module'}</small></span><Icon name="arrow-right" /></>
  if (!module.is_accessible) return <Link className="module-row" to="/modules">{content}</Link>
  if (!module.learning_contexts.length) return <Link className="module-row" to="/modules">{content}</Link>
  if (module.learning_contexts.length === 1) return <Link className="module-row" to={moduleTarget(module, module.learning_contexts[0])}>{content}</Link>
  return <button className="module-row" onClick={onChooseContext} type="button">{content}</button>
}

function DashboardContextDialog({ module, onClose, onChoose }: { module: DashboardModule; onClose: () => void; onChoose: (context: LearningContext) => void }) {
  return <div aria-labelledby="dashboard-module-context-title" aria-modal="true" className="student-module-context-dialog" role="dialog">
    <button aria-label="Close class selection" className="student-module-context-dialog__backdrop" onClick={onClose} type="button" />
    <section className="student-module-context-dialog__panel"><div><p className="eyebrow">Choose a class</p><h2 id="dashboard-module-context-title">{module.title}</h2><p>Select the class where you want to continue this module.</p></div>
      <div className="student-module-context-dialog__choices">{module.learning_contexts.map((context) => context.type === 'CLASS' ? <button className="button button--secondary" key={context.schedule} onClick={() => onChoose(context)} type="button">{context.schedule_display} · {context.term_name}<Icon name="arrow-right" /></button> : null)}</div>
      <button className="button button--ghost" onClick={onClose} type="button">Cancel</button>
    </section>
  </div>
}

function moduleTarget(module: DashboardModule, context: LearningContext) {
  return context.type === 'CLASS' && context.schedule
    ? `/modules/${module.id}?schedule=${context.schedule}`
    : `/modules/${module.id}?context=PERSONAL`
}

function navigateDashboardActivity(event: React.MouseEvent<HTMLElement>, navigate: ReturnType<typeof useNavigate>, to: string) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || (event.target instanceof Element && event.target.closest('a'))) return
  navigate(to)
}

function navigateDashboardActivityByKey(event: React.KeyboardEvent<HTMLElement>, navigate: ReturnType<typeof useNavigate>, to: string) {
  if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return
  event.preventDefault()
  navigate(to)
}
