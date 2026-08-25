import type { AdminOption } from '../components/admin/AdminResourcePanel'
import type {
  Assessment,
  AttendanceSession,
  Badge,
  GradeCategory,
  GradingTemplate,
  GradingTemplateItem,
  Module,
  ModuleActivity,
  ProgrammingProblem,
  Question,
  Subject,
  SubjectSchedule,
  User,
} from '../types'
import { formatDate, formatDateTime, formatTime, numeric } from '../utils/format'
import { activityTypeLabel, fullName } from '../utils/student'

export const roleOptions: AdminOption[] = [
  { label: 'Student', value: 'STUDENT' },
  { label: 'Teacher', value: 'TEACHER' },
  { label: 'Admin', value: 'ADMIN' },
]

export const activityTypeOptions: AdminOption[] = [
  { label: 'Text', value: 'TEXT' },
  { label: 'File upload', value: 'FILE_UPLOAD' },
  { label: 'Complete coding', value: 'CODE_COMPLETE' },
  { label: 'Fill blanks', value: 'CODE_FILL_BLANK' },
]

export const difficultyOptions: AdminOption[] = [
  { label: 'Easy', value: 'EASY' },
  { label: 'Medium', value: 'MEDIUM' },
  { label: 'Hard', value: 'HARD' },
]

export const codeStatusOptions: AdminOption[] = [
  { label: 'Pending', value: 'PENDING' },
  { label: 'Running', value: 'RUNNING' },
  { label: 'Accepted', value: 'ACCEPTED' },
  { label: 'Wrong answer', value: 'WRONG_ANSWER' },
  { label: 'Runtime error', value: 'RUNTIME_ERROR' },
  { label: 'Time limit', value: 'TIME_LIMIT' },
]

export const assessmentKindOptions: AdminOption[] = [
  { label: 'Quiz', value: 'QUIZ' },
  { label: 'Exam', value: 'EXAM' },
  { label: 'Activity', value: 'ACTIVITY' },
  { label: 'Mock quiz', value: 'MOCK_QUIZ' },
  { label: 'Mock exam', value: 'MOCK_EXAM' },
  { label: 'Practice', value: 'PRACTICE' },
]

export const questionTypeOptions: AdminOption[] = [
  { label: 'Multiple choice', value: 'MULTIPLE_CHOICE' },
  { label: 'True/false', value: 'TRUE_FALSE' },
  { label: 'Short answer', value: 'SHORT_ANSWER' },
  { label: 'Essay', value: 'ESSAY' },
  { label: 'Coding', value: 'CODING' },
]

export const attendanceStatusOptions: AdminOption[] = [
  { label: 'Present', value: 'PRESENT' },
  { label: 'Late', value: 'LATE' },
  { label: 'Excused', value: 'EXCUSED' },
  { label: 'Absent', value: 'ABSENT' },
]

export const gradingPeriodOptions: AdminOption[] = [
  { label: 'Prelim', value: 'PRELIM' },
  { label: 'Midterm', value: 'MIDTERM' },
  { label: 'Prefinal', value: 'PREFINAL' },
  { label: 'Final', value: 'FINAL' },
]

export const gradeCategoryOptions: AdminOption[] = [
  { label: 'Quiz', value: 'QUIZ' },
  { label: 'Exam', value: 'EXAM' },
  { label: 'Activity', value: 'ACTIVITY' },
  { label: 'Attendance', value: 'ATTENDANCE' },
  { label: 'Coding', value: 'CODING' },
  { label: 'Other', value: 'OTHER' },
]

export const pointSourceOptions: AdminOption[] = [
  { label: 'Assessment', value: 'ASSESSMENT' },
  { label: 'Attendance', value: 'ATTENDANCE' },
  { label: 'Module activity', value: 'MODULE_ACTIVITY' },
  { label: 'Coding', value: 'CODING' },
  { label: 'Manual', value: 'MANUAL' },
]

export function toOptions<TItem>(
  items: TItem[],
  getValue: (item: TItem) => number | string,
  getLabel: (item: TItem) => string,
): AdminOption[] {
  return items.map((item) => ({
    label: getLabel(item),
    value: getValue(item),
  }))
}

export function studentUsers(users: User[]) {
  return users.filter((user) => user.role === 'STUDENT')
}

export function userName(users: User[], id: number | null | undefined) {
  const user = users.find((item) => item.id === id)
  return user ? fullName(user) : 'Unassigned'
}

export function subjectName(subjects: Subject[], id: number | null | undefined) {
  const subject = subjects.find((item) => item.id === id)
  return subject ? `${subject.code} ${subject.name}` : 'General'
}

export function moduleName(modules: Module[], id: number | null | undefined) {
  return modules.find((item) => item.id === id)?.title ?? 'No module'
}

export function activityName(
  activities: ModuleActivity[],
  id: number | null | undefined,
) {
  return activities.find((item) => item.id === id)?.title ?? 'No activity'
}

export function problemName(
  problems: ProgrammingProblem[],
  id: number | null | undefined,
) {
  return problems.find((item) => item.id === id)?.title ?? 'No problem'
}

export function assessmentName(
  assessments: Assessment[],
  id: number | null | undefined,
) {
  return assessments.find((item) => item.id === id)?.title ?? 'No assessment'
}

export function questionName(questions: Question[], id: number | null | undefined) {
  const question = questions.find((item) => item.id === id)
  return question ? `Q${question.order}: ${question.prompt.slice(0, 56)}` : 'No question'
}

export function scheduleName(
  schedules: SubjectSchedule[],
  subjects: Subject[],
  id: number | null | undefined,
) {
  const schedule = schedules.find((item) => item.id === id)

  if (!schedule) {
    return 'No schedule'
  }

  return `${subjectName(subjects, schedule.subject)} ${schedule.section || ''} ${schedule.days} ${formatTime(schedule.start_time)}`
}

export function attendanceSessionName(
  sessions: AttendanceSession[],
  subjects: Subject[],
  id: number | null | undefined,
) {
  const session = sessions.find((item) => item.id === id)

  if (!session) {
    return 'No session'
  }

  return `${subjectName(subjects, session.subject)} ${session.term_name || ''} ${formatDate(session.date)}`
}

export function gradeCategoryName(
  categories: GradeCategory[],
  subjects: Subject[],
  id: number | null | undefined,
) {
  const category = categories.find((item) => item.id === id)

  if (!category) {
    return 'No category'
  }

  return `${subjectName(subjects, category.subject)} ${category.grading_period} ${category.name}`
}

export function gradingTemplateName(
  templates: GradingTemplate[],
  id: number | null | undefined,
) {
  return templates.find((item) => item.id === id)?.name ?? 'No template'
}

export function templateItemName(
  items: GradingTemplateItem[],
  id: number | null | undefined,
) {
  const item = items.find((entry) => entry.id === id)
  return item ? `${item.grading_period} ${item.name}` : 'No template item'
}

export function badgeName(badges: Badge[], id: number | null | undefined) {
  return badges.find((item) => item.id === id)?.name ?? 'No badge'
}

export function booleanLabel(value: boolean) {
  return value ? 'Yes' : 'No'
}

export function money(value: string | number | null | undefined) {
  return numeric(value).toFixed(2)
}

export function compactDateTime(value: string | null | undefined) {
  return value ? formatDateTime(value) : 'Not set'
}

export function activitySummary(activity: ModuleActivity) {
  return `${activityTypeLabel(activity.activity_type)} - ${numeric(activity.points_possible)} pts`
}
