import type { RequestOptions } from '../api'
import type {
  AttendanceRecord,
  AttendanceSession,
  Badge,
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
  MainActivityState,
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
  User,
} from '../types'

export type AuthedRequest = <T>(
  path: string,
  options?: RequestOptions,
) => Promise<T>

export type LearningContextMetadata = {
  context_type: 'CLASS' | 'PERSONAL'
  schedule: number | null
  label: string
}

export type PresentationModule = Pick<Module, 'id' | 'title' | 'subject'>

export type PresentationModuleTopic = Pick<
  ModuleTopic,
  | 'id'
  | 'module'
  | 'title'
  | 'order'
  | 'overview'
  | 'competency_text'
  | 'essential_question'
  | 'enduring_understanding'
  | 'performance_task'
  | 'success_criteria'
>

export type PresentationModuleLesson = Pick<
  ModuleLesson,
  | 'id'
  | 'topic'
  | 'title'
  | 'order'
  | 'learning_targets'
  | 'objectives'
  | 'before_you_start'
  | 'short_discussion'
  | 'overview'
  | 'lets_practice'
  | 'challenge_task'
  | 'is_published'
>

export type PresentationLessonExample = Pick<
  ModuleLessonExample,
  | 'id'
  | 'lesson'
  | 'order'
  | 'title'
  | 'image'
  | 'alt_text'
  | 'body'
  | 'common_mistake'
  | 'is_published'
>

export type PresentationWorkspace = {
  module: PresentationModule
  topics: PresentationModuleTopic[]
  lessons: PresentationModuleLesson[]
  lesson_examples: PresentationLessonExample[]
}

export type RouteData = {
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
  learningContext: LearningContextMetadata | null
  legacyHistoryCounts: Record<number, number>
  moduleAccess: ModuleAccess[]
  activities: ModuleActivity[]
  activityQuestions: ModuleActivityQuestion[]
  activityChoices: ModuleActivityQuestionChoice[]
  activityMatchingPairs: ModuleActivityMatchingPair[]
  activityAttempts: ModuleActivityAttempt[]
  activityStates: MainActivityState[]
  activityAnswers: ModuleActivityAnswer[]
  submissions: ModuleActivitySubmission[]
  progress: ModuleProgress[]
  topicProgress: ModuleTopicProgress[]
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

export type RouteDataWithRefresh = RouteData & {
  refresh: () => Promise<void>
}
