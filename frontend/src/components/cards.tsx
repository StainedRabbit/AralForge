import { Link } from 'react-router-dom'
import type { WorkspaceData } from '../app/types'
import type {
  Assessment,
  AssessmentAttempt,
  Module,
  ModuleActivity,
  ProgrammingProblem,
  Subject,
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

export function ModuleCard({ data, module }: { data: WorkspaceData; module: Module }) {
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
          <Icon name={module.is_paid ? 'shield' : 'spark'} />
          {moduleAccessLabel(data, module)}
        </span>
      </div>
      <h2>{module.title}</h2>
      <p>{module.description || 'Open this module to view lesson notes and activities.'}</p>
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

export function ModuleRow({ data, module }: { data: WorkspaceData; module: Module }) {
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
  data: WorkspaceData
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
  data: WorkspaceData
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
  data: WorkspaceData
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

export function AssessmentRow({
  assessment,
  attempts,
  isSaving,
  onStart,
  subject,
}: {
  assessment: Assessment
  attempts: AssessmentAttempt[]
  isSaving: boolean
  onStart: () => void
  subject?: Subject
}) {
  const submittedAttempts = attempts.filter((attempt) => attempt.is_submitted).length
  const canStart = attempts.length < assessment.max_attempts

  return (
    <article className="assessment-row">
      <span className="assessment-row__icon">
        <Icon name="assessment" />
      </span>
      <div>
        <div className="assessment-row__title">
          <h2>{assessment.title}</h2>
          <span className="subject-chip">{assessment.kind}</span>
        </div>
        <p>{assessment.instructions || 'Open assessment when your teacher enables questions.'}</p>
        <MetaStrip
          items={[
            ['Subject', subject ? subject.code : 'General'],
            ['Limit', assessment.time_limit_minutes ? `${assessment.time_limit_minutes}m` : 'None'],
            ['Attempts', `${attempts.length}/${assessment.max_attempts}`],
            ['Submitted', submittedAttempts.toString()],
          ]}
        />
      </div>
      <div className="assessment-actions">
        <Link className="button button--primary" to={`/assessments/${assessment.id}`}>
          <Icon name="assessment" />
          <span>Open</span>
        </Link>
        <button
          className="button button--secondary"
          disabled={!canStart || isSaving}
          onClick={onStart}
          type="button"
        >
          <Icon name="send" />
          <span>{isSaving ? 'Starting...' : canStart ? 'New attempt' : 'Maxed'}</span>
        </button>
      </div>
    </article>
  )
}
