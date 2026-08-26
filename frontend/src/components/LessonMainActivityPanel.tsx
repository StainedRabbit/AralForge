import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  const [hydratedAttempts, setHydratedAttempts] = useState<Record<number, ModuleActivityAttempt>>({})
  const hydrationRequests = useRef(new Map<number, Promise<ModuleActivityAttempt>>())
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)

  const liveQuestions = useMemo(
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
            activity.passing_score !== null
              ? numeric(attempt.score) >= numeric(activity.passing_score)
              : numeric(attempt.max_score) > 0 &&
                numeric(attempt.score) >= numeric(attempt.max_score),
        )),
  )
  const activeAttemptSummary =
    attempts.find((attempt) => attempt.id === activeAttemptId) ??
    attempts.find((attempt) => !attempt.is_submitted) ??
    bestAttempt ??
    attempts[0] ??
    null
  const displayAttemptSummary = reviewUnlocked && reviewAttempt ? reviewAttempt : activeAttemptSummary
  const displayAttempt = displayAttemptSummary
    ? hydratedAttempts[displayAttemptSummary.id] ?? null
    : null
  const questions = useMemo(
    () => questionsForAttempt(displayAttempt, liveQuestions, activity?.id ?? 0),
    [activity?.id, displayAttempt, liveQuestions],
  )
  const now = Date.now()
  const opensAt = activity?.opens_at ? new Date(activity.opens_at).getTime() : null
  const effectiveDueAt = activity?.effective_due_at
    ? new Date(activity.effective_due_at).getTime()
    : null
  const beforeOpen = opensAt !== null && now < opensAt
  const afterDue = effectiveDueAt !== null && now > effectiveDueAt
  const windowClosed = beforeOpen || (afterDue && !activity?.allow_late_submissions)
  const canStartAttempt = Boolean(
    activity && !windowClosed && attempts.length < activity.max_attempts && !activeAttemptSummary?.is_submitted,
  )
  const canStartNewAttempt = Boolean(activity && !windowClosed && attempts.length < activity.max_attempts)
  const initialDrafts = useMemo(
    () => displayAttempt ? buildActivityDrafts(displayAttempt, questions, data) : {},
    [data, displayAttempt, questions],
  )

  const hydrateAttempt = useCallback((attemptId: number) => {
    const hydrated = hydratedAttempts[attemptId]
    if (hydrated) return Promise.resolve(hydrated)
    const pending = hydrationRequests.current.get(attemptId)
    if (pending) return pending

    const request = api<ModuleActivityAttempt>(`/modules/activity-attempts/${attemptId}/`)
      .then((attempt) => {
        setHydratedAttempts((current) => ({ ...current, [attempt.id]: attempt }))
        return attempt
      })
      .catch((error) => {
        hydrationRequests.current.delete(attemptId)
        throw error
      })
    hydrationRequests.current.set(attemptId, request)
    return request
  }, [api, hydratedAttempts])

  useEffect(() => {
    if (!displayAttemptSummary) return
    void hydrateAttempt(displayAttemptSummary.id).catch((caughtError) => {
      setMessage(toErrorMessage(caughtError))
    })
  }, [displayAttemptSummary, hydrateAttempt])

  if (!activity) {
    return null
  }

  async function ensureAttempt() {
    if (!activity || !data.currentUser) {
      throw new Error('Your account could not be loaded. Refresh and try again.')
    }
    if (activeAttemptSummary && !activeAttemptSummary.is_submitted) {
      return hydrateAttempt(activeAttemptSummary.id)
    }
    const attempt = await api<ModuleActivityAttempt>('/modules/activity-attempts/', {
      method: 'POST',
      body: JSON.stringify({
        activity: activity.id,
        student: data.currentUser.id,
      }),
    })
    setHydratedAttempts((current) => ({ ...current, [attempt.id]: attempt }))
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
      await saveAttemptDraft(attempt.id, drafts)
      const submittedAttempt = await api<ModuleActivityAttempt>(
        `/modules/activity-attempts/${attempt.id}/submit/`,
        { method: 'POST' },
      )
      setHydratedAttempts((current) => ({
        ...current,
        [submittedAttempt.id]: submittedAttempt,
      }))
      setMessage('Main Activity submitted.')
      await onSubmitted()
    } catch (caughtError) {
      setMessage(toErrorMessage(caughtError))
    } finally {
      setSaving(false)
    }
  }

  async function saveAttemptDraft(
    attemptId: number,
    drafts: Record<number, ActivityDraft>,
  ) {
    await api(`/modules/activity-attempts/${attemptId}/draft/`, {
      method: 'PUT',
      body: JSON.stringify({ answers: drafts }),
    })
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
            <Icon name={bestAttempt ? 'check' : 'activity'} />
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
          {activity.passing_score !== null && bestAttempt ? (
            <span className={numeric(bestAttempt.score) >= numeric(activity.passing_score) ? 'status-pill status-pill--success' : 'status-pill'}>
              {numeric(bestAttempt.score) >= numeric(activity.passing_score) ? 'Passed' : 'Needs improvement'}
            </span>
          ) : null}
          {activeAttemptSummary?.is_submitted && !reviewUnlocked ? (
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

      {beforeOpen ? (
        <div className="inline-alert"><Icon name="warning" /><span>This activity opens {formatDateTime(activity.opens_at)}.</span></div>
      ) : null}
      {afterDue ? (
        <div className="inline-alert"><Icon name="warning" /><span>{activity.allow_late_submissions ? 'The due date has passed. Late submissions are accepted.' : 'This activity is closed because its due date has passed.'}</span></div>
      ) : null}

      {bestAttempt && !reviewUnlocked ? (
        <div className="inline-alert">
          <Icon name="activity" />
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

      {!activeAttemptSummary && canStartAttempt ? (
        <button className="button button--primary" disabled={saving} onClick={() => void startNewAttempt()} type="button">
          <Icon name="send" />
          <span>{saving ? 'Starting...' : 'Start Main Activity'}</span>
        </button>
      ) : null}

      {displayAttemptSummary && !displayAttempt ? (
        <p className="admin-empty-line" role="status">Loading saved attempt...</p>
      ) : null}

      {displayAttempt ? (
        <ActivityQuestionForm
          data={data}
          displayAttempt={displayAttempt}
          initialDrafts={initialDrafts}
          key={`${displayAttempt.id}-${questions.map((question) => question.id).join('-')}`}
          locked={windowClosed}
          onSubmit={submitActivity}
          onSaveDraft={(drafts) => saveAttemptDraft(displayAttempt.id, drafts)}
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
  locked,
  onSubmit,
  onSaveDraft,
  questions,
  reviewUnlocked,
  saving,
}: {
  data: RouteData
  displayAttempt: ModuleActivityAttempt
  initialDrafts: Record<number, ActivityDraft>
  locked: boolean
  onSubmit: (
    event: FormEvent<HTMLFormElement>,
    drafts: Record<number, ActivityDraft>,
  ) => Promise<void>
  onSaveDraft: (drafts: Record<number, ActivityDraft>) => Promise<void>
  questions: ModuleActivityQuestion[]
  reviewUnlocked: boolean
  saving: boolean
}) {
  const [drafts, setDrafts] = useState(initialDrafts)
  const [showSubmissionReview, setShowSubmissionReview] = useState(false)
  const [draftStatus, setDraftStatus] = useState<'saved' | 'saving' | 'unsaved' | 'error'>('saved')
  const firstRender = useRef(true)
  const saveQueue = useRef<Promise<void>>(Promise.resolve())
  const draftSignature = JSON.stringify(drafts)
  const unanswered = questions.filter((question) => !isAnswered(question, drafts[question.id]))

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    if (displayAttempt.is_submitted || locked) return
    const timer = window.setTimeout(async () => {
      setDraftStatus('saving')
      try {
        const queuedSave = saveQueue.current
          .catch(() => undefined)
          .then(() => onSaveDraft(drafts))
        saveQueue.current = queuedSave
        await queuedSave
        setDraftStatus('saved')
      } catch {
        setDraftStatus('error')
      }
    }, 800)
    return () => window.clearTimeout(timer)
  }, [displayAttempt.is_submitted, draftSignature, drafts, locked, onSaveDraft])

  function updateDraft(questionId: number, draft: ActivityDraft) {
    setDraftStatus('unsaved')
    setDrafts((current) => ({ ...current, [questionId]: draft }))
  }

  return (
    <form
      className="lesson-main-activity__questions"
      onSubmit={(event) => {
        if (!showSubmissionReview) {
          event.preventDefault()
          setShowSubmissionReview(true)
          return
        }
        event.preventDefault()
        void saveQueue.current
          .catch(() => undefined)
          .then(() => onSubmit(event, drafts))
      }}
    >
      {!displayAttempt.is_submitted ? (
        <p className={`activity-draft-status activity-draft-status--${draftStatus}`} role="status">
          {draftStatus === 'saving' ? 'Saving answers…' : draftStatus === 'unsaved' ? 'Unsaved answer changes' : draftStatus === 'error' ? 'Autosave failed — your answers are still on this screen.' : 'Answers saved'}
        </p>
      ) : null}
      {reviewUnlocked ? (
        <div>
          <p className="eyebrow">Review Answers</p>
          <h3>Latest submitted attempt</h3>
        </div>
      ) : null}
      {questions.map((question, index) => (
        <ActivityQuestionCard
          data={data}
          displayAttempt={displayAttempt}
          draft={drafts[question.id] ?? emptyDraft(question, data, displayAttempt)}
          key={question.id}
          number={index + 1}
          onChange={(draft) => updateDraft(question.id, draft)}
          question={question}
          readonly={displayAttempt.is_submitted || locked || saving}
          reviewUnlocked={reviewUnlocked}
        />
      ))}
      {!displayAttempt.is_submitted && !locked ? (
        showSubmissionReview ? (
          <section className="activity-submission-review" aria-label="Submission review">
            <div>
              <p className="eyebrow">Check before submitting</p>
              <h3>{questions.length - unanswered.length} of {questions.length} answered</h3>
              <p>{unanswered.length ? `${unanswered.length} unanswered question${unanswered.length === 1 ? '' : 's'}. You may still submit.` : 'Every question has an answer.'}</p>
            </div>
            {unanswered.length ? (
              <div className="activity-unanswered-links">
                {unanswered.map((question) => {
                  const number = questions.findIndex((item) => item.id === question.id) + 1
                  return <button key={question.id} onClick={() => document.getElementById(`activity-question-${question.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })} type="button">Question {number}</button>
                })}
              </div>
            ) : null}
            <div className="lesson-editor__actions">
              <button className="button button--secondary" onClick={() => setShowSubmissionReview(false)} type="button">Keep reviewing</button>
              <button className="button button--primary" disabled={saving || !questions.length} type="submit">
                <Icon name="send" />
                <span>{saving ? 'Submitting...' : 'Confirm submission'}</span>
              </button>
            </div>
          </section>
        ) : (
          <button className="button button--primary" disabled={saving || !questions.length} type="submit">
            <Icon name="send" />
            <span>Review and submit</span>
          </button>
        )
      ) : null}
    </form>
  )
}

function ActivityQuestionCard({
  data,
  displayAttempt,
  draft,
  number,
  onChange,
  question,
  readonly,
  reviewUnlocked,
}: {
  data: RouteData
  displayAttempt: ModuleActivityAttempt
  draft: ActivityDraft
  number: number
  onChange: (draft: ActivityDraft) => void
  question: ModuleActivityQuestion
  readonly: boolean
  reviewUnlocked: boolean
}) {
  const choices = choicesForQuestion(question, data, displayAttempt)
  const pairs = pairsForQuestion(question, data, displayAttempt)

  return (
    <article className="question-card" id={`activity-question-${question.id}`}>
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
        <AnswerReview attempt={displayAttempt} data={data} draft={draft} question={question} />
      ) : null}
    </article>
  )
}

function AnswerReview({
  attempt,
  data,
  draft,
  question,
}: {
  attempt: ModuleActivityAttempt
  data: RouteData
  draft: ActivityDraft
  question: ModuleActivityQuestion
}) {
  return (
    <div className="answer-review">
      <div>
        <strong>Your answer</strong>
        <p>{studentAnswerText(question, draft, data, attempt) || 'No answer submitted.'}</p>
      </div>
      <div>
        <strong>Correct answer</strong>
        <p>{correctAnswerText(question, data, attempt) || 'Review with your teacher.'}</p>
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
  attempt?: ModuleActivityAttempt,
) {
  const choices = choicesForQuestion(question, data, attempt)
  const pairs = pairsForQuestion(question, data, attempt)
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

function correctAnswerText(question: ModuleActivityQuestion, data: RouteData, attempt?: ModuleActivityAttempt) {
  const choices = choicesForQuestion(question, data, attempt)
  const pairs = pairsForQuestion(question, data, attempt)
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
  attempt?: ModuleActivityAttempt,
): ActivityDraft {
  if (answer) {
    return {
      selected_choice: answer.selected_choice,
      text_answer: answer.text_answer,
      choice_order: answer.choice_order,
      matching_answer: answer.matching_answer,
    }
  }
  return emptyDraft(question, data, attempt)
}

function buildActivityDrafts(
  displayAttempt: ModuleActivityAttempt,
  questions: ModuleActivityQuestion[],
  data: RouteData,
) {
  const nextDrafts: Record<number, ActivityDraft> = {}
  questions.forEach((question) => {
    const savedDraft = displayAttempt.draft_answers?.[String(question.id)]
    if (savedDraft) {
      nextDrafts[question.id] = {
        selected_choice: savedDraft.selected_choice,
        text_answer: savedDraft.text_answer,
        choice_order: savedDraft.choice_order,
        matching_answer: savedDraft.matching_answer,
      }
      return
    }
    const answer = data.activityAnswers.find(
      (item) => item.attempt === displayAttempt.id && item.question === question.id,
    )
    nextDrafts[question.id] = answerToDraft(question, answer, data, displayAttempt)
  })
  return nextDrafts
}

function emptyDraft(question: ModuleActivityQuestion, data: RouteData, attempt?: ModuleActivityAttempt): ActivityDraft {
  const choices = choicesForQuestion(question, data, attempt)

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

function questionsForAttempt(
  attempt: ModuleActivityAttempt | null,
  fallback: ModuleActivityQuestion[],
  activityId: number,
) {
  if (!attempt?.question_snapshot?.length) return fallback
  return attempt.question_snapshot
    .map((question) => ({
      ...question,
      activity: activityId,
      matching_options: question.matching_options ?? question.matching_pairs
        .map((pair) => pair.right_text)
        .filter((value): value is string => Boolean(value)),
    }))
    .sort((first, second) => first.order - second.order || first.id - second.id)
}

function snapshotQuestion(attempt: ModuleActivityAttempt | undefined, questionId: number) {
  return attempt?.question_snapshot?.find((question) => question.id === questionId)
}

function choicesForQuestion(
  question: ModuleActivityQuestion,
  data: RouteData,
  attempt?: ModuleActivityAttempt,
) {
  const snapshot = snapshotQuestion(attempt, question.id)
  return snapshot
    ? [...snapshot.choices].sort((first, second) => first.order - second.order || first.id - second.id)
    : data.activityChoices
        .filter((choice) => choice.question === question.id)
        .sort((first, second) => first.order - second.order || first.id - second.id)
}

function pairsForQuestion(
  question: ModuleActivityQuestion,
  data: RouteData,
  attempt?: ModuleActivityAttempt,
) {
  const snapshot = snapshotQuestion(attempt, question.id)
  return snapshot
    ? [...snapshot.matching_pairs].sort((first, second) => first.order - second.order || first.id - second.id)
    : data.activityMatchingPairs
        .filter((pair) => pair.question === question.id)
        .sort((first, second) => first.order - second.order || first.id - second.id)
}

function isAnswered(question: ModuleActivityQuestion, draft?: ActivityDraft) {
  if (!draft) return false
  if (question.question_type === 'multiple_choice' || question.question_type === 'true_false') {
    return draft.selected_choice !== null
  }
  if (question.question_type === 'matching') {
    return Object.values(draft.matching_answer).filter(Boolean).length >= question.matching_options.length
  }
  if (question.question_type === 'ordering') return draft.choice_order.length > 0
  return Boolean(draft.text_answer.trim())
}

function formatDateTime(value: string | null) {
  return value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : ''
}
