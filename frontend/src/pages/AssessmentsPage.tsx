import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import type { AuthedRequest, AnswerDraft, WorkspaceData } from '../app/types'
import { AssessmentRow } from '../components/cards'
import { Icon } from '../components/Icon'
import { QuestionCard } from '../components/QuestionCard'
import { EmptyState, NotFoundState, Page, PageHeader, SectionHeading, SkeletonList, StatusBanner } from '../components/ui'
import type { Assessment, AssessmentAttempt } from '../types'
import { displayScore, formatDateTime, toErrorMessage } from '../utils/format'
import {
  emptyAnswerDraft,
  getAssessmentQuestions,
  getMockTopicModules,
  hasActiveAssessmentAccess,
  isMockAssessment,
} from '../utils/student'

export function AssessmentsPage({
  api,
  data,
  refresh,
}: {
  api: AuthedRequest
  data: WorkspaceData
  refresh: () => Promise<void>
}) {
  const [savingId, setSavingId] = useState<number | null>(null)
  const [message, setMessage] = useState('')
  const availableAssessments = data.assessments.filter((assessment) =>
    hasActiveAssessmentAccess(data, assessment),
  )

  async function startAttempt(assessment: Assessment) {
    if (!data.currentUser || !hasActiveAssessmentAccess(data, assessment)) {
      return
    }

    if (isMockAssessment(assessment)) {
      setMessage('Open the mock exam and select topics before starting.')
      return
    }

    setSavingId(assessment.id)
    setMessage('')

    const nextAttemptNumber =
      data.attempts.filter((attempt) => attempt.assessment === assessment.id)
        .length + 1

    try {
      await api('/assessments/attempts/', {
        method: 'POST',
        body: JSON.stringify({
          assessment: assessment.id,
          student: data.currentUser.id,
          attempt_number: nextAttemptNumber,
        }),
      })
      setMessage(`Started attempt ${nextAttemptNumber} for ${assessment.title}.`)
      await refresh()
    } catch (caughtError) {
      setMessage(toErrorMessage(caughtError))
    } finally {
      setSavingId(null)
    }
  }

  return (
    <Page>
      <PageHeader
        eyebrow="Checks and exams"
        title="Assessments"
        description="View available quizzes, practice work, and exams from your Django assessments API."
      />

      {message ? (
        <StatusBanner
          tone={message.toLowerCase().includes('started') ? 'success' : 'warning'}
          title="Assessment update"
          message={message}
        />
      ) : null}

      <div className="assessment-list">
        {data.loading ? (
          <SkeletonList count={4} />
        ) : availableAssessments.length ? (
          availableAssessments.map((assessment) => (
      <AssessmentRow
              assessment={assessment}
              attempts={data.attempts.filter(
                (attempt) => attempt.assessment === assessment.id,
              )}
              isSaving={savingId === assessment.id}
              key={assessment.id}
              onStart={() => startAttempt(assessment)}
              subject={data.subjects.find(
                (subject) => subject.id === assessment.subject,
              )}
            />
          ))
        ) : (
          <EmptyState
            icon="assessment"
            title="No assessments"
            message="Assessments for your active classes will appear here."
          />
        )}
      </div>
    </Page>
  )
}

