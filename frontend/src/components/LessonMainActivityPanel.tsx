import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import type { AuthedRequest, RouteData } from '../app/types'
import type {
  ModuleActivity,
  ModuleActivityAnswer,
  ModuleActivityAttempt,
  ModuleActivityQuestion,
} from '../types'
import { numeric, toErrorMessage } from '../utils/format'
import { Icon } from './Icon'
import { RichLessonText } from './RichLessonText'

type ActivityDraft = {
  selected_choice: number | null
  text_answer: string
  choice_order: number[]
  matching_answer: Record<string, string>
}

export function LessonMainActivityPanel({
  activity,
  api,
  data,
  onSubmitted,
}: {
  activity: ModuleActivity | null
  api: AuthedRequest
  data: RouteData
  onSubmitted: () => Promise<void>
}) {
  const [activeAttemptId, setActiveAttemptId] = useState<number | null>(null)
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)

  const questions = useMemo(
    () =>
      activity
        ? data.activityQuestions
            .filter((question) => question.activity === activity.id && question.is_published)
            .sort((first, second) => first.order - second.order || first.id - second.id)
        : [],
    [activity, data.activityQuestions],
  )
  const attempts = useMemo(
    () =>
      activity
        ? data.activityAttempts
            .filter((attempt) => attempt.activity === activity.id)
            .sort((first, second) => second.attempt_number - first.attempt_number)
        : [],
    [activity, data.activityAttempts],
  )
  const bestAttempt = attempts
    .filter((attempt) => attempt.is_submitted && attempt.score !== null)
    .sort((first, second) => numeric(second.score) - numeric(first.score))[0] ?? null
  const submittedAttempts = attempts.filter((attempt) => attempt.is_submitted)
  const reviewAttempt =
    [...submittedAttempts].sort(
      (first, second) => second.attempt_number - first.attempt_number,
    )[0] ?? null
  const reviewUnlocked = Boolean(
    activity &&
      (submittedAttempts.length >= activity.max_attempts ||
        submittedAttempts.some(
          (attempt) =>
            numeric(attempt.max_score) > 0 &&
            numeric(attempt.score) >= numeric(attempt.max_score),
        )),
  )
  const activeAttempt =
    attempts.find((attempt) => attempt.id === activeAttemptId) ??
    attempts.find((attempt) => !attempt.is_submitted) ??
    bestAttempt ??
    attempts[0] ??
    null
  const displayAttempt = reviewUnlocked && reviewAttempt ? reviewAttempt : activeAttempt
  const canStartAttempt = Boolean(
    activity && attempts.length < activity.max_attempts && !activeAttempt?.is_submitted,
  )
  const canStartNewAttempt = Boolean(activity && attempts.length < activity.max_attempts)
  const initialDrafts = useMemo(
    () => displayAttempt ? buildActivityDrafts(displayAttempt, questions, data) : {},
    [data, displayAttempt, questions],
  )

  if (!activity) {
    return null
  }

  async function ensureAttempt() {
    if (!activity || !data.currentUser) {
      throw new Error('Your account could not be loaded. Refresh and try again.')
    }
    if (activeAttempt && !activeAttempt.is_submitted) {
      return activeAttempt
    }
    const attempt = await api<ModuleActivityAttempt>('/modules/activity-attempts/', {
      method: 'POST',
      body: JSON.stringify({
        activity: activity.id,
        student: data.currentUser.id,
      }),
    })
    setActiveAttemptId(attempt.id)
    return attempt
  }

  async function startNewAttempt() {
    setSaving(true)
    setMessage('')
    try {
      const attempt = await ensureAttempt()
      setActiveAttemptId(attempt.id)
      await onSubmitted()
    } catch (caughtError) {
      setMessage(toErrorMessage(caughtError))
    } finally {
      setSaving(false)
    }
  }

  async function submitActivity(
    event: FormEvent<HTMLFormElement>,
    drafts: Record<number, ActivityDraft>,
  ) {
    event.preventDefault()
    if (!questions.length) {
      setMessage('This activity has no questions yet.')
      return
    }

    setSaving(true)
    setMessage('')
    try {
      const attempt = await ensureAttempt()
      await Promise.all(
        questions.map((question) => {
          const existingAnswer = data.activityAnswers.find(
            (answer) => answer.attempt === attempt.id && answer.question === question.id,
          )
          const draft = drafts[question.id] ?? emptyDraft(question, data)
          return api(
            existingAnswer
              ? `/modules/activity-answers/${existingAnswer.id}/`
              : '/modules/activity-answers/',
            {
              method: existingAnswer ? 'PATCH' : 'POST',
              body: JSON.stringify({
                attempt: attempt.id,
                question: question.id,
                selected_choice: draft.selected_choice,
                text_answer: draft.text_answer,
                choice_order: draft.choice_order,
                matching_answer: draft.matching_answer,
              }),
            },
          )
        }),
      )
      await api(`/modules/activity-attempts/${attempt.id}/submit/`, { method: 'POST' })
      setMessage('Main Activity submitted.')
      await onSubmitted()
    } catch (caughtError) {
      setMessage(toErrorMessage(caughtError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="lesson-main-activity" id="main-activity">
      <div className="lesson-main-activity__header">
        <div>
          <p className="eyebrow">Main Activity</p>
          <h2>{activity.title}</h2>
          <RichLessonText value={activity.instructions} />
        </div>
        <div className="lesson-main-activity__status">
          <span className={bestAttempt ? 'status-pill status-pill--success' : 'status-pill'}>
            <Icon name={bestAttempt ? 'check' : 'assessment'} />
            {bestAttempt
              ? `Best ${numeric(bestAttempt.score)}/${numeric(bestAttempt.max_score)}`
              : `${activity.max_attempts - attempts.length} attempt${activity.max_attempts - attempts.length === 1 ? '' : 's'} left`}
          </span>
          {reviewUnlocked ? (
            <span className="status-pill status-pill--success">
              <Icon name="book" />
              Review unlocked
            </span>
          ) : null}
          {activeAttempt?.is_submitted && !reviewUnlocked ? (
            <button
              className="button button--secondary button--compact"
              disabled={saving || !canStartNewAttempt}
              onClick={() => void startNewAttempt()}
              type="button"
            >
              <Icon name="send" />
              <span>New Attempt</span>
            </button>
          ) : null}
        </div>
      </div>

      {message ? (
        <div className="inline-alert">
          <Icon name={message.includes('submitted') ? 'check' : 'warning'} />
          <span>{message}</span>
        </div>
      ) : null}

      {bestAttempt && !reviewUnlocked ? (
        <div className="inline-alert">
          <Icon name="assessment" />
          <span>
            Score recorded. Review the lesson notes, then use another attempt when ready.
          </span>
        </div>
      ) : null}

      {reviewUnlocked ? (
        <div className="inline-alert">
          <Icon name="check" />
          <span>Review Answers is unlocked. Study the corrections, then continue to the challenge.</span>
        </div>
      ) : null}

      {!activeAttempt && canStartAttempt ? (
        <button className="button button--primary" disabled={saving} onClick={() => void startNewAttempt()} type="button">
          <Icon name="send" />
          <span>{saving ? 'Starting...' : 'Start Main Activity'}</span>
        </button>
      ) : null}

      {displayAttempt ? (
        <ActivityQuestionForm
          data={data}
          displayAttempt={displayAttempt}
          initialDrafts={initialDrafts}
          key={`${displayAttempt.id}-${questions.map((question) => question.id).join('-')}`}
          onSubmit={submitActivity}
          questions={questions}
          reviewUnlocked={reviewUnlocked}
          saving={saving}
        />
      ) : null}
    </section>
  )
}

function ActivityQuestionForm({
  data,
  displayAttempt,
  initialDrafts,
  onSubmit,
  questions,
  reviewUnlocked,
  saving,
}: {
  data: RouteData
  displayAttempt: ModuleActivityAttempt
  initialDrafts: Record<number, ActivityDraft>
  onSubmit: (
    event: FormEvent<HTMLFormElement>,
    drafts: Record<number, ActivityDraft>,
  ) => Promise<void>
  questions: ModuleActivityQuestion[]
  reviewUnlocked: boolean
  saving: boolean
}) {
  const [drafts, setDrafts] = useState(initialDrafts)

  function updateDraft(questionId: number, draft: ActivityDraft) {
    setDrafts((current) => ({ ...current, [questionId]: draft }))
  }

  return (
    <form className="lesson-main-activity__questions" onSubmit={(event) => void onSubmit(event, drafts)}>
      {reviewUnlocked ? (
        <div>
          <p className="eyebrow">Review Answers</p>
          <h3>Latest submitted attempt</h3>
        </div>
      ) : null}
      {questions.map((question, index) => (
        <ActivityQuestionCard
          data={data}
          draft={drafts[question.id] ?? emptyDraft(question, data)}
          key={question.id}
          number={index + 1}
          onChange={(draft) => updateDraft(question.id, draft)}
          question={question}
          readonly={displayAttempt.is_submitted}
          reviewUnlocked={reviewUnlocked}
        />
      ))}
      {!displayAttempt.is_submitted ? (
        <button
          className="button button--primary"
          disabled={saving || !questions.length}
          type="submit"
        >
          <Icon name="send" />
          <span>{saving ? 'Submitting...' : 'Submit Main Activity'}</span>
        </button>
      ) : null}
    </form>
  )
}

function ActivityQuestionCard({
  data,
  draft,
  number,
  onChange,
  question,
  readonly,
  reviewUnlocked,
}: {
  data: RouteData
  draft: ActivityDraft
  number: number
  onChange: (draft: ActivityDraft) => void
  question: ModuleActivityQuestion
  readonly: boolean
  reviewUnlocked: boolean
}) {
  const choices = data.activityChoices
    .filter((choice) => choice.question === question.id)
    .sort((first, second) => first.order - second.order || first.id - second.id)
  const pairs = data.activityMatchingPairs
    .filter((pair) => pair.question === question.id)
    .sort((first, second) => first.order - second.order || first.id - second.id)

  return (
    <article className="question-card">
      <div className="question-card__header">
        <span className="subject-chip">Question {number}</span>
        <span className="status-pill">{numeric(question.points)} pts</span>
      </div>
      <h2>{question.prompt}</h2>

      {question.code_snippet ? <pre>{question.code_snippet}</pre> : null}

      {question.question_type === 'multiple_choice' || question.question_type === 'true_false' ? (
        <div className="choice-list">
          {choices.map((choice) => (
            <label className="choice-option" key={choice.id}>
              <input
                checked={draft.selected_choice === choice.id}
                disabled={readonly}
                name={`activity-question-${question.id}`}
                onChange={() => onChange({ ...draft, selected_choice: choice.id })}
                type="radio"
              />
              <span>{choice.text}</span>
              {reviewUnlocked && choice.is_correct ? (
                <strong className="answer-review__mark">Correct</strong>
              ) : null}
            </label>
          ))}
        </div>
      ) : question.question_type === 'fill_blank' ? (
        <input
          disabled={readonly}
          onChange={(event) => onChange({ ...draft, text_answer: event.target.value })}
          placeholder="Type your answer"
          type="text"
          value={draft.text_answer}
        />
      ) : question.question_type === 'ordering' ? (
        <div className="ordering-list">
          {draft.choice_order.map((choiceId, index) => {
            const choice = choices.find((item) => item.id === choiceId)
            if (!choice) return null
            return (
              <div className="ordering-row" key={choiceId}>
                <span>{index + 1}</span>
                <strong>{choice.text}</strong>
                <button disabled={readonly || index === 0} onClick={() => onChange(moveChoice(draft, index, -1))} type="button">
                  Up
                </button>
                <button disabled={readonly || index === draft.choice_order.length - 1} onClick={() => onChange(moveChoice(draft, index, 1))} type="button">
                  Down
                </button>
              </div>
            )
          })}
        </div>
      ) : question.question_type === 'matching' ? (
        <div className="matching-list">
          {pairs.map((pair) => (
            <label className="matching-row" key={pair.id}>
              <span>{pair.left_text}</span>
              <select
                disabled={readonly}
                onChange={(event) =>
                  onChange({
                    ...draft,
                    matching_answer: {
                      ...draft.matching_answer,
                      [String(pair.id)]: event.target.value,
                    },
                  })
                }
                value={draft.matching_answer[String(pair.id)] ?? ''}
              >
                <option value="">Choose match</option>
                {question.matching_options.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>
          ))}
        </div>
      ) : (
        <textarea
          className="code-input"
          disabled={readonly}
          onChange={(event) => onChange({ ...draft, text_answer: event.target.value })}
          placeholder="Write the expected output"
          rows={5}
          value={draft.text_answer}
        />
      )}

      {reviewUnlocked ? (
        <AnswerReview data={data} draft={draft} question={question} />
      ) : null}
    </article>
  )
}

function AnswerReview({
  data,
  draft,
  question,
}: {
  data: RouteData
  draft: ActivityDraft
  question: ModuleActivityQuestion
}) {
  return (
    <div className="answer-review">
      <div>
        <strong>Your answer</strong>
        <p>{studentAnswerText(question, draft, data) || 'No answer submitted.'}</p>
      </div>
      <div>
        <strong>Correct answer</strong>
        <p>{correctAnswerText(question, data) || 'Review with your teacher.'}</p>
      </div>
      {question.explanation ? (
        <div>
          <strong>Explanation</strong>
          <RichLessonText value={question.explanation} />
        </div>
      ) : null}
    </div>
  )
}

function studentAnswerText(
  question: ModuleActivityQuestion,
  draft: ActivityDraft,
  data: RouteData,
) {
  const choices = data.activityChoices.filter((choice) => choice.question === question.id)
  const pairs = data.activityMatchingPairs.filter((pair) => pair.question === question.id)
  if (question.question_type === 'multiple_choice' || question.question_type === 'true_false') {
    return choices.find((choice) => choice.id === draft.selected_choice)?.text ?? ''
  }
  if (question.question_type === 'ordering') {
    return draft.choice_order
      .map((choiceId) => choices.find((choice) => choice.id === choiceId)?.text)
      .filter(Boolean)
      .join(' -> ')
  }
  if (question.question_type === 'matching') {
    return pairs
      .map((pair) => `${pair.left_text}: ${draft.matching_answer[String(pair.id)] || '-'}`)
      .join('; ')
  }
  return draft.text_answer
}

function correctAnswerText(question: ModuleActivityQuestion, data: RouteData) {
  const choices = data.activityChoices
    .filter((choice) => choice.question === question.id)
    .sort((first, second) => first.order - second.order || first.id - second.id)
  const pairs = data.activityMatchingPairs
    .filter((pair) => pair.question === question.id)
    .sort((first, second) => first.order - second.order || first.id - second.id)
  if (question.question_type === 'multiple_choice' || question.question_type === 'true_false') {
    return choices.filter((choice) => choice.is_correct).map((choice) => choice.text).join(', ')
  }
  if (question.question_type === 'fill_blank') {
    return question.correct_text_answers?.join(', ') ?? ''
  }
  if (question.question_type === 'ordering') {
    return choices.map((choice) => choice.text).join(' -> ')
  }
  if (question.question_type === 'matching') {
    return pairs
      .map((pair) => `${pair.left_text}: ${pair.right_text ?? ''}`)
      .join('; ')
  }
  return question.expected_output ?? ''
}

function answerToDraft(
  question: ModuleActivityQuestion,
  answer: ModuleActivityAnswer | undefined,
  data: RouteData,
): ActivityDraft {
  if (answer) {
    return {
      selected_choice: answer.selected_choice,
      text_answer: answer.text_answer,
      choice_order: answer.choice_order,
      matching_answer: answer.matching_answer,
    }
  }
  return emptyDraft(question, data)
}

function buildActivityDrafts(
  displayAttempt: ModuleActivityAttempt,
  questions: ModuleActivityQuestion[],
  data: RouteData,
) {
  const nextDrafts: Record<number, ActivityDraft> = {}
  questions.forEach((question) => {
    const answer = data.activityAnswers.find(
      (item) => item.attempt === displayAttempt.id && item.question === question.id,
    )
    nextDrafts[question.id] = answerToDraft(question, answer, data)
  })
  return nextDrafts
}

function emptyDraft(question: ModuleActivityQuestion, data: RouteData): ActivityDraft {
  const choices = data.activityChoices
    .filter((choice) => choice.question === question.id)
    .sort((first, second) => first.order - second.order || first.id - second.id)

  return {
    selected_choice: null,
    text_answer: '',
    choice_order: choices.map((choice) => choice.id),
    matching_answer: {},
  }
}

function moveChoice(draft: ActivityDraft, index: number, direction: -1 | 1) {
  const nextOrder = [...draft.choice_order]
  const target = index + direction
  const currentValue = nextOrder[index]
  nextOrder[index] = nextOrder[target]
  nextOrder[target] = currentValue
  return { ...draft, choice_order: nextOrder }
}
