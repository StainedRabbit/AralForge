import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { AuthedRequest, RouteData } from '../app/types'
import type {
  ModuleActivity,
  ModuleActivityAnswer,
  ModuleActivityAttempt,
  MainActivityAttemptResponse,
  MainActivityDraftSaveResponse,
  ModuleActivityQuestion,
} from '../types'
import { numeric, toErrorMessage } from '../utils/format'
import { Icon } from './Icon'
import { RichLessonText } from './RichLessonText'

export type ActivityDraft = {
  selected_choice: number | null
  text_answer: string
  choice_order: number[]
  matching_answer: Record<string, string>
}

type LegacyHistoryPayload = {
  attempts: ModuleActivityAttempt[]
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
  const [messageTone, setMessageTone] = useState<'error' | 'success'>('success')
  const [saving, setSaving] = useState(false)
  const [submissionFailed, setSubmissionFailed] = useState(false)
  const [showLegacyHistory, setShowLegacyHistory] = useState(false)
  const [legacyAttempts, setLegacyAttempts] = useState<ModuleActivityAttempt[] | null>(null)
  const [legacyHistoryMessage, setLegacyHistoryMessage] = useState('')
  const [loadingLegacyHistory, setLoadingLegacyHistory] = useState(false)
  const serverState = activity
    ? data.activityStates.find((state) => state.activity === activity.id) ?? null
    : null
  const [responseState, setResponseState] = useState(serverState)
  const activityState = responseState?.activity === activity?.id ? responseState : serverState
  const learningContext = data.learningContext
  const contextQuery = learningContext?.context_type === 'CLASS' && learningContext.schedule
    ? `?schedule=${learningContext.schedule}`
    : learningContext?.context_type === 'PERSONAL'
      ? '?context=PERSONAL'
      : ''

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
  const bestAttempt = attempts.find((attempt) => attempt.id === activityState?.best_attempt_id) ?? null
  const submittedAttempts = attempts.filter(
    (attempt) => attempt.status === 'SUBMITTED' || attempt.is_submitted,
  )
  const attemptsRemaining = activityState?.attempts_remaining ?? 0
  const reviewAttempt =
    [...submittedAttempts].sort(
      (first, second) => second.attempt_number - first.attempt_number,
    )[0] ?? null
  const reviewUnlocked = Boolean(activityState?.review_unlocked)
  const activeAttemptSummary =
    attempts.find((attempt) => attempt.id === activeAttemptId) ??
    attempts.find((attempt) => attempt.id === activityState?.active_attempt_id) ??
    bestAttempt ??
    attempts[0] ??
    null
  const displayAttemptSummary = activeAttemptSummary ?? (reviewUnlocked ? reviewAttempt : null)
  const displayAttempt = displayAttemptSummary
    ? hydratedAttempts[displayAttemptSummary.id] ?? null
    : null
  const questions = useMemo(
    () => questionsForAttempt(displayAttempt, liveQuestions, activity?.id ?? 0),
    [activity?.id, displayAttempt, liveQuestions],
  )
  const canStartAttempt = Boolean(activityState?.can_start_attempt)
  const passed = Boolean(activityState?.passed)
  const attemptsCompletedWithoutPassing = Boolean(
    activity?.passing_score !== null && !passed &&
      activityState && activityState.submitted_count >= activityState.attempt_limit,
  )
  const legacyHistoryCount = activity ? data.legacyHistoryCounts[activity.id] ?? 0 : 0
  const canStartNewAttempt = Boolean(activityState?.can_start_attempt)
  const initialDrafts = useMemo(
    () => displayAttempt ? buildActivityDrafts(displayAttempt, questions, data) : {},
    [data, displayAttempt, questions],
  )

  const hydrateAttempt = useCallback((attemptId: number) => {
    const hydrated = hydratedAttempts[attemptId]
    if (hydrated) return Promise.resolve(hydrated)
    const pending = hydrationRequests.current.get(attemptId)
    if (pending) return pending

    const request = api<ModuleActivityAttempt>(`/modules/activity-attempts/${attemptId}/${contextQuery}`)
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
  }, [api, contextQuery, hydratedAttempts])

  useEffect(() => {
    if (!displayAttemptSummary) return
    void hydrateAttempt(displayAttemptSummary.id).catch((caughtError) => {
      setMessageTone('error')
      setMessage(toErrorMessage(caughtError))
    })
  }, [displayAttemptSummary, hydrateAttempt])

  const saveAttemptDraft = useCallback(async (
    attemptId: number,
    drafts: Record<number, ActivityDraft>,
    baseRevision: number,
  ) => api<MainActivityDraftSaveResponse>(
    `/modules/activity-attempts/${attemptId}/draft/${contextQuery}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ answers: drafts, base_revision: baseRevision }),
    },
  ), [api, contextQuery])
  const saveDisplayedAttemptDraft = useCallback((
    drafts: Record<number, ActivityDraft>,
    revision: number,
  ) => {
    if (!displayAttemptSummary) {
      return Promise.reject(new Error('No activity attempt is open.'))
    }
    return saveAttemptDraft(displayAttemptSummary.id, drafts, revision)
  }, [displayAttemptSummary, saveAttemptDraft])

  if (!activity) {
    return null
  }

  async function ensureAttempt() {
    if (!activity || !data.currentUser) {
      throw new Error('Your account could not be loaded. Refresh and try again.')
    }
    if (!learningContext || !contextQuery) {
      throw new Error('Choose a class or Personal Study context before starting this activity.')
    }
    if (activeAttemptSummary?.status === 'IN_PROGRESS') {
      return hydrateAttempt(activeAttemptSummary.id)
    }
    const result = await api<MainActivityAttemptResponse>(
      `/modules/activities/${activity.id}/start-attempt/`, {
      method: 'POST',
      body: JSON.stringify({
        context_type: learningContext.context_type,
        schedule: learningContext.schedule,
      }),
    })
    const attempt = result.attempt
    setResponseState(result.state)
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
      setMessageTone('error')
      setMessage(toErrorMessage(caughtError))
    } finally {
      setSaving(false)
    }
  }

  async function submitActivity(
    event: FormEvent<HTMLFormElement>,
    drafts: Record<number, ActivityDraft>,
    draftRevision: number,
  ) {
    event.preventDefault()
    if (!questions.length) {
      setMessageTone('error')
      setMessage('This activity has no questions yet.')
      return
    }

    setSaving(true)
    setMessage('')
    setSubmissionFailed(false)
    let latestAnswersSaved = false
    try {
      const attempt = await ensureAttempt()
      const saved = await saveAttemptDraft(attempt.id, drafts, draftRevision)
      setHydratedAttempts((current) => ({
        ...current,
        [attempt.id]: {
          ...attempt,
          draft_answers: drafts,
          draft_revision: saved.draft_revision,
          draft_saved_at: saved.saved_at,
        },
      }))
      latestAnswersSaved = true
      const result = await api<MainActivityAttemptResponse>(
        `/modules/activity-attempts/${attempt.id}/submit/${contextQuery}`,
        {
          method: 'POST',
          body: JSON.stringify({ draft_revision: saved.draft_revision }),
        },
      )
      const submittedAttempt = result.attempt
      setResponseState(result.state)
      setHydratedAttempts((current) => ({
        ...current,
        [submittedAttempt.id]: submittedAttempt,
      }))
      setActiveAttemptId(submittedAttempt.id)
      setMessageTone('success')
      setMessage('Main Activity submitted.')
      await onSubmitted()
    } catch (caughtError) {
      setSubmissionFailed(true)
      setMessageTone('error')
      setMessage(
        latestAnswersSaved
          ? `Submission could not be confirmed. Your answers are saved; try again. ${toErrorMessage(caughtError)}`
          : `Could not save your latest answers. Nothing was submitted; check your connection and try again. ${toErrorMessage(caughtError)}`,
      )
    } finally {
      setSaving(false)
    }
  }

  async function loadLegacyHistory() {
    if (!activity || loadingLegacyHistory) return
    if (legacyAttempts) {
      setShowLegacyHistory((current) => !current)
      return
    }
    setShowLegacyHistory(true)
    setLoadingLegacyHistory(true)
    setLegacyHistoryMessage('')
    try {
      const payload = await api<LegacyHistoryPayload>(
        `/modules/activities/${activity.id}/legacy-history/`,
      )
      setLegacyAttempts(payload.attempts)
    } catch (caughtError) {
      setLegacyHistoryMessage(toErrorMessage(caughtError))
    } finally {
      setLoadingLegacyHistory(false)
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
          {learningContext ? (
            <span className="status-pill">
              <Icon name={learningContext.context_type === 'CLASS' ? 'users' : 'book'} />
              {learningContext.label}
            </span>
          ) : null}
          <span className={bestAttempt ? 'status-pill status-pill--success' : 'status-pill'}>
            <Icon name={bestAttempt ? 'check' : 'activity'} />
            {bestAttempt
              ? `Best ${activityState?.best_percentage}% · ${numeric(bestAttempt.score)}/${numeric(bestAttempt.max_score)}`
              : `${attemptsRemaining} attempt${attemptsRemaining === 1 ? '' : 's'} left`}
          </span>
          {activeAttemptSummary && !activeAttemptSummary.is_submitted ? (
            <span className="status-pill">
              Attempt {activeAttemptSummary.attempt_number} of {activity.max_attempts} · In progress
            </span>
          ) : null}
          {reviewUnlocked ? (
            <span className="status-pill status-pill--success">
              <Icon name="book" />
              Review unlocked
            </span>
          ) : null}
          {activityState?.paper_terminal ? (
            <span className="status-pill status-pill--success">
              <Icon name="file" />
              Paper submission final
            </span>
          ) : null}
          {activity.passing_score !== null && bestAttempt ? (
            <span className={passed ? 'status-pill status-pill--success' : 'status-pill'}>
              {passed ? 'Passed' : attemptsCompletedWithoutPassing ? 'Attempts completed · Not passed' : 'Needs improvement'}
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
        <div className="inline-alert" role={messageTone === 'error' ? 'alert' : 'status'}>
          <Icon name={messageTone === 'success' ? 'check' : 'warning'} />
          <span>{message}</span>
        </div>
      ) : null}

      {attempts.length ? (
        <section className="activity-attempt-history" aria-label="Current attempt history">
          <div className="activity-attempt-history__heading">
            <div>
              <p className="eyebrow">Current record</p>
              <h3>{submittedAttempts.length} of {activity.max_attempts} attempts submitted</h3>
            </div>
            <span className="status-pill">{attemptsRemaining} remaining</span>
          </div>
          <div className="activity-attempt-history__list">
            {attempts.map((attempt) => (
              <button
                className={`attempt-item${displayAttemptSummary?.id === attempt.id ? ' active' : ''}`}
                disabled={attempt.status === 'SUPERSEDED' || (attempt.status === 'SUBMITTED' && !reviewUnlocked)}
                key={attempt.id}
                onClick={() => setActiveAttemptId(attempt.id)}
                type="button"
              >
                <strong>Attempt {attempt.attempt_number}</strong>
                <span>
                  {attempt.status === 'SUPERSEDED'
                    ? 'Superseded by paper submission'
                    : attempt.status === 'SUBMITTED' || attempt.is_submitted
                    ? `${numeric(attempt.score)}/${numeric(attempt.max_score)}`
                    : 'In progress'}
                </span>
                <small>
                  {attempt.submitted_at
                    ? new Date(attempt.submitted_at).toLocaleString()
                    : `Started ${new Date(attempt.started_at).toLocaleString()}`}
                </small>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {legacyHistoryCount ? (
        <section className="activity-legacy-history" aria-label="Previous activity records">
          <div className="activity-attempt-history__heading">
            <div>
              <p className="eyebrow">Previous records</p>
              <h3>{legacyHistoryCount} earlier attempt{legacyHistoryCount === 1 ? '' : 's'}</h3>
              <p>These records are read-only and do not count toward this class or Personal Study activity.</p>
            </div>
            <button
              aria-expanded={showLegacyHistory}
              className="button button--secondary button--compact"
              disabled={loadingLegacyHistory}
              onClick={() => void loadLegacyHistory()}
              type="button"
            >
              {loadingLegacyHistory ? 'Loading...' : showLegacyHistory ? 'Hide records' : 'View records'}
            </button>
          </div>
          {legacyHistoryMessage ? (
            <div className="inline-alert" role="alert">
              <Icon name="warning" />
              <span>{legacyHistoryMessage}</span>
            </div>
          ) : null}
          {showLegacyHistory && legacyAttempts ? (
            <div className="activity-attempt-history__list">
              {legacyAttempts.map((attempt) => (
                <div key={attempt.id}>
                  <strong>Previous attempt {attempt.attempt_number}</strong>
                  <span>{numeric(attempt.score)}/{numeric(attempt.max_score)}</span>
                  <small>
                    {attempt.submission_method === 'PAPER' ? 'Paper' : 'Online'}
                    {' · '}
                    {attempt.submitted_at ? new Date(attempt.submitted_at).toLocaleString() : 'Date unavailable'}
                  </small>
                </div>
              ))}
            </div>
          ) : null}
        </section>
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
          <span>
            {attemptsCompletedWithoutPassing
              ? 'All attempts are complete. Review the corrections; the passing score was not reached.'
              : 'Review Answers is unlocked. Study the corrections, then try the optional challenge.'}
          </span>
        </div>
      ) : null}

      {activityState?.paper_terminal ? (
        <div className="inline-alert">
          <Icon name="file" />
          <span>The checked-paper score is final for this activity. Individual paper answers were not stored online.</span>
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

      {displayAttempt?.submission_method === 'PAPER' ? (
        <section className="activity-submission-review" aria-label="Paper attempt review">
          <div>
            <p className="eyebrow">Paper attempt {displayAttempt.attempt_number}</p>
            <h3>{numeric(displayAttempt.score)}/{numeric(displayAttempt.max_score)} points recorded</h3>
            <p>This entry stores the checked-paper score only. Individual paper answers are not available online.</p>
          </div>
        </section>
      ) : displayAttempt ? (
        <ActivityQuestionForm
          data={data}
          displayAttempt={displayAttempt}
          initialDrafts={initialDrafts}
          key={`${displayAttempt.id}-${questions.map((question) => question.id).join('-')}`}
          locked={false}
          onSubmit={submitActivity}
          onSaveDraft={saveDisplayedAttemptDraft}
          questions={questions}
          reviewUnlocked={reviewUnlocked}
          saving={saving}
          submissionFailed={submissionFailed}
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
  submissionFailed,
}: {
  data: RouteData
  displayAttempt: ModuleActivityAttempt
  initialDrafts: Record<number, ActivityDraft>
  locked: boolean
  onSubmit: (
    event: FormEvent<HTMLFormElement>,
    drafts: Record<number, ActivityDraft>,
    draftRevision: number,
  ) => Promise<void>
  onSaveDraft: (
    drafts: Record<number, ActivityDraft>,
    draftRevision: number,
  ) => Promise<MainActivityDraftSaveResponse>
  questions: ModuleActivityQuestion[]
  reviewUnlocked: boolean
  saving: boolean
  submissionFailed: boolean
}) {
  const [drafts, setDrafts] = useState(initialDrafts)
  const [showSubmissionReview, setShowSubmissionReview] = useState(false)
  const [draftStatus, setDraftStatus] = useState<'saved' | 'saving' | 'unsaved' | 'error'>('saved')
  const [draftError, setDraftError] = useState('')
  const [activeQuestionId, setActiveQuestionId] = useState(questions[0]?.id ?? null)
  const firstRender = useRef(true)
  const saveQueue = useRef<Promise<void>>(Promise.resolve())
  const savedDrafts = useRef(initialDrafts)
  const revisionRef = useRef(displayAttempt.draft_revision)
  const draftSignature = JSON.stringify(drafts)
  const unanswered = questions.filter((question) => !isAnswered(question, drafts[question.id]))

  const persistDraftChanges = useCallback(async (nextDrafts: Record<number, ActivityDraft>) => {
    const changes = Object.fromEntries(
      Object.entries(nextDrafts).filter(([questionId, draft]) =>
        JSON.stringify(savedDrafts.current[Number(questionId)]) !== JSON.stringify(draft),
      ),
    )
    if (!Object.keys(changes).length) {
      setDraftStatus('saved')
      setDraftError('')
      return
    }
    setDraftStatus('saving')
    setDraftError('')
    try {
      const queuedSave = saveQueue.current
        .catch(() => undefined)
        .then(async () => {
          const result = await onSaveDraft(changes, revisionRef.current)
          revisionRef.current = result.draft_revision
          savedDrafts.current = nextDrafts
        })
      saveQueue.current = queuedSave
      await queuedSave
      setDraftStatus('saved')
    } catch (error) {
      setDraftStatus('error')
      setDraftError(toErrorMessage(error))
    }
  }, [onSaveDraft])

  useEffect(() => {
    revisionRef.current = displayAttempt.draft_revision
  }, [displayAttempt.draft_revision])

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    if (displayAttempt.is_submitted || locked || saving) return
    const timer = window.setTimeout(() => void persistDraftChanges(drafts), 800)
    return () => window.clearTimeout(timer)
  }, [displayAttempt.is_submitted, draftSignature, drafts, locked, persistDraftChanges, saving])

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
          .then(() => onSubmit(event, drafts, revisionRef.current))
      }}
    >
      {!displayAttempt.is_submitted ? (
        <div className={`activity-draft-status activity-draft-status--${draftStatus}`}>
          <p aria-live="polite" role={draftStatus === 'error' ? 'alert' : 'status'}>
            {draftStatus === 'saving' ? 'Saving answers…' : draftStatus === 'unsaved' ? 'Unsaved answer changes' : draftStatus === 'error' ? `Autosave failed — ${draftError || 'your answers are still on this screen.'}` : 'Answers saved'}
          </p>
          {draftStatus === 'error' ? (
            <button className="button button--secondary button--compact" onClick={() => void persistDraftChanges(drafts)} type="button">
              Retry save
            </button>
          ) : null}
        </div>
      ) : null}
      {reviewUnlocked ? (
        <div>
          <p className="eyebrow">Review Answers</p>
          <h3>Latest submitted attempt</h3>
        </div>
      ) : null}
      {questions.length > 1 ? (
        <nav aria-label="Main Activity questions" className="activity-question-navigator">
          <span className={`activity-question-navigator__save activity-question-navigator__save--${draftStatus}`}>
            {draftStatus === 'error' ? 'Save error' : draftStatus === 'saving' ? 'Saving' : draftStatus === 'unsaved' ? 'Unsaved' : 'Saved'}
          </span>
          {questions.map((question, index) => {
            const answered = isAnswered(question, drafts[question.id])
            return (
              <button
                aria-current={activeQuestionId === question.id ? 'step' : undefined}
                className={[
                  activeQuestionId === question.id ? 'active' : '',
                  answered ? 'answered' : 'unanswered',
                ].filter(Boolean).join(' ')}
                key={question.id}
                onClick={() => {
                  setActiveQuestionId(question.id)
                  const target = document.getElementById(`activity-question-${question.id}`)
                  target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                  target?.focus({ preventScroll: true })
                }}
                type="button"
              >
                <span>{index + 1}</span>
                <small>{answered ? 'Answered' : 'Open'}</small>
              </button>
            )
          })}
        </nav>
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
                <span>{saving ? 'Submitting...' : submissionFailed ? 'Retry submission' : 'Confirm submission'}</span>
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
    <article className="question-card" id={`activity-question-${question.id}`} tabIndex={-1}>
      <div className="question-card__header">
        <span className="subject-chip">Question {number}</span>
        <span className="status-pill">{numeric(question.points)} pts</span>
      </div>
      <h2 id={`activity-question-${question.id}-prompt`}>{question.prompt}</h2>

      {question.code_snippet ? <pre>{question.code_snippet}</pre> : null}
      <ActivityQuestionInput
        choices={choices}
        draft={draft}
        matchingOptions={question.matching_options}
        number={number}
        onChange={onChange}
        pairs={pairs}
        question={question}
        readonly={readonly}
        reviewUnlocked={reviewUnlocked}
      />

      {reviewUnlocked ? (
        <AnswerReview attempt={displayAttempt} data={data} draft={draft} question={question} />
      ) : null}
    </article>
  )
}

export function ActivityQuestionInput({
  choices,
  draft,
  matchingOptions,
  number,
  onChange,
  pairs,
  question,
  readonly,
  reviewUnlocked,
}: {
  choices: Array<{ id: number; is_correct?: boolean; text: string }>
  draft: ActivityDraft
  matchingOptions: string[]
  number: number
  onChange: (draft: ActivityDraft) => void
  pairs: Array<{ id: number; left_text: string }>
  question: Pick<ModuleActivityQuestion, 'id' | 'question_type'>
  readonly: boolean
  reviewUnlocked: boolean
}) {
  if (question.question_type === 'multiple_choice' || question.question_type === 'true_false') {
    return (
      <div aria-labelledby={`activity-question-${question.id}-prompt`} className="choice-list" role="radiogroup">
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
            {reviewUnlocked && choice.is_correct ? <strong className="answer-review__mark">Correct</strong> : null}
          </label>
        ))}
      </div>
    )
  }
  if (question.question_type === 'fill_blank') {
    return (
      <input
        aria-label={`Answer for Question ${number}`}
        disabled={readonly}
        onChange={(event) => onChange({ ...draft, text_answer: event.target.value })}
        placeholder="Type your answer"
        type="text"
        value={draft.text_answer}
      />
    )
  }
  if (question.question_type === 'ordering') {
    return (
      <div className="ordering-list">
        {draft.choice_order.map((choiceId, index) => {
          const choice = choices.find((item) => item.id === choiceId)
          if (!choice) return null
          return (
            <div className="ordering-row" key={choiceId}>
              <span>{index + 1}</span>
              <strong>{choice.text}</strong>
              <button aria-label={`Move ${choice.text} up`} disabled={readonly || index === 0} onClick={() => onChange(moveChoice(draft, index, -1))} type="button">Up</button>
              <button aria-label={`Move ${choice.text} down`} disabled={readonly || index === draft.choice_order.length - 1} onClick={() => onChange(moveChoice(draft, index, 1))} type="button">Down</button>
            </div>
          )
        })}
      </div>
    )
  }
  if (question.question_type === 'matching') {
    return (
      <div className="matching-list">
        {pairs.map((pair) => (
          <label className="matching-row" key={pair.id}>
            <span>{pair.left_text}</span>
            <select
              aria-label={`Match ${pair.left_text}`}
              disabled={readonly}
              onChange={(event) => onChange({
                ...draft,
                matching_answer: { ...draft.matching_answer, [String(pair.id)]: event.target.value },
              })}
              value={draft.matching_answer[String(pair.id)] ?? ''}
            >
              <option value="">Choose match</option>
              {matchingOptions.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
        ))}
      </div>
    )
  }
  return (
    <textarea
      aria-label={`Expected output for Question ${number}`}
      className="code-input"
      disabled={readonly}
      onChange={(event) => onChange({ ...draft, text_answer: event.target.value })}
      placeholder="Write the expected output"
      rows={5}
      value={draft.text_answer}
    />
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
    const snapshot = snapshotQuestion(attempt, question.id)
    const correctChoices = snapshot
      ? [...snapshot.choices].sort(
          (first, second) => (first.order ?? 0) - (second.order ?? 0) || first.id - second.id,
        )
      : data.activityChoices
          .filter((choice) => choice.question === question.id)
          .sort((first, second) => first.order - second.order || first.id - second.id)
    return correctChoices.map((choice) => choice.text).join(' -> ')
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
    ? [...snapshot.choices].sort(
        (first, second) =>
          (first.presentation_order ?? first.order ?? 0) -
            (second.presentation_order ?? second.order ?? 0) ||
          first.id - second.id,
      )
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
