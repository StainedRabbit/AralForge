export type Role = 'ADMIN' | 'TEACHER' | 'STUDENT'

export type ApiPage<T> = {
  count: number
  next: number | null
  previous: number | null
  results: T[]
}

export type PaginatedResponse<T> = ApiPage<T>

export type CursorPage<T> = {
  count: number
  next: string | null
  previous: string | null
  results: T[]
}

export type ApiList<T> = T[] | ApiPage<T>

export type TokenPair = {
  access: string
  refresh: string
}

export type User = {
  id: number
  username: string
  email: string
  first_name: string
  middle_name?: string
  display_name?: string
  full_name?: string
  last_name: string
  role: Role
  is_admin_teacher: boolean
  is_active: boolean
  must_change_password: boolean
}

export type StudentProfile = {
  id: number
  user: number
  user_detail?: User
  student_number: string
  is_active: boolean
  joined_at: string
}

export type Subject = {
  id: number
  code: string
  name: string
  description: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export type SchoolYear = {
  id: number
  start_year: number
  end_year: number
  name: string
  is_active: boolean
}

export type SchoolYearSemester = {
  id: number
  school_year: number
  school_year_name: string
  semester: 'FIRST' | 'SECOND' | 'SUMMER'
  semester_display: string
  name: string
  is_active: boolean
}

export type SubjectSchedule = {
  id: number
  subject: number
  subject_code: string
  subject_name: string
  school_year_semester: number
  term_name: string
  term_is_active: boolean
  days: string
  start_time: string
  end_time: string
  section: string
  room: string
  is_active: boolean
  created_by: number | null
  updated_by: number | null
  archived_by: number | null
  created_at: string
  updated_at: string
  archived_at: string | null
}

export type ScheduleStudent = {
  id: number
  schedule: number
  schedule_display: string
  student: number
  student_number: string
  student_name: string
  student_full_name?: string
  subject: number
  subject_code: string
  subject_name: string
  school_year_semester: number
  term_name: string
  schedule_is_active: boolean
  term_is_active: boolean
  added_at: string
  is_active: boolean
  added_by: number | null
  deactivated_by: number | null
  deactivated_at: string | null
  updated_at: string
}

export type Module = {
  id: number
  title: string
  slug: string
  subject: number | null
  description: string
  content: string
  learning_objectives: string
  lesson_overview: string
  detailed_discussion: string
  examples: string
  teacher_notes: string
  student_activities: string
  resources: string
  is_accessible: boolean
  access_status: 'ADMIN' | 'LOCKED' | 'ENROLLED_ACTIVE' | 'ADVANCE_ACTIVE'
  downloadable_topics: DownloadableModuleTopic[]
  subjects: number[]
  is_published: boolean
  created_at: string
  updated_at: string
}

export type BackgroundJob = {
  id: string
  job_type: 'GRADE_RECALCULATION' | 'MODULE_PROGRESS' | 'PDF_GENERATION' | 'IMPORT' | 'EXPORT'
  owner: number | null
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED'
  attempts: number
  progress: number
  total: number
  result: Record<string, unknown>
  error: string
  created_at: string
  started_at: string | null
  finished_at: string | null
}

export type BatchScoreChange = {
  operation: 'upsert' | 'delete'
  grade_item: number
  student: number
  raw_score?: string
  status?: 'GRADED' | 'EXCUSED'
  remarks?: string
}

export type BatchScoreResult = {
  updated: StudentGradeItemScore[]
  deleted: Array<{ grade_item: number; student: number }>
  updated_count: number
  deleted_count: number
}

export type DownloadableModuleTopic = {
  id: number
  title: string
  order: number
  unit: string
  competency_code: string
  has_pdf: boolean
  pdf_generated_at: string | null
  pdf_is_outdated: boolean
}

export type ModuleTopic = {
  id: number
  module: number
  legacy_module: number | null
  title: string
  order: number
  competency_code: string
  competency_text: string
  unit: string
  overview: string
  essential_question: string
  enduring_understanding: string
  performance_task: string
  success_criteria: string
  values_focus: string
  pdf_file: string
  pdf_generated_at: string | null
  pdf_is_outdated: boolean
  has_pdf: boolean
  is_published: boolean
  created_at: string
  updated_at: string
}

export type ModuleLesson = {
  id: number
  topic: number
  title: string
  order: number
  learning_targets: string
  before_you_start: string
  short_discussion: string
  guided_examples: string
  lets_practice: string
  challenge_task: string
  objectives: string
  overview: string
  subtopics: string
  acquisition: string
  making_meaning: string
  transfer: string
  examples: string
  teacher_notes: string
  answer_key: string
  expected_outputs: string
  common_misconceptions: string
  teaching_tips: string
  remediation: string
  enrichment: string
  student_activities: string
  resources: string
  is_published: boolean
  created_at: string
  updated_at: string
}

export type ModuleLessonExample = {
  id: number
  lesson: number
  order: number
  title: string
  image: string
  alt_text: string
  body: string
  common_mistake: string
  is_published: boolean
  created_at: string
  updated_at: string
}

export type ModuleLessonAsset = {
  id: number
  lesson: number
  file: string
  original_name: string
  alt_text: string
  created_at: string
}

export type ModuleAccess = {
  id: number
  module: number
  module_title: string
  student: number
  student_name: string
  student_full_name?: string
  activated_by: number | null
  activated_by_name: string
  access_type: 'ENROLLED' | 'ADVANCE_STUDY'
  is_active: boolean
  is_available: boolean
  status: 'ACTIVE' | 'EXPIRED' | 'REVOKED'
  expires_at: string | null
  notes: string
  activated_at: string
  updated_at: string
}

export type ModuleActivityType =
  | 'TEXT'
  | 'FILE_UPLOAD'
  | 'INTERACTIVE'

export type GradingPeriod = 'PRELIM' | 'MIDTERM' | 'PREFINAL' | 'FINAL'
export type LearningContextType = 'CLASS' | 'PERSONAL' | 'LEGACY'

export type ModuleActivity = {
  id: number
  module: number
  topic: number | null
  lesson: number | null
  title: string
  instructions: string
  activity_type: ModuleActivityType
  order: number
  points_possible: string
  opens_at: string | null
  due_at: string | null
  allow_late_submissions: boolean
  accepts_text: boolean
  accepts_file: boolean
  max_attempts: number
  passing_score: string | null
  grading_period: GradingPeriod | null
  is_published: boolean
  revision: number
  created_at: string
}

export type ModuleActivityQuestionType =
  | 'multiple_choice'
  | 'true_false'
  | 'fill_blank'
  | 'ordering'
  | 'matching'
  | 'code_output'

export type ModuleActivityQuestion = {
  id: number
  activity: number
  question_type: ModuleActivityQuestionType
  prompt: string
  points: string
  order: number
  explanation?: string
  correct_text_answers?: string[]
  case_sensitive: boolean
  code_snippet: string
  expected_output?: string
  matching_options: string[]
  is_published: boolean
}

export type ModuleActivityQuestionChoice = {
  id: number
  question: number
  text: string
  is_correct?: boolean
  order: number
}

export type ModuleActivityMatchingPair = {
  id: number
  question: number
  left_text: string
  right_text?: string
  order: number
}

export type ModuleActivityAttempt = {
  id: number
  activity: number
  student: number
  submission_method: 'ONLINE' | 'PAPER'
  recorded_by: number | null
  paper_grade_item: number | null
  schedule: number | null
  context_type: LearningContextType
  attempt_number: number
  status: 'IN_PROGRESS' | 'SUBMITTED' | 'SUPERSEDED'
  activity_revision: number
  passing_score_snapshot: string | null
  score: string | null
  max_score: string
  started_at: string
  submitted_at: string | null
  is_submitted: boolean
  passed: boolean
  draft_revision: number
  draft_saved_at: string | null
  question_snapshot?: ModuleActivityQuestionSnapshot[]
  draft_answers?: Record<string, ModuleActivityDraftAnswer>
}

export type MainActivityEditorWorkspace = {
  activity: ModuleActivity | null
  questions: ModuleActivityQuestion[]
  choices: ModuleActivityQuestionChoice[]
  matching_pairs: ModuleActivityMatchingPair[]
  linked_class_count: number
}

export type MainActivityGradingWorkspace = {
  users: User[]
  schedules: SubjectSchedule[]
  enrollments: ScheduleStudent[]
  grade_categories: GradeCategory[]
  grade_items: GradeItem[]
  linked_class_count: number
}

export type MainActivityState = {
  activity: number
  attempt_limit: number
  attempt_count: number
  submitted_count: number
  attempts_remaining: number
  active_attempt_id: number | null
  best_attempt_id: number | null
  best_percentage: string | null
  passed: boolean
  review_unlocked: boolean
  requirement_met: boolean
  paper_terminal: boolean
  paper_attempt_id: number | null
  can_start_attempt: boolean
}

export type MainActivityAttemptResponse = {
  attempt: ModuleActivityAttempt
  state: MainActivityState
  created?: boolean
}

export type MainActivityDraftSaveResponse = {
  draft_revision: number
  saved_at: string
}

export type ModuleActivityDraftAnswer = {
  selected_choice: number | null
  text_answer: string
  choice_order: number[]
  matching_answer: Record<string, string>
  is_correct?: boolean
  points_earned?: string
  feedback?: string
}

export type ModuleActivityQuestionSnapshot = Omit<
  ModuleActivityQuestion,
  'activity' | 'matching_options'
> & {
  matching_options?: string[]
  choices: Array<{
    id: number
    text: string
    is_correct?: boolean
    order?: number
    presentation_order?: number
  }>
  matching_pairs: Array<{
    id: number
    left_text: string
    right_text?: string
    order: number
  }>
}

export type PaperActivityScoreInput = {
  student: number
  score: string
}

export type PaperActivityScoreBatchRequest = {
  grade_item: number
  scores: PaperActivityScoreInput[]
}

export type PaperActivityScoreBatchResult = {
  attempts: ModuleActivityAttempt[]
  created_count: number
  updated_count: number
}

export type ModuleActivityAnswer = {
  id: number
  attempt: number
  question: number
  selected_choice: number | null
  text_answer: string
  choice_order: number[]
  matching_answer: Record<string, string>
  is_correct?: boolean | null
  points_earned?: string | null
  feedback?: string
}

export type ModuleProgress = {
  id: number
  module: number
  student: number
  schedule: number | null
  context_type: LearningContextType
  started_at: string
  completed_at: string | null
}

export type ModuleTopicProgress = {
  id: number
  topic: number
  student: number
  schedule: number | null
  context_type: LearningContextType
  started_at: string
  completed_at: string | null
}

export type ModuleLessonProgress = {
  id: number
  lesson: number
  student: number
  schedule: number | null
  context_type: LearningContextType
  started_at: string
  last_viewed_at: string
  completed_at: string | null
}

export type ModuleActivitySubmission = {
  id: number
  activity: number
  student: number
  text_answer: string
  file: string
  score: string | null
  feedback: string
  submitted_at: string
  graded_at: string | null
}

export type ModuleTeacherSummaryAccessStatus =
  | 'ACTIVE'
  | 'EXPIRED'
  | 'LOCKED'
  | 'REVOKED'

export type ModuleTeacherSummaryStudent = {
  student_id: number
  student_name: string
  student_full_name?: string
  username: string
  email: string
  is_enrolled: boolean
  schedule_id: number | null
  schedule_display: string
  access_status: ModuleTeacherSummaryAccessStatus
  access_expires_at: string | null
  access_activated_at: string | null
  lesson_progress: {
    started_count: number
    completed_count: number
    total_count: number
    percent_complete: number
    last_viewed_at: string | null
    last_viewed_lesson: string
  }
  activity_submissions: {
    submitted_count: number
    pending_count: number
    graded_count: number
    ungraded_count: number
    total_count: number
  }
}

export type ModuleTeacherSummary = {
  module: number
  module_title: string
  total_students: number
  total_lessons: number
  total_activities: number
  active_access_count: number
  locked_count: number
  completed_count: number
  ungraded_submission_count: number
  count: number
  next: number | string | null
  previous: number | string | null
  students: ModuleTeacherSummaryStudent[]
}

export type AttendanceSession = {
    id: number
    schedule: number | null
    subject: number
  school_year_semester: number | null
  term_name: string
  title: string
  date: string
  points_possible: string
  notes: string
  roster_students: number[]
  created_at: string
}

export type AttendanceRecord = {
  id: number
  session: number
  student: number
  status: 'PRESENT' | 'LATE' | 'EXCUSED' | 'ABSENT'
  points_earned: string
  remarks: string
  recorded_at: string
}

export type GradingTemplate = {
  id: number
  name: string
  description: string
  is_default: boolean
  transmutation_base: string
  transmutation_scale: string
  prelim_weight: string
  midterm_weight: string
  prefinal_weight: string
  final_weight: string
  created_at: string
  items: GradingTemplateItem[]
}

export type SubjectGradingPolicy = {
  id: number
  subject: number
  subject_label?: string
  source_template: number | null
  source_template_label?: string
  transmutation_base: string
  transmutation_scale: string
  prelim_weight: string
  midterm_weight: string
  prefinal_weight: string
  final_weight: string
  updated_at: string
}

export type GradingTemplateItem = {
  id: number
  template: number
  template_label?: string
  grading_period: GradingPeriod
  category: 'QUIZ' | 'EXAM' | 'ACTIVITY' | 'ATTENDANCE' | 'OTHER'
  name: string
  weight: string
}

export type GradeCategory = {
  id: number
  subject: number
  subject_label?: string
  template_item: number | null
  template_item_label?: string
  grading_period: GradingPeriod
  category: 'QUIZ' | 'EXAM' | 'ACTIVITY' | 'ATTENDANCE' | 'OTHER'
  name: string
  weight: string
}

export type GradeItemSourceType =
  | 'MANUAL'
  | 'MODULE_ACTIVITY'
  | 'ATTENDANCE'

export type GradeItem = {
  id: number
  schedule: number | null
  grade_category: number
  subject: number
  title: string
  date: string | null
  points_possible: string
  order: number
  is_required: boolean
  source_type: GradeItemSourceType
  module_activity: number | null
  attendance_session: number | null
  source_title: string
  source_points_possible: string
  created_at: string
  updated_at: string
}

export type MainActivityGradeAssignment = {
  schedule: number
  grade_category: number
}

export type MainActivityBulkAssignmentRequest = {
  module_activity: number
  assignments: MainActivityGradeAssignment[]
}

export type MainActivityBulkAssignmentResult = {
  items: GradeItem[]
  created_count: number
  updated_count: number
}

export type StudentCategoryGrade = {
  id: number
  schedule: number | null
  subject: number
  student: number
  grade_category: number
  raw_score: string | null
  total_score: string | null
  transmuted_grade: string | null
  weighted_score: string | null
  is_item_computed: boolean
  completion_status: 'PENDING' | 'COMPLETE' | 'NOT_APPLICABLE'
  required_item_count: number
  resolved_item_count: number
  pending_item_count: number
  withheld_reason: string
  computed_at: string
}

export type StudentGradeItemScore = {
  id: number
  schedule: number | null
  grade_item: number
  grade_category: number
  subject: number
  student: number
  raw_score: string | null
  status: 'GRADED' | 'EXCUSED'
  origin: 'MANUAL' | 'AUTOMATIC' | 'OVERRIDE'
  override_reason: string
  total_score: string
  transmuted_grade: string | null
  remarks: string
  computed_at: string
}

export type PeriodGrade = {
  id: number
  schedule: number | null
  subject: number
  student: number
  grading_period: GradingPeriod
  raw_score: string | null
  remarks: string
  completion_status: 'PENDING' | 'COMPLETE' | 'NOT_APPLICABLE'
  required_item_count: number
  resolved_item_count: number
  pending_item_count: number
  withheld_reason: string
  computed_at: string
}

export type FinalGrade = {
  id: number
  schedule: number | null
  subject: number
  student: number
  prelim_grade: string | null
  midterm_grade: string | null
  prefinal_grade: string | null
  final_period_grade: string | null
  final_grade: string | null
  remarks: string
  completion_status: 'PENDING' | 'COMPLETE' | 'NOT_APPLICABLE'
  completed_period_count: number
  required_period_count: number
  withheld_reason: string
  computed_at: string
}

export type PointLedger = {
  id: number
  student: number
  source: string
  points: number
  description: string
  created_at: string
}

export type Badge = {
  id: number
  name: string
  description: string
  icon: string
  points_required: number
  is_active: boolean
}

export type StudentBadge = {
  id: number
  student: number
  badge: number
  awarded_at: string
}

export type LevelRule = {
  id: number
  level: number
  name: string
  points_required: number
}

export type TeacherGradeSummary = {
  active_classes: number
  active_enrollments: number
  grade_items: number
  pending_records: number
  completed_finals: number
}

export type TeacherClassGradeSummary = {
  schedule: SubjectSchedule
  active_student_count: number
  grade_item_count: number
  pending_item_count: number
  configured_period_count: number
  weights_ready: boolean
  completed_period_count: number
  expected_period_count: number
  completion_percent: number
}

export type TeacherGradesOverviewPage = Omit<ApiPage<TeacherClassGradeSummary>, 'next' | 'previous'> & {
  next: number | string | null
  previous: number | string | null
  summary: TeacherGradeSummary
  terms: SchoolYearSemester[]
}

export type TeacherGradebookPage = {
  schedule: SubjectSchedule
  enrollments: ScheduleStudent[]
  categories: GradeCategory[]
  items: GradeItem[]
  scores: StudentGradeItemScore[]
  category_grades: StudentCategoryGrade[]
  modules: Module[]
  activities: ModuleActivity[]
  activity_attempts: ModuleActivityAttempt[]
  attendance_sessions: AttendanceSession[]
  users: User[]
  status_counts: Record<'PENDING' | 'ONLINE' | 'PAPER' | 'EXCUSED' | 'OVERRIDDEN', number>
  count: number
  total_count: number
  next: number | string | null
  previous: number | string | null
}
