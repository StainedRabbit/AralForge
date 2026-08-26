import { Link } from 'react-router-dom'
import type { RouteData } from '../app/types'
import type {
  Module,
  ModuleActivity,
  ProgrammingProblem,
} from '../types'
import {
  activityTypeLabel,
  getModuleActivities,
  hasSubmission,
  moduleAccessLabel,
  moduleSubjectLabel,
} from '../utils/student'
import { dueLabel, percent } from '../utils/format'
import { Icon } from './Icon'
import { MetaStrip } from './ui'

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

  return (
    <Link className="activity-card" to={`/activities/${activity.id}`}>
      <span className="activity-card__icon">
        <Icon name={activity.activity_type.includes('CODE') ? 'code' : 'activity'} />
      </span>
      <div>
        <strong>{activity.title}</strong>
        <span>{activityTypeLabel(activity.activity_type)}</span>
      </div>
      <span className={submitted ? 'status-pill status-pill--success' : 'status-pill'}>
        {submitted ? 'Submitted' : dueLabel(activity.due_at)}
      </span>
    </Link>
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

  return (
    <Link className="timeline-item" to={`/activities/${activity.id}`}>
      <div className="timeline-dot">
        <Icon name={activity.activity_type.includes('CODE') ? 'code' : 'calendar'} />
      </div>
      <div>
        <strong>{activity.title}</strong>
        <span>{module?.title ?? activityTypeLabel(activity.activity_type)}</span>
        <small>{dueLabel(activity.due_at)}</small>
      </div>
    </Link>
  )
}

export function ProblemCard({
  data,
  problem,
}: {
  data: RouteData
  problem: ProgrammingProblem
}) {
  const subject = data.subjects.find((item) => item.id === problem.subject)
  const submissions = data.codeSubmissions.filter(
    (submission) => submission.problem === problem.id,
  )

  return (
    <article className="problem-card">
      <div className="module-card__top">
        <span className={`difficulty difficulty--${problem.difficulty.toLowerCase()}`}>
          {problem.difficulty}
        </span>
        <span className="status-pill">
          <Icon name="code" />
          {problem.blanks.length} blanks
        </span>
      </div>
      <h2>{problem.title}</h2>
      <p>{problem.description || 'Open the problem to submit a solution.'}</p>
      <MetaStrip
        items={[
          ['Subject', subject ? subject.code : 'General'],
          ['Language', problem.expected_language || 'Any'],
          ['Attempts', submissions.length.toString()],
        ]}
      />
      <Link className="button button--secondary" to={`/coding/${problem.id}`}>
        <Icon name="code" />
        <span>Open problem</span>
      </Link>
    </article>
  )
}
