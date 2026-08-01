export type Role = 'ADMIN' | 'TEACHER' | 'STUDENT'

export type ApiPage<T> = {
  count: number
  next: number | null
  previous: number | null
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
  last_name: string
  role: Role
  is_admin_teacher: boolean
  is_active: boolean
}

export type StudentProfile = {
  id: number
  user: number
  user_detail?: User
  student_number: string
  section: string
  year_level: number | null
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
  subject: number
  subject_code: string
  subject_name: string
  school_year_semester: number
  term_name: string
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
  pdf_file: string
  pdf_generated_at: string | null
  pdf_is_outdated: boolean
  is_paid: boolean
  price: string
  is_accessible: boolean
  access_status: 'ADMIN' | 'LOCKED' | 'ENROLLED_PAID' | 'ADVANCE_PAID'
  has_pdf: boolean
  subjects: number[]
  is_published: boolean
  created_at: string
  updated_at: string
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
  key_terms: string
  before_you_start: string
  short_discussion: string
  guided_examples: string
  lets_practice: string
  apply_what_you_learned: string
  challenge_task: string
  rubric: string
  reflection: string
  evidence_of_learning: string
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
  assessment_url: string
  pdf_file: string
  pdf_generated_at: string | null
  pdf_is_outdated: boolean
  has_pdf: boolean
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
  mini_check: string
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
  activated_by: number | null
  activated_by_name: string
  access_type: 'PAYMENT' | 'ADVANCE_STUDY'
  payment_status: 'UNPAID' | 'PAID' | 'WAIVED'
  amount_paid: string
  payment_reference: string
  is_active: boolean
  is_available: boolean
  expires_at: string | null
  notes: string
  activated_at: string
  updated_at: string
}

export type ModuleActivityType =
  | 'TEXT'
  | 'FILE_UPLOAD'
  | 'CODE_COMPLETE'
  | 'CODE_FILL_BLANK'
  | 'INTERACTIVE'

export type ModuleActivity = {
  id: number
  module: number
  topic: number | null
  lesson: number | null
  programming_problem: number | null
  title: string
  instructions: string
  activity_type: ModuleActivityType
  order: number
  points_possible: string
  due_at: string | null
  accepts_text: boolean
  accepts_file: boolean
  accepts_code: boolean
  max_attempts: number
  passing_score: string | null
  is_published: boolean
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
  attempt_number: number
  score: string | null
  max_score: string
  started_at: string
  submitted_at: string | null
  is_submitted: boolean
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
  started_at: string
  completed_at: string | null
}

export type ModuleTopicProgress = {
  id: number
  topic: number
  student: number
  started_at: string
  completed_at: string | null
}

export type ModuleLessonProgress = {
  id: number
  lesson: number
  student: number
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
  code: string
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
  students: ModuleTeacherSummaryStudent[]
}

export type CodeBlank = {
  id: number
  problem: number
  key: string
  prompt: string
  expected_answer?: string
  hint: string
  order: number
  points: string
}

export type TestCase = {
  id: number
  problem: number
  input_data: string
  expected_output: string
  is_hidden: boolean
  order: number
}

export type ProgrammingProblem = {
  id: number
  title: string
  slug: string
  description: string
  starter_code: string
  expected_language: string
  difficulty: 'EASY' | 'MEDIUM' | 'HARD'
  subject: number | null
  module: number | null
  topic: number | null
  lesson: number | null
  assessment_question: number | null
  points_possible: string
  is_published: boolean
  created_at: string
  test_cases: TestCase[]
  blanks: CodeBlank[]
}

export type CodeSubmission = {
  id: number
  problem: number
  student: number
  assessment_attempt: number | null
  language: string
  source_code: string
  status: string
  score: string | null
  output: string
  error: string
  submitted_at: string
}

export type CodeBlankAnswer = {
  id: number
  submission: number
  blank: number
  answer: string
  is_correct: boolean | null
  points_earned: string | null
  feedback: string
}

export type Assessment = {
  id: number
  title: string
  kind: string
  subject: number | null
  module: number | null
  instructions: string
  points_possible: string
  mock_question_count: number
  time_limit_minutes: number | null
  max_attempts: number
  randomize_questions: boolean
  show_answers_after_submit: boolean
  counts_toward_grade: boolean
  is_published: boolean
  opens_at: string | null
  closes_at: string | null
  created_at: string
  updated_at: string
}

export type AssessmentAttempt = {
  id: number
  assessment: number
  student: number
  attempt_number: number
  score: string | null
  started_at: string
  submitted_at: string | null
  is_submitted: boolean
  selected_topics: number[]
  selected_module_topics: number[]
  selected_question_ids: number[]
}

export type AssessmentAttemptQuestion = {
  id: number
  attempt: number
  question: number
  order: number
}

export type Choice = {
  id: number
  question: number
  text: string
  is_correct?: boolean
  order: number
}

export type Question = {
  id: number
  assessment: number
  question_type:
    | 'MULTIPLE_CHOICE'
    | 'TRUE_FALSE'
    | 'SHORT_ANSWER'
    | 'ESSAY'
    | 'CODING'
  prompt: string
  points: string
  order: number
  explanation?: string
  topics: number[]
  module_topics: number[]
  choices: Choice[]
}

export type Answer = {
  id: number
  attempt: number
  question: number
  selected_choice: number | null
  text_answer: string
  code_answer: string
  is_correct: boolean | null
  points_earned: string | null
  feedback: string
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
  source_template: number | null
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
  grading_period: 'PRELIM' | 'MIDTERM' | 'PREFINAL' | 'FINAL'
  category: 'QUIZ' | 'EXAM' | 'ACTIVITY' | 'ATTENDANCE' | 'CODING' | 'OTHER'
  name: string
  weight: string
}

export type GradeCategory = {
  id: number
  subject: number
  template_item: number | null
  grading_period: 'PRELIM' | 'MIDTERM' | 'PREFINAL' | 'FINAL'
  category: 'QUIZ' | 'EXAM' | 'ACTIVITY' | 'ATTENDANCE' | 'CODING' | 'OTHER'
  name: string
  weight: string
}

export type GradeItemSourceType =
  | 'MANUAL'
  | 'ASSESSMENT'
  | 'MODULE_ACTIVITY'
  | 'ATTENDANCE'
  | 'CODING'

export type GradeItem = {
  id: number
  schedule: number | null
  grade_category: number
  subject: number
  title: string
  points_possible: string
  order: number
  is_required: boolean
  source_type: GradeItemSourceType
  assessment: number | null
  module_activity: number | null
  attendance_session: number | null
  coding_problem: number | null
  source_title: string
  source_points_possible: string
  created_at: string
  updated_at: string
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
  grading_period: 'PRELIM' | 'MIDTERM' | 'PREFINAL' | 'FINAL'
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
