import type { AuthedRequest, RouteData } from '../../app/types'
import {
  AdminResourcePanel,
  type AdminField,
} from '../../components/admin/AdminResourcePanel'
import { Page, PageHeader } from '../../components/ui'
import type {
  CodeBlank,
  CodeBlankAnswer,
  CodeSubmission,
  ProgrammingProblem,
  TestCase,
} from '../../types'
import {
  booleanLabel,
  codeStatusOptions,
  difficultyOptions,
  moduleName,
  problemName,
  questionName,
  studentUsers,
  subjectName,
  toOptions,
  userName,
} from '../../admin/adminHelpers'
import { formatDateTime, numeric } from '../../utils/format'
import { fullName } from '../../utils/student'

export function AdminCodingPage({
  api,
  data,
  refresh,
}: {
  api: AuthedRequest
  data: RouteData
  refresh: () => Promise<void>
}) {
  const blanks = data.problems.flatMap((problem) => problem.blanks)
  const subjectOptions = toOptions(
    data.subjects,
    (subject) => subject.id,
    (subject) => `${subject.code} ${subject.name}`,
  )
  const moduleOptions = toOptions(data.modules, (module) => module.id, (module) => module.title)
  const topicOptions = toOptions(data.moduleTopics, (topic) => topic.id, (topic) => topic.title)
  const lessonOptions = toOptions(data.moduleLessons, (lesson) => lesson.id, (lesson) => lesson.title)
  const questionOptions = toOptions(
    data.questions,
    (question) => question.id,
    (question) => questionName(data.questions, question.id),
  )
  const problemOptions = toOptions(
    data.problems,
    (problem) => problem.id,
    (problem) => problem.title,
  )
  const studentOptions = toOptions(studentUsers(data.users), (user) => user.id, fullName)
  const attemptOptions = toOptions(
    data.attempts,
    (attempt) => attempt.id,
    (attempt) =>
      `${userName(data.users, attempt.student)} - ${attempt.attempt_number}`,
  )
  const blankOptions = toOptions(
    blanks,
    (blank) => blank.id,
    (blank) => `${problemName(data.problems, blank.problem)} - ${blank.key}`,
  )
  const submissionOptions = toOptions(
    data.codeSubmissions,
    (submission) => submission.id,
    (submission) =>
      `${userName(data.users, submission.student)} - ${problemName(data.problems, submission.problem)}`,
  )

  return (
    <Page>
      <PageHeader
        eyebrow="Coding lab"
        title="Coding"
        description="Create programming problems, define blanks and tests, then review and grade submitted code."
      />

      <AdminResourcePanel<ProgrammingProblem>
        api={api}
        columns={[
          { header: 'Problem', render: (problem) => problem.title },
          { header: 'Difficulty', render: (problem) => problem.difficulty },
          { header: 'Subject', render: (problem) => subjectName(data.subjects, problem.subject) },
          { header: 'Module', render: (problem) => moduleName(data.modules, problem.module) },
          { header: 'Topic', render: (problem) => topicName(data.moduleTopics, problem.topic) },
          { header: 'Lesson', render: (problem) => lessonName(data.moduleLessons, problem.lesson) },
          { header: 'Published', render: (problem) => booleanLabel(problem.is_published) },
        ]}
        endpoint="/coding/problems/"
        fields={problemFields(subjectOptions, moduleOptions, topicOptions, lessonOptions, questionOptions)}
        getSearchText={(problem) =>
          `${problem.title} ${problem.slug} ${problem.description} ${problem.expected_language}`
        }
        items={data.problems}
        noun="Problem"
        onRefresh={refresh}
        title="Programming Problems"
      />

      <AdminResourcePanel<CodeBlank>
        api={api}
        columns={[
          { header: 'Problem', render: (blank) => problemName(data.problems, blank.problem) },
          { header: 'Key', render: (blank) => blank.key },
          { header: 'Order', render: (blank) => blank.order },
          { header: 'Points', render: (blank) => numeric(blank.points) },
        ]}
        endpoint="/coding/blanks/"
        fields={blankFields(problemOptions)}
        getSearchText={(blank) =>
          `${blank.key} ${blank.prompt} ${blank.expected_answer} ${blank.hint}`
        }
        items={blanks}
        noun="Blank"
        onRefresh={refresh}
        title="Code Blanks"
      />

      <AdminResourcePanel<TestCase>
        api={api}
        columns={[
          { header: 'Problem', render: (test) => problemName(data.problems, test.problem) },
          { header: 'Order', render: (test) => test.order },
          { header: 'Hidden', render: (test) => booleanLabel(test.is_hidden) },
          { header: 'Expected', render: (test) => test.expected_output.slice(0, 80) },
        ]}
        endpoint="/coding/test-cases/"
        fields={testCaseFields(problemOptions)}
        getSearchText={(test) => `${test.input_data} ${test.expected_output}`}
        items={data.testCases}
        noun="Test case"
        onRefresh={refresh}
        title="Test Cases"
      />

      <AdminResourcePanel<CodeSubmission>
        api={api}
        columns={[
          { header: 'Student', render: (submission) => userName(data.users, submission.student) },
          { header: 'Problem', render: (submission) => problemName(data.problems, submission.problem) },
          { header: 'Status', render: (submission) => submission.status },
          { header: 'Score', render: (submission) => submission.score ?? 'Pending' },
          { header: 'Submitted', render: (submission) => formatDateTime(submission.submitted_at) },
        ]}
        endpoint="/coding/submissions/"
        fields={submissionFields(problemOptions, studentOptions, attemptOptions)}
        getSearchText={(submission) =>
          `${submission.language} ${submission.source_code} ${submission.output} ${submission.error}`
        }
        items={data.codeSubmissions}
        noun="Code submission"
        onRefresh={refresh}
        title="Code Submission Grading"
      />

      <AdminResourcePanel<CodeBlankAnswer>
        api={api}
        columns={[
          {
            header: 'Submission',
            render: (answer) =>
              data.codeSubmissions.find((submission) => submission.id === answer.submission)
                ?.language ?? 'Submission',
          },
          { header: 'Blank', render: (answer) => blankOptions.find((option) => Number(option.value) === answer.blank)?.label ?? 'Blank' },
          { header: 'Correct', render: (answer) => answer.is_correct === null ? 'Pending' : booleanLabel(answer.is_correct) },
          { header: 'Points', render: (answer) => answer.points_earned ?? 'Pending' },
        ]}
        endpoint="/coding/blank-answers/"
        fields={blankAnswerFields(submissionOptions, blankOptions)}
        getSearchText={(answer) => `${answer.answer} ${answer.feedback}`}
        items={data.codeBlankAnswers}
        noun="Blank answer"
        onRefresh={refresh}
        title="Blank Answer Grading"
      />
    </Page>
  )
}

