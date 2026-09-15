import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { AuthedRequest, RouteData } from '../app/types'
import { Icon } from '../components/Icon'
import { TopicPdfDownloads } from '../components/TopicPdfDownloads'
import { EmptyState, Page, PageHeader, SearchBox, SkeletonCard } from '../components/ui'
import type { Module, ScheduleStudent } from '../types'
import { getLessonResumeTarget, lessonResumeActionLabel, lessonSearchText, lessonsForTopic, topicOwnSearchText, topicsForModule } from '../utils/modules'
import { moduleAccessLabel, moduleSubjectLabel } from '../utils/student'

type ModuleContext = { type: 'CLASS' | 'PERSONAL'; enrollment?: ScheduleStudent }

export function ModulesPage({ api, data }: { api: AuthedRequest; data: RouteData }) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [contextModule, setContextModule] = useState<Module | null>(null)
  const publishedModules = useMemo(() => data.modules.filter((module) => module.is_published), [data.modules])
  const normalizedQuery = query.trim().toLowerCase()
  const visibleModules = useMemo(() => publishedModules.filter((module) => !normalizedQuery || moduleSearchText(data, module).includes(normalizedQuery)), [data, normalizedQuery, publishedModules])

  function contextsFor(module: Module): ModuleContext[] {
    const subjectIds = new Set([...(module.subject ? [module.subject] : []), ...module.subjects])
    const enrollments = data.enrollments.filter((enrollment) =>
      enrollment.student === data.currentUser?.id && enrollment.is_active && enrollment.schedule_is_active && enrollment.term_is_active && subjectIds.has(enrollment.subject),
    )
    if (enrollments.length) return enrollments.map((enrollment) => ({ type: 'CLASS', enrollment }))
    return module.access_status === 'ADVANCE_ACTIVE' ? [{ type: 'PERSONAL' }] : []
  }

  function targetFor(module: Module, context: ModuleContext, lesson?: { id: number; topic: number }) {
    const parameters = new URLSearchParams()
    if (lesson) { parameters.set('topic', String(lesson.topic)); parameters.set('lesson', String(lesson.id)) }
    if (context.type === 'CLASS' && context.enrollment) parameters.set('schedule', String(context.enrollment.schedule))
    else parameters.set('context', 'PERSONAL')
    return `/modules/${module.id}?${parameters.toString()}`
  }

  function openModule(module: Module) {
    const contexts = contextsFor(module)
    if (contexts.length === 1) { navigate(targetFor(module, contexts[0])); return }
    if (contexts.length > 1) setContextModule(module)
  }

  return <Page>
    <PageHeader eyebrow="Learning library" title="Modules" description="Browse the modules available to you and continue learning at your own pace." />
    {data.loading ? <div className="module-grid"><SkeletonCard /><SkeletonCard /><SkeletonCard /></div> : <section className="student-module-library">
      <div className="student-module-library__toolbar">
        <SearchBox onChange={setQuery} placeholder="Search modules, subjects, topics, or lessons" value={query} />
        <span className="student-module-library__count">{visibleModules.length} module{visibleModules.length === 1 ? '' : 's'}</span>
      </div>
      {visibleModules.length ? <div className="module-grid student-module-library__grid">
        {visibleModules.map((module) => <StudentModuleCard api={api} contexts={contextsFor(module)} data={data} key={module.id} module={module} onOpen={() => openModule(module)} targetFor={targetFor} />)}
      </div> : <EmptyState icon={publishedModules.length ? 'search' : 'module'} title={publishedModules.length ? 'No matching modules' : 'No modules available'} message={publishedModules.length ? 'Try a different module, subject, topic, or lesson search.' : 'Modules will appear here when they are available for your active classes or access grants.'} />}
    </section>}
    {contextModule ? <ClassChoiceDialog module={contextModule} contexts={contextsFor(contextModule)} onClose={() => setContextModule(null)} onChoose={(context) => navigate(targetFor(contextModule, context))} /> : null}
  </Page>
}

