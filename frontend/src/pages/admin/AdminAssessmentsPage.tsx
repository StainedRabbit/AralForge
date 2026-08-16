import type { AuthedRequest, RouteData } from '../../app/types'
import {
  AdminResourcePanel,
  type AdminField,
} from '../../components/admin/AdminResourcePanel'
import { Page, PageHeader } from '../../components/ui'
import type {
  Answer,
  Assessment,
  AssessmentAttempt,
  AssessmentAttemptQuestion,
  Choice,
  Question,
} from '../../types'
import {
  assessmentKindOptions,
  assessmentName,
  booleanLabel,
  moduleName,
  questionName,
  questionTypeOptions,
  studentUsers,
  subjectName,
  toOptions,
  userName,
} from '../../admin/adminHelpers'
import { numeric } from '../../utils/format'
import { fullName } from '../../utils/student'

export function AdminAssessmentsPage({
  api,
  data,
  refresh,
}: {
  api: AuthedRequest
  data: RouteData
  refresh: () => Promise<void>
}) {
  const subjectOptions = toOptions(
    data.subjects,
    (subject) => subject.id,
    (subject) => `${subject.code} ${subject.name}`,
  )
  const moduleOptions = toOptions(data.modules, (module) => module.id, (module) => module.title)
  const assessmentOptions = toOptions(
    data.assessments,
    (assessment) => assessment.id,
    (assessment) => assessment.title,
  )
  const questionOptions = toOptions(
    data.questions,
    (question) => question.id,
    (question) => questionName(data.questions, question.id),
  )
  const choiceOptions = toOptions(
    data.choices,
    (choice) => choice.id,
    (choice) => `${questionName(data.questions, choice.question)} - ${choice.text}`,
  )
  const studentOptions = toOptions(studentUsers(data.users), (user) => user.id, fullName)
  const attemptOptions = toOptions(
    data.attempts,
    (attempt) => attempt.id,
    (attempt) =>
      `${userName(data.users, attempt.student)} - ${assessmentName(data.assessments, attempt.assessment)} #${attempt.attempt_number}`,
  )

  return (
    <Page>
      <PageHeader
        eyebrow="Checks and exams"
        title="Assessments"
        description="Author assessments, build question sheets, manage choices, and grade student attempts."
      />

      <AdminResourcePanel<Assessment>
        api={api}
        columns={[
          { header: 'Title', render: (assessment) => assessment.title },
          { header: 'Kind', render: (assessment) => assessment.kind },
          { header: 'Subject', render: (assessment) => subjectName(data.subjects, assessment.subject) },
          { header: 'Module', render: (assessment) => moduleName(data.modules, assessment.module) },
          { header: 'Published', render: (assessment) => booleanLabel(assessment.is_published) },
        ]}
        endpoint="/assessments/assessments/"
        fields={assessmentFields(subjectOptions, moduleOptions)}
        getSearchText={(assessment) =>
          `${assessment.title} ${assessment.kind} ${assessment.instructions}`
        }
        items={data.assessments}
        noun="Assessment"
        onRefresh={refresh}
        title="Assessments"
      />

      <AdminResourcePanel<Question>
        api={api}
        columns={[
          { header: 'Assessment', render: (question) => assessmentName(data.assessments, question.assessment) },
          { header: 'Order', render: (question) => question.order },
          { header: 'Type', render: (question) => question.question_type },
          { header: 'Points', render: (question) => numeric(question.points) },
          { header: 'Prompt', render: (question) => question.prompt.slice(0, 80) },
        ]}
        endpoint="/assessments/questions/"
        fields={questionFields(assessmentOptions, moduleOptions)}
        getSearchText={(question) =>
          `${question.prompt} ${question.question_type} ${question.explanation ?? ''}`
        }
        items={data.questions}
        noun="Question"
        onRefresh={refresh}
        title="Questions"
      />

      <AdminResourcePanel<Choice>
        api={api}
        columns={[
          { header: 'Question', render: (choice) => questionName(data.questions, choice.question) },
          { header: 'Text', render: (choice) => choice.text },
          { header: 'Correct', render: (choice) => booleanLabel(Boolean(choice.is_correct)) },
          { header: 'Order', render: (choice) => choice.order },
        ]}
        endpoint="/assessments/choices/"
        fields={choiceFields(questionOptions)}
        getSearchText={(choice) => choice.text}
        items={data.choices}
        noun="Choice"
        onRefresh={refresh}
        title="Choices"
      />

      <AdminResourcePanel<AssessmentAttempt>
        api={api}
        columns={[
          { header: 'Student', render: (attempt) => userName(data.users, attempt.student) },
          { header: 'Assessment', render: (attempt) => assessmentName(data.assessments, attempt.assessment) },
          { header: 'Attempt', render: (attempt) => attempt.attempt_number },
          { header: 'Score', render: (attempt) => attempt.score ?? 'Pending' },
          { header: 'Submitted', render: (attempt) => booleanLabel(attempt.is_submitted) },
        ]}
        endpoint="/assessments/attempts/"
        fields={attemptFields(assessmentOptions, studentOptions, moduleOptions)}
        getSearchText={(attempt) =>
          `${userName(data.users, attempt.student)} ${assessmentName(data.assessments, attempt.assessment)}`
        }
        items={data.attempts}
        noun="Attempt"
        onRefresh={refresh}
        title="Assessment Attempts"
      />

      <AdminResourcePanel<AssessmentAttemptQuestion>
        api={api}
        columns={[
          {
            header: 'Attempt',
            render: (item) =>
              attemptOptions.find((option) => Number(option.value) === item.attempt)
                ?.label ?? 'Attempt',
          },
          { header: 'Question', render: (item) => questionName(data.questions, item.question) },
          { header: 'Order', render: (item) => item.order },
        ]}
        endpoint="/assessments/attempt-questions/"
        fields={attemptQuestionFields(attemptOptions, questionOptions)}
        getSearchText={(item) =>
          `${questionName(data.questions, item.question)} ${item.order}`
        }
        items={data.attemptQuestions}
        noun="Attempt Question"
        onRefresh={refresh}
        title="Mock Attempt Questions"
      />

      <AdminResourcePanel<Answer>
        api={api}
        columns={[
          {
            header: 'Attempt',
            render: (answer) =>
              attemptOptions.find((option) => Number(option.value) === answer.attempt)
                ?.label ?? 'Attempt',
          },
          { header: 'Question', render: (answer) => questionName(data.questions, answer.question) },
          { header: 'Correct', render: (answer) => answer.is_correct === null ? 'Pending' : booleanLabel(answer.is_correct) },
          { header: 'Points', render: (answer) => answer.points_earned ?? 'Pending' },
        ]}
        endpoint="/assessments/answers/"
        fields={answerFields(attemptOptions, questionOptions, choiceOptions)}
        getSearchText={(answer) =>
          `${answer.text_answer} ${answer.code_answer} ${answer.feedback}`
        }
        items={data.answers}
        noun="Answer"
        onRefresh={refresh}
        title="Answer Grading"
      />
    </Page>
  )
}