function problemFields(
  subjectOptions: { label: string; value: number | string }[],
  moduleOptions: { label: string; value: number | string }[],
  topicOptions: { label: string; value: number | string }[],
  lessonOptions: { label: string; value: number | string }[],
  questionOptions: { label: string; value: number | string }[],
) {
  return [
    { label: 'Title', name: 'title', required: true, type: 'text' },
    { label: 'Slug', name: 'slug', required: true, type: 'text' },
    { label: 'Description', name: 'description', required: true, rows: 5, type: 'textarea' },
    { label: 'Starter code', name: 'starter_code', rows: 8, type: 'textarea' },
    { label: 'Language', name: 'expected_language', type: 'text' },
    {
      defaultValue: 'EASY',
      label: 'Difficulty',
      name: 'difficulty',
      options: difficultyOptions,
      required: true,
      type: 'select',
    },
    {
      label: 'Subject',
      name: 'subject',
      nullable: true,
      options: subjectOptions,
      parse: (value) => (value ? Number(value) : null),
      type: 'select',
    },
    {
      label: 'Module',
      name: 'module',
      nullable: true,
      options: moduleOptions,
      parse: (value) => (value ? Number(value) : null),
      type: 'select',
    },
    {
      label: 'Topic',
      name: 'topic',
      nullable: true,
      options: topicOptions,
      parse: (value) => (value ? Number(value) : null),
      type: 'select',
    },
    {
      label: 'Lesson',
      name: 'lesson',
      nullable: true,
      options: lessonOptions,
      parse: (value) => (value ? Number(value) : null),
      type: 'select',
    },
    {
      label: 'Assessment question',
      name: 'assessment_question',
      nullable: true,
      options: questionOptions,
      parse: (value) => (value ? Number(value) : null),
      type: 'select',
    },
    { defaultValue: '100.00', label: 'Points', name: 'points_possible', type: 'number' },
    { defaultValue: false, label: 'Published', name: 'is_published', type: 'checkbox' },
  ] satisfies AdminField<ProgrammingProblem>[]
}

