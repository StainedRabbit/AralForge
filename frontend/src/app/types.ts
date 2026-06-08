import type { RequestOptions } from '../api'
import type {
  Answer,
  Assessment,
  AssessmentAttempt,
  AttendanceRecord,
  AttendanceSession,
  Badge,
  CodeBlankAnswer,
  Choice,
  CodeSubmission,
  FinalGrade,
  GradeCategory,
  GradingTemplate,
  GradingTemplateItem,
  LevelRule,
  Module,
  ModuleAccess,
  ModuleActivity,
  ModuleActivitySubmission,
  ModuleProgress,
  PeriodGrade,
  PointLedger,
  ProgrammingProblem,
  Question,
  ScheduleStudent,
  SchoolYear,
  SchoolYearSemester,
  StudentBadge,
  StudentCategoryGrade,
  StudentProfile,
  Subject,
  SubjectSchedule,
  TestCase,
  User,
} from '../types'

export type AuthedRequest = <T>(
  path: string,
  options?: RequestOptions,
) => Promise<T>

export type WorkspaceData = {
  users: User[]
  currentUser: User | null
  profiles: StudentProfile[]
  profile: StudentProfile | null
  subjects: Subject[]
  schoolYears: SchoolYear[]
  terms: SchoolYearSemester[]
  schedules: SubjectSchedule[]
  enrollments: ScheduleStudent[]
  modules: Module[]
  moduleAccess: ModuleAccess[]
  activities: ModuleActivity[]
  submissions: ModuleActivitySubmission[]
  progress: ModuleProgress[]
  problems: ProgrammingProblem[]
  testCases: TestCase[]
  codeSubmissions: CodeSubmission[]
  codeBlankAnswers: CodeBlankAnswer[]
  assessments: Assessment[]
  attempts: AssessmentAttempt[]
  questions: Question[]
  choices: Choice[]
  answers: Answer[]
  attendanceSessions: AttendanceSession[]
  attendanceRecords: AttendanceRecord[]
  gradingTemplates: GradingTemplate[]
  gradingTemplateItems: GradingTemplateItem[]
  gradeCategories: GradeCategory[]
  categoryGrades: StudentCategoryGrade[]
  periodGrades: PeriodGrade[]
  finalGrades: FinalGrade[]
  points: PointLedger[]
  badges: Badge[]
  studentBadges: StudentBadge[]
  levels: LevelRule[]
  loading: boolean
  error: string
}

export type WorkspaceDataWithRefresh = WorkspaceData & {
  refresh: () => Promise<void>
}

export type AnswerDraft = {
  selected_choice: number | null
  text_answer: string
  code_answer: string
}