function assessmentFields(
  subjectOptions: { label: string; value: number | string }[],
  moduleOptions: { label: string; value: number | string }[],
) {
  return [
    { label: 'Title', name: 'title', required: true, type: 'text' },
    {
      defaultValue: 'QUIZ',
      label: 'Kind',
      name: 'kind',
      options: assessmentKindOptions,
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
    { label: 'Instructions', name: 'instructions', rows: 4, type: 'textarea' },
    { defaultValue: '100.00', label: 'Points', name: 'points_possible', type: 'number' },
    {
      defaultValue: '25',
      label: 'Mock question count',
      name: 'mock_question_count',
      type: 'number',
    },
    { label: 'Time limit minutes', name: 'time_limit_minutes', nullable: true, type: 'number' },
    { defaultValue: '1', label: 'Max attempts', name: 'max_attempts', type: 'number' },
    { defaultValue: false, label: 'Randomize questions', name: 'randomize_questions', type: 'checkbox' },
    { defaultValue: false, label: 'Show answers after submit', name: 'show_answers_after_submit', type: 'checkbox' },
    { defaultValue: false, label: 'Counts toward grade', name: 'counts_toward_grade', type: 'checkbox' },
    { defaultValue: false, label: 'Published', name: 'is_published', type: 'checkbox' },
    { label: 'Opens at', name: 'opens_at', nullable: true, type: 'datetime-local' },
    { label: 'Closes at', name: 'closes_at', nullable: true, type: 'datetime-local' },
  ] satisfies AdminField<Assessment>[]
}

function questionFields(
  assessmentOptions: { label: string; value: number | string }[],
  moduleOptions: { label: string; value: number | string }[],
) {
  return [
    {
      label: 'Assessment',
      name: 'assessment',
      options: assessmentOptions,
      parse: Number,
      required: true,
      type: 'select',
    },
    {
      defaultValue: 'MULTIPLE_CHOICE',
      label: 'Question type',
      name: 'question_type',
      options: questionTypeOptions,
      required: true,
      type: 'select',
    },
    { label: 'Prompt', name: 'prompt', required: true, rows: 5, type: 'textarea' },
    { defaultValue: '1.00', label: 'Points', name: 'points', type: 'number' },
    { defaultValue: '0', label: 'Order', name: 'order', type: 'number' },
    { label: 'Explanation', name: 'explanation', rows: 3, type: 'textarea' },
    {
      label: 'Mock topics',
      name: 'topics',
      options: moduleOptions,
      type: 'multiselect',
    },
  ] satisfies AdminField<Question>[]
}

function choiceFields(questionOptions: { label: string; value: number | string }[]) {
  return [
    {
      label: 'Question',
      name: 'question',
      options: questionOptions,
      parse: Number,
      required: true,
      type: 'select',
    },
    { label: 'Text', name: 'text', required: true, type: 'text' },
    { defaultValue: false, label: 'Correct', name: 'is_correct', type: 'checkbox' },
    { defaultValue: '0', label: 'Order', name: 'order', type: 'number' },
  ] satisfies AdminField<Choice>[]
}

function attemptFields(
  assessmentOptions: { label: string; value: number | string }[],
  studentOptions: { label: string; value: number | string }[],
  moduleOptions: { label: string; value: number | string }[],
) {
  return [
    {
      label: 'Assessment',
      name: 'assessment',
      options: assessmentOptions,
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
    { defaultValue: '1', label: 'Attempt number', name: 'attempt_number', type: 'number' },
    { label: 'Score', name: 'score', nullable: true, type: 'number' },
    { label: 'Submitted at', name: 'submitted_at', nullable: true, type: 'datetime-local' },
    { defaultValue: false, label: 'Submitted', name: 'is_submitted', type: 'checkbox' },
    {
      label: 'Selected topics',
      name: 'selected_topics',
      options: moduleOptions,
      type: 'multiselect',
    },
  ] satisfies AdminField<AssessmentAttempt>[]
}

function attemptQuestionFields(
  attemptOptions: { label: string; value: number | string }[],
  questionOptions: { label: string; value: number | string }[],
) {
  return [
    {
      label: 'Attempt',
      name: 'attempt',
      options: attemptOptions,
      parse: Number,
      required: true,
      type: 'select',
    },
    {
      label: 'Question',
      name: 'question',
      options: questionOptions,
      parse: Number,
      required: true,
      type: 'select',
    },
    { defaultValue: '0', label: 'Order', name: 'order', type: 'number' },
  ] satisfies AdminField<AssessmentAttemptQuestion>[]
}

function answerFields(
  attemptOptions: { label: string; value: number | string }[],
  questionOptions: { label: string; value: number | string }[],
  choiceOptions: { label: string; value: number | string }[],
) {
  return [
    {
      label: 'Attempt',
      name: 'attempt',
      options: attemptOptions,
      parse: Number,
      required: true,
      type: 'select',
    },
    {
      label: 'Question',
      name: 'question',
      options: questionOptions,
      parse: Number,
      required: true,
      type: 'select',
    },
    {
      label: 'Selected choice',
      name: 'selected_choice',
      nullable: true,
      options: choiceOptions,
      parse: (value) => (value ? Number(value) : null),
      type: 'select',
    },
    { label: 'Text answer', name: 'text_answer', rows: 4, type: 'textarea' },
    { label: 'Code answer', name: 'code_answer', rows: 6, type: 'textarea' },
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
  ] satisfies AdminField<Answer>[]
}
