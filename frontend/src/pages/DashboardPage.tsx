import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import type { AuthedRequest } from '../app/types'
import type { Module, User } from '../types'
import dashboardJourney from '../assets/aralforge-dashboard-journey.webp'
import { Icon } from '../components/Icon'
import { EmptyState, Page, SectionHeading, SkeletonList, StatCard, StatusBanner } from '../components/ui'
import { queryKeys } from '../queries/queryKeys'
import { greeting } from '../utils/student'

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
  personal_quizzes: Array<{
    id: number
    title: string
    module_id: number
    module_title: string
    topic_id: number
    lesson_id: number
    lesson_title: string
  }>
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
  const { metrics, recent_modules: modules, personal_quizzes: quizzes } = dashboard.data
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
        <p>Pick up your modules or jump into a Personal Study quiz.</p>
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
      <div className="section-block"><SectionHeading action={<Link to="/modules">Open modules</Link>} subtitle="Quizzes in modules available for Personal Study." title="Personal Study Quizzes" />
        <div className="card-list">{quizzes.length ? quizzes.map((quiz) => <Link className="module-row" key={quiz.id} to={personalStudyQuizTarget(quiz)}><span><strong>{quiz.title}</strong><small>{quiz.module_title} / {quiz.lesson_title}</small></span><span className="dashboard-quiz-link__action">Open quiz <Icon name="arrow-right" /></span></Link>) : <EmptyState icon="activity" title="No Personal Study quizzes" message="Quizzes from eligible modules will appear here." />}</div>
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

function personalStudyQuizTarget(quiz: StudentDashboard['personal_quizzes'][number]) {
  const params = new URLSearchParams({
    topic: String(quiz.topic_id),
    lesson: String(quiz.lesson_id),
    context: 'PERSONAL',
  })
  return `/modules/${quiz.module_id}?${params.toString()}#main-activity`
}
