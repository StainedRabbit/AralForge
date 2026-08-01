import type { RequestOptions } from '../api'
import type {
  Answer,
  Assessment,
  AssessmentAttempt,
  AssessmentAttemptQuestion,
  AttendanceRecord,
  AttendanceSession,
  Badge,
  CodeBlankAnswer,
  Choice,
  CodeSubmission,
  FinalGrade,
  GradeCategory,
  GradeItem,
  GradingTemplate,
  GradingTemplateItem,
  LevelRule,
  Module,
  ModuleAccess,
  ModuleActivity,
  ModuleActivityAnswer,
  ModuleActivityAttempt,
  ModuleActivityMatchingPair,
  ModuleActivityQuestion,
  ModuleActivityQuestionChoice,
  ModuleActivitySubmission,
  ModuleLessonAsset,
  ModuleLesson,
  ModuleLessonExample,
  ModuleLessonProgress,
  ModuleProgress,
  ModuleTopic,
  ModuleTopicProgress,
  PeriodGrade,
  PointLedger,
  ProgrammingProblem,
  Question,
  ScheduleStudent,
  SchoolYear,
  SchoolYearSemester,
  StudentBadge,
  StudentCategoryGrade,
  StudentGradeItemScore,
  StudentProfile,
  Subject,
  SubjectGradingPolicy,
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
  moduleTopics: ModuleTopic[]
  moduleLessons: ModuleLesson[]
  lessonAssets: ModuleLessonAsset[]
  lessonExamples: ModuleLessonExample[]
  lessonProgress: ModuleLessonProgress[]
  moduleAccess: ModuleAccess[]
  activities: ModuleActivity[]
  activityQuestions: ModuleActivityQuestion[]
  activityChoices: ModuleActivityQuestionChoice[]
  activityMatchingPairs: ModuleActivityMatchingPair[]
  activityAttempts: ModuleActivityAttempt[]
  activityAnswers: ModuleActivityAnswer[]
  submissions: ModuleActivitySubmission[]
  progress: ModuleProgress[]
  topicProgress: ModuleTopicProgress[]
  problems: ProgrammingProblem[]
  testCases: TestCase[]
  codeSubmissions: CodeSubmission[]
  codeBlankAnswers: CodeBlankAnswer[]
  assessments: Assessment[]
  attempts: AssessmentAttempt[]
  attemptQuestions: AssessmentAttemptQuestion[]
  questions: Question[]
  choices: Choice[]
  answers: Answer[]
  attendanceSessions: AttendanceSession[]
  attendanceRecords: AttendanceRecord[]
  gradingTemplates: GradingTemplate[]
  subjectGradingPolicies: SubjectGradingPolicy[]
  gradingTemplateItems: GradingTemplateItem[]
  gradeCategories: GradeCategory[]
  gradeItems: GradeItem[]
  categoryGrades: StudentCategoryGrade[]
  gradeItemScores: StudentGradeItemScore[]
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
