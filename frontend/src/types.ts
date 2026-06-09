export type Role = 'ADMIN' | 'TEACHER' | 'STUDENT'

export type ApiList<T> = T[] | { results: T[] }

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
}

export type Module = {
  id: number
  title: string
  slug: string
  description: string
  content: string
  pdf_file: string
  is_paid: boolean
  price: string
  is_accessible: boolean
  subjects: number[]
  is_published: boolean
  created_at: string
  updated_at: string
}

export type ModuleAccess = {
  id: number
  module: number
  module_title: string
  student: number
  student_name: string
  activated_by: number | null
  activated_by_name: string
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

export type ModuleActivity = {
  id: number
  module: number
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
  is_published: boolean
  created_at: string
}

export type ModuleProgress = {
  id: number
  module: number
  student: number
  started_at: string
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
  created_at: string
  items: GradingTemplateItem[]
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

export type StudentCategoryGrade = {
  id: number
  subject: number
  student: number
  grade_category: number
  raw_score: string
  total_score: string
  transmuted_grade: string | null
  weighted_score: string | null
  computed_at: string
}

export type PeriodGrade = {
  id: number
  subject: number
  student: number
  grading_period: 'PRELIM' | 'MIDTERM' | 'PREFINAL' | 'FINAL'
  raw_score: string | null
  remarks: string
  computed_at: string
}

export type FinalGrade = {
  id: number
  subject: number
  student: number
  prelim_grade: string | null
  midterm_grade: string | null
  prefinal_grade: string | null
  final_period_grade: string | null
  final_grade: string | null
  remarks: string
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
