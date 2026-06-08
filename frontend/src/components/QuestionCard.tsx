import type { AnswerDraft, WorkspaceData } from '../app/types'
import type { Question } from '../types'
import { getQuestionChoices } from '../utils/student'
import { numeric } from '../utils/format'
import { EmptyState } from './ui'

export function QuestionCard({
  data,
  draft,
  number,
  onChange,
  question,
  readonly,
}: {
  data: WorkspaceData
  draft: AnswerDraft
  number: number
  onChange: (draft: AnswerDraft) => void
  question: Question
  readonly: boolean
}) {
  const choices = getQuestionChoices(data, question)

  return (
    <article className="question-card">
      <div className="question-card__header">
        <span className="subject-chip">Question {number}</span>
        <span className="status-pill">{numeric(question.points)} pts</span>
      </div>
      <h2>{question.prompt}</h2>

      {question.question_type === 'MULTIPLE_CHOICE' ||
      question.question_type === 'TRUE_FALSE' ? (
        <div className="choice-list">
          {choices.length ? (
            choices.map((choice) => (
              <label className="choice-option" key={choice.id}>
                <input
                  checked={draft.selected_choice === choice.id}
                  disabled={readonly}
                  name={`question-${question.id}`}
                  onChange={() =>
                    onChange({ ...draft, selected_choice: choice.id })
                  }
                  type="radio"
                />
                <span>{choice.text}</span>
              </label>
            ))
          ) : (
            <EmptyState
              icon="assessment"
              title="No choices"
              message="Choices for this question are not available yet."
            />
          )}
        </div>
      ) : question.question_type === 'CODING' ? (
        <textarea
          className="code-input"
          disabled={readonly}
          onChange={(event) =>
            onChange({ ...draft, code_answer: event.target.value })
          }
          placeholder="Write your code answer"
          rows={10}
          value={draft.code_answer}
        />
      ) : (
        <textarea
          disabled={readonly}
          onChange={(event) =>
            onChange({ ...draft, text_answer: event.target.value })
          }
          placeholder="Write your answer"
          rows={question.question_type === 'ESSAY' ? 8 : 4}
          value={draft.text_answer}
        />
      )}
    </article>
  )
}