function topicName(topics: { id: number; title: string }[], topicId: number | null) {
  return topics.find((topic) => topic.id === topicId)?.title ?? 'Not set'
}

function lessonName(lessons: { id: number; title: string }[], lessonId: number | null) {
  return lessons.find((lesson) => lesson.id === lessonId)?.title ?? 'Not set'
}

function blankFields(problemOptions: { label: string; value: number | string }[]) {
  return [
    {
      label: 'Problem',
      name: 'problem',
      options: problemOptions,
      parse: Number,
      required: true,
      type: 'select',
    },
    { label: 'Key', name: 'key', required: true, type: 'text' },
    { label: 'Prompt', name: 'prompt', rows: 3, type: 'textarea' },
    { label: 'Expected answer', name: 'expected_answer', required: true, rows: 3, type: 'textarea' },
    { label: 'Hint', name: 'hint', rows: 2, type: 'textarea' },
    { defaultValue: '0', label: 'Order', name: 'order', type: 'number' },
    { defaultValue: '1.00', label: 'Points', name: 'points', type: 'number' },
  ] satisfies AdminField<CodeBlank>[]
}

function testCaseFields(problemOptions: { label: string; value: number | string }[]) {
  return [
    {
      label: 'Problem',
      name: 'problem',
      options: problemOptions,
      parse: Number,
      required: true,
      type: 'select',
    },
    { label: 'Input', name: 'input_data', rows: 3, type: 'textarea' },
    { label: 'Expected output', name: 'expected_output', required: true, rows: 3, type: 'textarea' },
    { defaultValue: false, label: 'Hidden', name: 'is_hidden', type: 'checkbox' },
    { defaultValue: '0', label: 'Order', name: 'order', type: 'number' },
  ] satisfies AdminField<TestCase>[]
}

function submissionFields(
  problemOptions: { label: string; value: number | string }[],
  studentOptions: { label: string; value: number | string }[],
  attemptOptions: { label: string; value: number | string }[],
) {
  return [
    {
      label: 'Problem',
      name: 'problem',
      options: problemOptions,
      parse: Number,
      required: true,
      type: 'select',
    },
    {
      label: 'Student',
      name: 'student',
      options: studentOptions,
      parse: Number,
      required: true,
      type: 'select',
    },
    {
      label: 'Assessment attempt',
      name: 'assessment_attempt',
      nullable: true,
      options: attemptOptions,
      parse: (value) => (value ? Number(value) : null),
      type: 'select',
    },
    { defaultValue: 'python', label: 'Language', name: 'language', required: true, type: 'text' },
    { label: 'Source code', name: 'source_code', required: true, rows: 8, type: 'textarea' },
    {
      defaultValue: 'PENDING',
      label: 'Status',
      name: 'status',
      options: codeStatusOptions,
      required: true,
      type: 'select',
    },
    { label: 'Score', name: 'score', nullable: true, type: 'number' },
    { label: 'Output', name: 'output', rows: 3, type: 'textarea' },
    { label: 'Error', name: 'error', rows: 3, type: 'textarea' },
  ] satisfies AdminField<CodeSubmission>[]
}

function blankAnswerFields(
  submissionOptions: { label: string; value: number | string }[],
  blankOptions: { label: string; value: number | string }[],
) {
  return [
    {
      label: 'Submission',
      name: 'submission',
      options: submissionOptions,
      parse: Number,
      required: true,
      type: 'select',
    },
    {
      label: 'Blank',
      name: 'blank',
      options: blankOptions,
      parse: Number,
      required: true,
      type: 'select',
    },
    { label: 'Answer', name: 'answer', required: true, rows: 3, type: 'textarea' },
    {
      label: 'Correct',
      name: 'is_correct',
      nullable: true,
      options: [
        { label: 'Pending', value: '' },
        { label: 'Correct', value: 'true' },
        { label: 'Incorrect', value: 'false' },
      ],
      parse: (value) => (value === '' ? null : value === 'true'),
      type: 'select',
    },
    { label: 'Points earned', name: 'points_earned', nullable: true, type: 'number' },
    { label: 'Feedback', name: 'feedback', rows: 3, type: 'textarea' },
  ] satisfies AdminField<CodeBlankAnswer>[]
}
