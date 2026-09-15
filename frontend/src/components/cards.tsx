import { Link, useNavigate } from 'react-router-dom'
import type { RouteData } from '../app/types'
import type { Module, ModuleActivity } from '../types'
import {
  activityTypeLabel,
  getModuleActivities,
  hasSubmission,
  moduleAccessLabel,
  moduleSubjectLabel,
} from '../utils/student'
import { dueLabel, percent } from '../utils/format'
import { Icon } from './Icon'
import { InlineMarkdown } from './RichLessonText'

export function ModuleCard({ data, module }: { data: RouteData; module: Module }) {
  const activities = getModuleActivities(data, module.id)
  const completed = Boolean(
    data.progress.find((item) => item.module === module.id && item.completed_at),
  )
  const submittedCount = activities.filter((activity) =>
    hasSubmission(data, activity.id),
  ).length

  return (
    <article className="module-card">
      <div className="module-card__top">
        <span className="subject-chip">{moduleSubjectLabel(data, module)}</span>
        <span
          className={
            module.is_accessible ? 'status-pill status-pill--success' : 'status-pill'
          }
        >
          <Icon name="shield" />
          {moduleAccessLabel(data, module)}
        </span>
      </div>
      <h2>{module.title}</h2>
      <p>
        {module.description ||
          module.lesson_overview ||
          'Open this module to view lesson material, examples, and activities.'}
      </p>
      <div className="progress-line">
        <span
          style={{
            width: `${percent(submittedCount, Math.max(activities.length, 1))}%`,
          }}
        />
      </div>
      <div className="module-card__bottom">
        <span>
          {completed ? 'Complete' : `${submittedCount}/${activities.length} activities`}
        </span>
        <Link className="button button--secondary" to={`/modules/${module.id}`}>
          <Icon name="book" />
          <span>Open</span>
        </Link>
      </div>
    </article>
  )
}
export function ModuleRow({ data, module }: { data: RouteData; module: Module }) {
  const activities = getModuleActivities(data, module.id)
  const submittedCount = activities.filter((activity) =>
    hasSubmission(data, activity.id),
  ).length

  return (
    <Link className="resource-row" to={`/modules/${module.id}`}>
      <span className="resource-row__icon">
        <Icon name="book" />
      </span>
      <div>
        <strong>{module.title}</strong>
        <span>
          {moduleSubjectLabel(data, module)} · {moduleAccessLabel(data, module)}
        </span>
      </div>
      <small>
        {submittedCount}/{activities.length}
      </small>
    </Link>
  )
}
export function ActivityCard({
  activity,
  data,
}: {
  activity: ModuleActivity
  data: RouteData
}) {
  const submitted = hasSubmission(data, activity.id)
  const navigate = useNavigate()
  const to = `/activities/${activity.id}`

  return (
    <article
      aria-label={`Open ${activity.title}`}
      className="activity-card"
      onClick={(event) => navigateActivityCard(event, navigate, to)}
      onKeyDown={(event) => navigateActivityCardByKey(event, navigate, to)}
      role="link"
      tabIndex={0}
    >
      <span className="activity-card__icon">
        <Icon name="activity" />
      </span>
      <div>
        <div className="activity-card__title">
          {activity.activity_type === 'INTERACTIVE' ? <InlineMarkdown value={activity.title} /> : activity.title}
        </div>
        <span>{activityTypeLabel(activity.activity_type)}</span>
      </div>
      <span className={submitted ? 'status-pill status-pill--success' : 'status-pill'}>
        {submitted ? 'Submitted' : dueLabel(activity.due_at)}
      </span>
    </article>
  )
}
export function ActivityTimelineItem({
  activity,
  data,
}: {
  activity: ModuleActivity
  data: RouteData
}) {
  const module = data.modules.find((item) => item.id === activity.module)
  const navigate = useNavigate()
  const to = `/activities/${activity.id}`

  return (
    <article
      aria-label={`Open ${activity.title}`}
      className="timeline-item"
      onClick={(event) => navigateActivityCard(event, navigate, to)}
      onKeyDown={(event) => navigateActivityCardByKey(event, navigate, to)}
      role="link"
      tabIndex={0}
    >
      <div className="timeline-dot">
        <Icon name="calendar" />
      </div>
      <div>
        <div className="timeline-item__title">
          {activity.activity_type === 'INTERACTIVE' ? <InlineMarkdown value={activity.title} /> : activity.title}
        </div>
        <span>{module?.title ?? activityTypeLabel(activity.activity_type)}</span>
        <small>{dueLabel(activity.due_at)}</small>
      </div>
    </article>
  )
}

function navigateActivityCard(
  event: React.MouseEvent<HTMLElement>,
  navigate: ReturnType<typeof useNavigate>,
  to: string,
) {
  if (
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    (event.target instanceof Element && event.target.closest('a'))
  ) return
  navigate(to)
}

function navigateActivityCardByKey(
  event: React.KeyboardEvent<HTMLElement>,
  navigate: ReturnType<typeof useNavigate>,
  to: string,
) {
  if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return
  event.preventDefault()
  navigate(to)
}
