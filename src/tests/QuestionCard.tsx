/*
 * QuestionCard.tsx
 * A single question with its choices, elimination toggles, mark-for-review,
 * and (in single/review modes) prev/next navigation. Extracted verbatim from
 * TestShell.tsx — defined outside the shell to prevent re-creation on every
 * render.
 */
import {
  DISPLAY_LABELS,
  NAVY,
  orderChoices,
  type AnswerChoice,
  type Question,
  type ResponseRow,
  type ViewMode,
} from './testTypes'

export type QuestionCardProps = {
  question: Question
  responses: ResponseRow[]
  choices: AnswerChoice[]
  questions: Question[]
  viewMode: ViewMode
  currentIndex: number
  selectAnswer: (questionId: string, choiceId: string) => void
  clearAnswer: (questionId: string) => void
  toggleElimination: (questionId: string, choiceId: string) => void
  toggleMarked: (questionId: string) => void
  openReport: (questionId: string) => void
  goTo: (index: number) => void
  prevIndex: () => number
  nextIndex: () => number
}

export function QuestionCard(props: QuestionCardProps) {
  const {
    question, responses, choices, questions, viewMode, currentIndex,
    selectAnswer, clearAnswer, toggleElimination, toggleMarked, openReport,
    goTo, prevIndex, nextIndex,
  } = props

  const row = responses.find(r => r.question_id === question.id)
  const ordered = orderChoices(row, choices.filter(c => c.question_id === question.id))
  const qIdx = questions.findIndex(q => q.id === question.id)

  return (
    <div id={`q-${question.id}`} className="bg-white rounded-xl shadow-lg overflow-hidden">

      {/* ── dark navy question header band ───────────────────────────────── */}
      <div
        className="px-6 py-3 flex justify-between items-center"
        style={{ backgroundColor: NAVY }}
      >
        <span className="text-white font-semibold text-sm tracking-wide">
          Question #{qIdx + 1}
        </span>
        <button
          type="button"
          onClick={() => openReport(question.id)}
          className="text-blue-200 hover:text-white text-xs border border-blue-400 hover:border-white px-2 py-1 rounded transition-colors"
        >
          Report Issue
        </button>
      </div>

      <div className="p-6 space-y-5">

        {/* ── question text ────────────────────────────────────────────────── */}
        <p className="text-gray-900 text-base leading-relaxed">
          {question.question_text}
        </p>

        {/* ── answer choices ───────────────────────────────────────────────── */}
        <div className="space-y-2">
          {ordered.map((choice, i) => {
            const isEliminated = row?.eliminated_choices?.includes(choice.id) ?? false
            const isSelected   = row?.selected_choice_id === choice.id

            // Determine styles for the choice row
            let rowClasses = 'flex-1 flex items-center gap-3 text-left px-4 py-3 rounded-lg border transition-colors'
            if (isEliminated) {
              rowClasses += ' bg-gray-100 border-gray-200 text-gray-400 line-through cursor-not-allowed'
            } else if (isSelected) {
              rowClasses += ' text-white border-transparent'
            } else {
              rowClasses += ' bg-white text-gray-800 border-gray-300 hover:bg-blue-50 hover:border-blue-300 cursor-pointer'
            }

            // Radio circle styles
            let radioClasses = 'w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-colors'
            if (isEliminated) {
              radioClasses += ' border-gray-300'
            } else if (isSelected) {
              radioClasses += ' border-white bg-white'
            } else {
              radioClasses += ' border-gray-400'
            }

            return (
              <div key={choice.id} className="flex items-center gap-2">
                {/* full-width choice button */}
                <button
                  type="button"
                  onClick={() => !isEliminated && selectAnswer(question.id, choice.id)}
                  disabled={isEliminated}
                  className={rowClasses}
                  style={isSelected ? { backgroundColor: NAVY, borderColor: NAVY } : undefined}
                >
                  {/* radio circle */}
                  <span className={radioClasses}>
                    {isSelected && (
                      <span
                        className="w-2.5 h-2.5 rounded-full block"
                        style={{ backgroundColor: NAVY }}
                      />
                    )}
                  </span>

                  {/* letter label */}
                  <span className="font-semibold text-sm w-4 flex-shrink-0">
                    {DISPLAY_LABELS[i]}.
                  </span>

                  {/* choice text */}
                  <span className="text-sm">{choice.choice_text}</span>
                </button>

                {/* elimination toggle — subtle ✕ icon */}
                <button
                  type="button"
                  onClick={() => toggleElimination(question.id, choice.id)}
                  title={isEliminated ? 'Un-eliminate' : 'Eliminate this choice'}
                  className={[
                    'w-7 h-7 flex items-center justify-center rounded text-xs transition-colors flex-shrink-0',
                    isEliminated
                      ? 'bg-red-100 text-red-500 hover:bg-red-200'
                      : 'text-gray-300 hover:text-gray-500 hover:bg-gray-100',
                  ].join(' ')}
                >
                  ✕
                </button>
              </div>
            )
          })}
        </div>

        {/* ── bottom row: mark for review + clear answer ───────────────────── */}
        <div className="flex items-center justify-between pt-3 border-t border-gray-100">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={row?.marked_for_review ?? false}
              onChange={() => toggleMarked(question.id)}
              className="w-4 h-4 rounded"
              style={{ accentColor: NAVY }}
            />
            <span className="text-sm text-gray-700">
              I want to review this again before I submit
            </span>
          </label>

          {/* clear answer button — only shown when a choice is selected */}
          {row?.selected_choice_id && (
            <button
              type="button"
              onClick={() => clearAnswer(question.id)}
              className="text-xs text-gray-500 border border-gray-300 px-3 py-1.5 rounded hover:bg-gray-50 flex items-center gap-1.5 transition-colors flex-shrink-0 ml-4"
            >
              <span>⬆</span>
              <span>Clear Answer</span>
            </button>
          )}
        </div>

        {/* ── prev / next — only in one-at-a-time and review modes ─────────── */}
        {viewMode !== 'all' && (
          <div className="flex justify-between pt-2 border-t border-gray-100">
            <button
              type="button"
              onClick={() => goTo(prevIndex())}
              disabled={prevIndex() === currentIndex}
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 disabled:opacity-30 hover:bg-gray-50 transition-colors"
            >
              ← Previous
            </button>
            <button
              type="button"
              onClick={() => goTo(nextIndex())}
              disabled={nextIndex() === currentIndex}
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 disabled:opacity-30 hover:bg-gray-50 transition-colors"
            >
              Next →
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
