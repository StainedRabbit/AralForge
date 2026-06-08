import type { AnswerDraft, WorkspaceData } from '../app/types'
import type {
  AttendanceRecord,
  GradeCategory,
  LevelRule,
  Module,
  ModuleActivity,
  Question,
  SubjectSchedule,
  User,
} from '../types'
import { formatTime, numeric, percent } from './format'

export function buildDashboardMetrics(data: WorkspaceData) {
  const completedModules = data.progress.filter((item) => item.completed_at).length
  const submittedActivities = data.submissions.length
  const pendingActivities = countPendingActivities(data)
  const blankCount = data.problems.reduce(
    (sum, problem) => sum + problem.blanks.length,
    0,
  )
  const totalPoints = data.points.reduce((sum, point) => sum + point.points, 0)

  return {
    blankCount,
    completedModules,
    moduleCount: data.modules.length,
    pendingActivities,
    problemCount: data.problems.length,
    submittedActivities,
    totalPoints,
  }
}

export function getStudentEnrollments(data: WorkspaceData) {
  if (!data.currentUser) {
    return data.enrollments
  }

  return data.enrollments.filter(
    (enrollment) => enrollment.student === data.currentUser?.id,
  )
}

export function scheduleTime(schedule?: SubjectSchedule) {
  if (!schedule) {
    return 'No schedule'
  }

  return `${formatTime(schedule.start_time)} - ${formatTime(schedule.end_time)}`
}

export function attendanceSummary(records: AttendanceRecord[]) {
  const present = records.filter((record) => record.status === 'PRESENT').length
  const late = records.filter((record) => record.status === 'LATE').length
  const excused = records.filter((record) => record.status === 'EXCUSED').length
  const absent = records.filter((record) => record.status === 'ABSENT').length
  const attended = present + late + excused
  const rate = records.length ? Math.round((attended / records.length) * 100) : 0

  return { absent, excused, late, present, rate }
}

export function attendanceStatusLabel(status: AttendanceRecord['status']) {
  const labels: Record<AttendanceRecord['status'], string> = {
    ABSENT: 'Absent',
    EXCUSED: 'Excused',
    LATE: 'Late',
    PRESENT: 'Present',
  }

  return labels[status]
}

export function getQuestionChoices(data: WorkspaceData, question: Question) {
  const nestedChoices = question.choices ?? []

  if (nestedChoices.length) {
    return nestedChoices
  }

  return data.choices
    .filter((choice) => choice.question === question.id)
    .sort((first, second) => first.order - second.order || first.id - second.id)
}

export function emptyAnswerDraft(): AnswerDraft {
  return {
    code_answer: '',
    selected_choice: null,
    text_answer: '',
  }
}

export function calculateLevelState(levels: LevelRule[], points: number) {
  const sortedLevels = [...levels].sort(
    (first, second) => first.points_required - second.points_required,
  )
  const current =
    [...sortedLevels]
      .reverse()
      .find((level) => level.points_required <= points) ?? sortedLevels[0] ?? null
  const next =
    sortedLevels.find((level) => level.points_required > points) ?? null
  const basePoints = current?.points_required ?? 0
  const nextPoints = next?.points_required ?? Math.max(points, basePoints)
  const progress =
    nextPoints === basePoints
      ? 100
      : percent(points - basePoints, nextPoints - basePoints)

  return { current, next, progress }
}

export function gradeCategoryLabel(category: GradeCategory) {
  return `${category.grading_period} ${category.category} · ${numeric(category.weight)}%`
}

export function countPendingActivities(data: WorkspaceData) {
  return data.activities.filter((activity) => !hasSubmission(data, activity.id)).length
}

export function hasSubmission(data: WorkspaceData, activityId: number) {
  return data.submissions.some((submission) => submission.activity === activityId)
}

export function getModuleActivities(data: WorkspaceData, moduleId: number) {
  return data.activities
    .filter((activity) => activity.module === moduleId)
    .sort((first, second) => first.order - second.order || first.id - second.id)
}

export function moduleSubjectLabel(data: WorkspaceData, module: Module) {
  const subjects = module.subjects
    .map((id) => data.subjects.find((subject) => subject.id === id))
    .filter(Boolean)

  if (!subjects.length) {
    return 'General'
  }

  return subjects.map((subject) => subject?.code).join(' / ')
}

export function moduleAccessLabel(data: WorkspaceData, module: Module) {
  if (!module.is_paid) {
    return 'Free module'
  }

  const grant = data.moduleAccess.find((item) => item.module === module.id)

  if (grant?.is_available) {
    return grant.payment_status === 'WAIVED' ? 'Access waived' : 'Paid access'
  }

  if (module.is_accessible) {
    return numeric(module.price) ? `Paid ${numeric(module.price).toFixed(2)}` : 'Active access'
  }

  return 'Locked'
}

export function subjectLabel(data: WorkspaceData, subjectId: number) {
  const subject = data.subjects.find((item) => item.id === subjectId)
  return subject ? `${subject.code} ${subject.name}` : 'Subject'
}

export function activityTypeLabel(type: ModuleActivity['activity_type']) {
  const labels: Record<ModuleActivity['activity_type'], string> = {
    TEXT: 'Text activity',
    FILE_UPLOAD: 'File upload',
    CODE_COMPLETE: 'Complete coding',
    CODE_FILL_BLANK: 'Fill in the blank coding',
  }

  return labels[type]
}

export function compareActivitiesByDueDate(
  first: ModuleActivity,
  second: ModuleActivity,
) {
  if (!first.due_at && !second.due_at) {
    return first.order - second.order
  }

  if (!first.due_at) {
    return 1
  }

  if (!second.due_at) {
    return -1
  }

  return new Date(first.due_at).getTime() - new Date(second.due_at).getTime()
}

export function greeting(user: User | null) {
  const name = user?.first_name || user?.username || 'there'
  return `Welcome back, ${name}.`
}

export function fullName(user: User | null) {
  if (!user) {
    return 'Loading account'
  }

  return [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username
}

export function initials(user: User | null) {
  const name = fullName(user)
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}