export function AssessmentDetailPage({
  api,
  data,
  refresh,
}: {
  api: AuthedRequest
  data: WorkspaceData
  refresh: () => Promise<void>
}) {
  const { assessmentId } = useParams()
  const assessment = data.assessments.find(
    (item) => item.id === Number(assessmentId),
  )
  const [selectedAttemptId, setSelectedAttemptId] = useState<number | null>(null)
  const [responses, setResponses] = useState<Record<number, AnswerDraft>>({})
  const [selectedTopicIds, setSelectedTopicIds] = useState<number[]>([])
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  const attempts = useMemo(
    () =>
      data.attempts
        .filter((attempt) => attempt.assessment === assessment?.id)
        .sort((first, second) => second.attempt_number - first.attempt_number),
    [assessment?.id, data.attempts],
  )
  const isMock = assessment ? isMockAssessment(assessment) : false
  const canStart = assessment ? attempts.length < assessment.max_attempts : false
  const activeAttempt =
    attempts.find((attempt) => attempt.id === selectedAttemptId) ??
    attempts.find((attempt) => !attempt.is_submitted) ??
    (isMock && canStart ? null : attempts[0] ?? null)
  const topicModules = useMemo(
    () => (assessment ? getMockTopicModules(data, assessment) : []),
    [assessment, data],
  )
  const questions = useMemo(
    () => (assessment ? getAssessmentQuestions(data, assessment, activeAttempt) : []),
    [activeAttempt, assessment, data],
  )

  useEffect(() => {
    const responseTimer = window.setTimeout(() => {
    if (!activeAttempt) {
      setResponses({})
      return
    }

    const nextResponses: Record<number, AnswerDraft> = {}

    questions.forEach((question) => {
      const answer = data.answers.find(
        (item) => item.attempt === activeAttempt.id && item.question === question.id,
      )
      nextResponses[question.id] = {
        selected_choice: answer?.selected_choice ?? null,
        text_answer: answer?.text_answer ?? '',
        code_answer: answer?.code_answer ?? '',
      }
    })

    setResponses(nextResponses)
    }, 0)

    return () => window.clearTimeout(responseTimer)
  }, [activeAttempt, data.answers, questions])

  if (!assessment || !hasActiveAssessmentAccess(data, assessment)) {
    return (
      <Page>
        <NotFoundState
          message="This assessment is not available for your active classes."
          to="/assessments"
        />
      </Page>
    )
  }

  async function startAttempt() {
    if (!data.currentUser || !assessment || !hasActiveAssessmentAccess(data, assessment)) {
      return
    }

    setSaving(true)
    setMessage('')

    try {
      const attempt = isMock
        ? await api<AssessmentAttempt>(
            `/assessments/assessments/${assessment.id}/start-mock/`,
            {
              method: 'POST',
              body: JSON.stringify({
                selected_topics: selectedTopicIds,
              }),
            },
          )
        : await api<AssessmentAttempt>('/assessments/attempts/', {
            method: 'POST',
            body: JSON.stringify({
              assessment: assessment.id,
              student: data.currentUser.id,
              attempt_number: attempts.length + 1,
            }),
          })
      setSelectedAttemptId(attempt.id)
      setMessage(
        isMock
          ? `Mock exam started with ${attempt.selected_question_ids.length} question${attempt.selected_question_ids.length === 1 ? '' : 's'}.`
          : 'Attempt started. You can now answer the questions.',
      )
      await refresh()
    } catch (caughtError) {
      setMessage(toErrorMessage(caughtError))
    } finally {
      setSaving(false)
    }
  }

  async function submitAssessment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!activeAttempt) {
      setMessage('Start an attempt before submitting answers.')
      return
    }

    setSaving(true)
    setMessage('')

    try {
      await Promise.all(
        questions.map((question) => {
          const existingAnswer = data.answers.find(
            (answer) =>
              answer.attempt === activeAttempt.id && answer.question === question.id,
          )
          const draft = responses[question.id] ?? emptyAnswerDraft()
          const endpoint = existingAnswer
            ? `/assessments/answers/${existingAnswer.id}/`
            : '/assessments/answers/'
          const method = existingAnswer ? 'PATCH' : 'POST'

          return api(endpoint, {
            method,
            body: JSON.stringify({
              attempt: activeAttempt.id,
              question: question.id,
              selected_choice: draft.selected_choice,
              text_answer: draft.text_answer,
              code_answer: draft.code_answer,
            }),
          })
        }),
      )

      await api(`/assessments/attempts/${activeAttempt.id}/`, {
        method: 'PATCH',
        body: JSON.stringify({ is_submitted: true }),
      })
      setMessage('Assessment submitted.')
      await refresh()
    } catch (caughtError) {
      setMessage(toErrorMessage(caughtError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Page>
      <PageHeader
        eyebrow={assessment.kind}
        title={assessment.title}
        description={assessment.instructions || 'Answer each question before submitting.'}
        actions={
          canStart && !isMock ? (
            <button
              className="button button--secondary"
              disabled={saving}
              onClick={startAttempt}
              type="button"
            >
              <Icon name="send" />
              <span>{saving ? 'Starting...' : 'Start attempt'}</span>
            </button>
          ) : canStart && isMock && activeAttempt ? (
            <button
              className="button button--secondary"
              disabled={saving}
              onClick={() => setSelectedAttemptId(null)}
              type="button"
            >
              <Icon name="send" />
              <span>New mock attempt</span>
            </button>
          ) : null
        }
      />

      {message ? (
        <StatusBanner
          tone={message.includes('submitted') || message.includes('started') ? 'success' : 'warning'}
          title="Assessment"
          message={message}
        />
      ) : null}

      {activeAttempt?.is_submitted ? (
        <StatusBanner
          tone="success"
          title="Result"
          message={`Score: ${displayScore(activeAttempt.score)}`}
        />
      ) : null}

      <section className="content-grid">
        <form className="assessment-workspace" onSubmit={submitAssessment}>
          <SectionHeading
            subtitle={`${questions.length} question${questions.length === 1 ? '' : 's'}`}
            title="Question Sheet"
          />

          {!activeAttempt && isMock ? (
            <MockTopicPicker
              canStart={canStart}
              isSaving={saving}
              onStart={startAttempt}
              selectedTopicIds={selectedTopicIds}
              setSelectedTopicIds={setSelectedTopicIds}
              data={data}
              topics={topicModules}
            />
          ) : !activeAttempt ? (
            <EmptyState
              icon="assessment"
              title="No active attempt"
              message="Start an attempt to unlock the answer sheet."
            />
          ) : questions.length ? (
            questions.map((question, index) => (
              <QuestionCard
                data={data}
                draft={responses[question.id] ?? emptyAnswerDraft()}
                key={question.id}
                number={index + 1}
                onChange={(draft) =>
                  setResponses((current) => ({
                    ...current,
                    [question.id]: draft,
                  }))
                }
                question={question}
                readonly={activeAttempt.is_submitted}
              />
            ))
          ) : (
            <EmptyState
              icon="assessment"
              title="No questions yet"
              message="Questions created in the backend will appear here."
            />
          )}

          {activeAttempt && questions.length ? (
            <button
              className="button button--primary"
              disabled={saving || activeAttempt.is_submitted}
              type="submit"
            >
              <Icon name="send" />
              <span>
                {activeAttempt.is_submitted
                  ? 'Already submitted'
                  : saving
                    ? 'Submitting...'
                    : 'Submit assessment'}
              </span>
            </button>
          ) : null}
        </form>

        <aside className="section-block">
          <SectionHeading subtitle="Attempt history" title="Attempts" />
          <div className="timeline-list">
            {attempts.length ? (
              attempts.map((attempt) => (
                <button
                  className={`attempt-item ${activeAttempt?.id === attempt.id ? 'active' : ''}`}
                  key={attempt.id}
                  onClick={() => setSelectedAttemptId(attempt.id)}
                  type="button"
                >
                  <span className="timeline-dot">
                    <Icon name={attempt.is_submitted ? 'check' : 'assessment'} />
                  </span>
                  <span>
                    <strong>Attempt {attempt.attempt_number}</strong>
                    <small>
                      {attempt.is_submitted ? 'Submitted' : 'In progress'} ·{' '}
                      {formatDateTime(attempt.started_at)}
                    </small>
                    <small>Score: {displayScore(attempt.score)}</small>
                  </span>
                </button>
              ))
            ) : (
              <EmptyState
                icon="assessment"
                title="No attempts"
                message="Start an attempt when you are ready."
              />
            )}
          </div>
        </aside>
      </section>
    </Page>
  )
}

function MockTopicPicker({
  canStart,
  isSaving,
  onStart,
  selectedTopicIds,
  setSelectedTopicIds,
  data,
  topics,
}: {
  canStart: boolean
  data: WorkspaceData
  isSaving: boolean
  onStart: () => void
  selectedTopicIds: number[]
  setSelectedTopicIds: (ids: number[]) => void
  topics: ReturnType<typeof getMockTopicModules>
}) {
  function toggleTopic(topicId: number) {
    setSelectedTopicIds(
      selectedTopicIds.includes(topicId)
        ? selectedTopicIds.filter((id) => id !== topicId)
        : [...selectedTopicIds, topicId],
    )
  }

  return (
    <div className="question-card">
      <div className="question-card__header">
        <span className="subject-chip">Mock topics</span>
        <span className="status-pill">{selectedTopicIds.length} selected</span>
      </div>

      {topics.length ? (
        <div className="choice-list">
          {topics.map((topic) => (
            <label className="choice-option" key={topic.id}>
              <input
                checked={selectedTopicIds.includes(topic.id)}
                disabled={!canStart || isSaving}
                onChange={() => toggleTopic(topic.id)}
                type="checkbox"
              />
              <span>
                {topic.title} - {mockTopicParentLabel(data, topic.module)}
              </span>
            </label>
          ))}
        </div>
      ) : (
        <EmptyState
          icon="book"
          title="No available topics"
          message="Published modules for this mock exam will appear here."
        />
      )}

      <button
        className="button button--primary"
        disabled={!canStart || isSaving || !selectedTopicIds.length}
        onClick={onStart}
        type="button"
      >
        <Icon name="send" />
        <span>{isSaving ? 'Starting...' : canStart ? 'Start mock exam' : 'Maxed'}</span>
      </button>
    </div>
  )
}

function mockTopicParentLabel(data: WorkspaceData, moduleId: number) {
  const module = data.modules.find((item) => item.id === moduleId)
  const subject = module?.subject
    ? data.subjects.find((item) => item.id === module.subject)
    : null

  return subject?.code ?? module?.title ?? 'Module'
}
