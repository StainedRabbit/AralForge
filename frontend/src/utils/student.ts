import type { AnswerDraft, RouteData } from '../app/types'
import type {
  AttendanceRecord,
  Assessment,
  GradeCategory,
  LevelRule,
  Module,
  ModuleActivity,
  AssessmentAttempt,
  Question,
  SubjectSchedule,
  User,
} from '../types'
import { formatTime, numeric, percent } from './format'

export function buildDashboardMetrics(data: RouteData) {
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

export function getStudentEnrollments(data: RouteData) {
  if (!data.currentUser) {
    return data.enrollments
  }

  return data.enrollments.filter(
    (enrollment) => enrollment.student === data.currentUser?.id,
  )
}

export function getActiveStudentEnrollments(data: RouteData) {
  return getStudentEnrollments(data).filter((enrollment) => enrollment.is_active)
}

export function getActiveStudentSubjectIds(data: RouteData) {
  return new Set(
    getActiveStudentEnrollments(data).map((enrollment) => enrollment.subject),
  )
}

export function hasActiveSubjectAccess(
  data: RouteData,
  subjectId: number | null,
) {
  if (!subjectId) {
    return true
  }

  return getActiveStudentSubjectIds(data).has(subjectId)
}

export function hasActiveModuleAccess(_data: RouteData, module: Module) {
  return module.is_accessible
}

export function getStudentModuleSubjectIds(data: RouteData) {
  const subjectIds = getActiveStudentSubjectIds(data)
  data.modules.forEach((module) => {
    if (!hasActiveModuleAccess(data, module)) {
      return
    }
    if (module.subject) {
      subjectIds.add(module.subject)
    }
    module.subjects.forEach((subjectId) => subjectIds.add(subjectId))
  })
  return subjectIds
}

export function isModuleGrantAvailable(grant: RouteData['moduleAccess'][number]) {
  return grant.is_available
}

export function hasActiveAssessmentAccess(
  data: RouteData,
  assessment: Assessment,
) {
  if (assessment.module) {
    const module = data.modules.find((item) => item.id === assessment.module)
    return module ? hasActiveModuleAccess(data, module) : false
  }

  return hasActiveSubjectAccess(data, assessment.subject)
}

export function isMockAssessment(assessment: Assessment) {
  return assessment.kind === 'MOCK_EXAM' || assessment.kind === 'MOCK_QUIZ'
}

export function getMockTopicModules(data: RouteData, assessment: Assessment) {
  return data.moduleTopics
    .filter((topic) => {
      const module = data.modules.find((item) => item.id === topic.module)
      if (!module || !topic.is_published || !module.is_published || !hasActiveModuleAccess(data, module)) {
        return false
      }

      if (assessment.subject) {
        return module.subject === assessment.subject || module.subjects.includes(assessment.subject)
      }

      return true
    })
    .sort((first, second) => first.title.localeCompare(second.title))
}

export function getAssessmentQuestions(
  data: RouteData,
  assessment: Assessment,
  attempt?: AssessmentAttempt | null,
) {
  if (isMockAssessment(assessment) && attempt) {
    const selectedQuestionIds = attempt.selected_question_ids.length
      ? attempt.selected_question_ids
      : data.attemptQuestions
          .filter((item) => item.attempt === attempt.id)
          .sort((first, second) => first.order - second.order || first.id - second.id)
          .map((item) => item.question)

    if (selectedQuestionIds.length) {
      return selectedQuestionIds
        .map((id) => data.questions.find((question) => question.id === id))
        .filter((question): question is Question => Boolean(question))
    }
  }

  return data.questions
    .filter((question) => question.assessment === assessment.id)
    .sort((first, second) => first.order - second.order || first.id - second.id)
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

export function getQuestionChoices(data: RouteData, question: Question) {
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

export function countPendingActivities(data: RouteData) {
  return data.activities.filter((activity) => !hasSubmission(data, activity.id)).length
}

export function hasSubmission(data: RouteData, activityId: number) {
  return data.submissions.some((submission) => submission.activity === activityId)
}

export function getModuleActivities(data: RouteData, moduleId: number) {
  return data.activities
    .filter((activity) => activity.module === moduleId)
    .sort((first, second) => first.order - second.order || first.id - second.id)
}

export function moduleSubjectLabel(data: RouteData, module: Module) {
  if (module.subject) {
    const subject = data.subjects.find((item) => item.id === module.subject)
    return subject?.code ?? 'General'
  }

  const subjects = module.subjects
    .map((id) => data.subjects.find((subject) => subject.id === id))
    .filter(Boolean)

  if (!subjects.length) {
    return 'General'
  }

  return subjects.map((subject) => subject?.code).join(' / ')
}

export function moduleAccessLabel(_data: RouteData, module: Module) {
  if (module.access_status === 'ADVANCE_ACTIVE') return 'Advance access'
  if (module.access_status === 'ENROLLED_ACTIVE') return 'Active access'
  if (module.access_status === 'LOCKED') return 'Locked'
  return module.is_accessible ? 'Active access' : 'Locked'
}

export function subjectLabel(data: RouteData, subjectId: number) {
  const subject = data.subjects.find((item) => item.id === subjectId)
  return subject ? `${subject.code} ${subject.name}` : 'Subject'
}

export function activityTypeLabel(type: ModuleActivity['activity_type']) {
  const labels: Record<ModuleActivity['activity_type'], string> = {
    TEXT: 'Text activity',
    FILE_UPLOAD: 'File upload',
    CODE_COMPLETE: 'Complete coding',
    CODE_FILL_BLANK: 'Fill in the blank coding',
    INTERACTIVE: 'Interactive activity',
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