function StudentModuleCard({ api, data, module, contexts, onOpen, targetFor }: { api: AuthedRequest; data: RouteData; module: Module; contexts: ModuleContext[]; onOpen: () => void; targetFor: (module: Module, context: ModuleContext, lesson?: { id: number; topic: number }) => string }) {
  const topics = topicsForModule(data.moduleTopics, module.id).filter((topic) => topic.is_published)
  const lessons = topics.flatMap((topic) => lessonsForTopic(data.moduleLessons, topic.id).filter((lesson) => lesson.is_published))
  const resumeContext = contexts.length === 1 ? contexts[0] : null
  const progress = resumeContext ? data.lessonProgress.filter((item) => resumeContext.type === 'CLASS' ? item.context_type === 'CLASS' && item.schedule === resumeContext.enrollment?.schedule : item.context_type === 'PERSONAL') : []
  const resumeTarget = getLessonResumeTarget(lessons, progress, { currentUserId: data.currentUser?.id ?? null, isAccessible: module.is_accessible })
  const topicCount = module.is_accessible ? topics.length : module.downloadable_topics.length
  return <article className={`module-card student-module-card${module.is_accessible ? '' : ' student-module-card--locked'}`}>
    <div className="student-module-card__header"><span className="subject-chip">{moduleSubjectLabel(data, module)}</span><span className={module.is_accessible ? 'status-pill status-pill--success' : 'status-pill'}><Icon name="shield" /> {moduleAccessLabel(data, module)}</span></div>
    <div className="student-module-card__body"><h2>{module.title}</h2><p>{module.description || 'Published learning content is ready when you are.'}</p></div>
    <div className="student-module-card__meta"><span><Icon name="module" /> {topicCount} topic{topicCount === 1 ? '' : 's'}</span>{module.is_accessible ? <span><Icon name="book" /> {lessons.length} lesson{lessons.length === 1 ? '' : 's'}</span> : null}</div>
    {module.is_accessible ? <div className="student-module-card__actions">
      {resumeTarget && resumeContext ? <Link className="button button--primary" to={targetFor(module, resumeContext, resumeTarget.lesson)}><Icon name="arrow-right" /> {lessonResumeActionLabel(resumeTarget.mode)}</Link> : <button className="button button--primary" disabled={!contexts.length} onClick={onOpen} type="button"><Icon name="arrow-right" /> {!contexts.length ? 'No active class' : contexts.length > 1 ? 'Choose class' : 'Open module'}</button>}
    </div> : <div className="student-module-card__locked"><p>Download published topics for offline study. Ask your teacher to activate online lessons and activities.</p><TopicPdfDownloads api={api} module={module} /></div>}
  </article>
}

function ClassChoiceDialog({ module, contexts, onClose, onChoose }: { module: Module; contexts: ModuleContext[]; onClose: () => void; onChoose: (context: ModuleContext) => void }) {
  return <div aria-labelledby="module-context-title" aria-modal="true" className="student-module-context-dialog" role="dialog">
    <button aria-label="Close class selection" className="student-module-context-dialog__backdrop" onClick={onClose} type="button" />
    <section className="student-module-context-dialog__panel"><div><p className="eyebrow">Choose a class</p><h2 id="module-context-title">{module.title}</h2><p>Select the class where you want to open this module. Your progress and activities stay with that class.</p></div>
      <div className="student-module-context-dialog__choices">{contexts.map((context) => context.enrollment ? <button className="button button--secondary" key={context.enrollment.schedule} onClick={() => onChoose(context)} type="button">{context.enrollment.schedule_display} · {context.enrollment.term_name}<Icon name="arrow-right" /></button> : null)}</div>
      <button className="button button--ghost" onClick={onClose} type="button">Cancel</button>
    </section>
  </div>
}

function moduleSearchText(data: RouteData, module: Module) {
  const subjectIds = new Set([...(module.subject ? [module.subject] : []), ...module.subjects])
  const subjects = data.subjects.filter((subject) => subjectIds.has(subject.id))
  const topics = topicsForModule(data.moduleTopics, module.id).filter((topic) => topic.is_published)
  const lessons = topics.flatMap((topic) => lessonsForTopic(data.moduleLessons, topic.id).filter((lesson) => lesson.is_published))
  return [module.title, module.description, ...subjects.flatMap((subject) => [subject.code, subject.name]), ...module.downloadable_topics.map((topic) => topic.title), ...topics.map(topicOwnSearchText), ...lessons.map(lessonSearchText)].join(' ').toLowerCase()
}
