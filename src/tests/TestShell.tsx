import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/auth/useAuth'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type Question = {
  id: string
  question_text: string
  position: number
}

type AnswerChoice = {
  id: string
  question_id: string
  choice_letter: string // original DB letter — used only for matching display order, never shown as-is
  choice_text: string
}

type ResponseRow = {
  question_id: string
  selected_choice_id: string | null
  displayed_choices_order: string[]
  eliminated_choices: string[]
  marked_for_review: boolean
  tab_switch_count: number
}

type ViewMode = 'one' | 'all' | 'review'

// Positional labels rendered to the user. Always A B C D top-to-bottom
// regardless of the DB's internal choice_letter values.
const DISPLAY_LABELS = ['A', 'B', 'C', 'D']

// Navy theme color — defined once so it's easy to update
const NAVY = '#1a2e5a'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
// Given a question's responses row and the raw choices from the DB,
// return choices sorted into the server-determined display order.
function orderChoices(row: ResponseRow | undefined, raw: AnswerChoice[]): AnswerChoice[] {
  if (!row?.displayed_choices_order?.length) return raw
  return row.displayed_choices_order
    .map(letter => raw.find(c => c.choice_letter === letter))
    .filter((c): c is AnswerChoice => c !== undefined)
}

// ---------------------------------------------------------------------------
// Sub-components (defined outside to prevent re-creation on every render)
// ---------------------------------------------------------------------------

type QuestionCardProps = {
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

function QuestionCard(props: QuestionCardProps) {
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

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function TestShell() {
  const { id: attemptIdParam } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  // Anonymous sessions: after results, route to /login instead of dashboard.
  const isAnonymous = !!(user as any)?.is_anonymous

  // ── core data ──────────────────────────────────────────────────────────
  const [attemptId, setAttemptId] = useState<string | null>(null)
  const [questions, setQuestions] = useState<Question[]>([])
  const [choices, setChoices] = useState<AnswerChoice[]>([])
  const [responses, setResponses] = useState<ResponseRow[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // ── timer ──────────────────────────────────────────────────────────────
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null)
  const [timerActive, setTimerActive] = useState(false)

  // ── submit ─────────────────────────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [score, setScore] = useState<{ score: number; total: number } | null>(null)

  // ── view mode ──────────────────────────────────────────────────────────
  const [viewMode, setViewMode] = useState<ViewMode>('one')

  // ── report issue modal ─────────────────────────────────────────────────
  const [reportState, setReportState] = useState<{
    questionId: string | null
    difficulty: number | null
    quality: number | null
    text: string
    submitting: boolean
    error: string | null
  }>({ questionId: null, difficulty: null, quality: null, text: '', submitting: false, error: null })

  // ── refs ───────────────────────────────────────────────────────────────
  // currentIndex ref so the visibilitychange handler always reads the
  // freshest index without needing to be torn down and re-added every render.
  const currentIndexRef = useRef(0)
  currentIndexRef.current = currentIndex

  // autosave interval handle — stored in a ref so handleSubmit can clear it
  // without depending on effect closure timing.
  const autosaveRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // responses ref — mirrors state every render so that doSave() and the
  // autosave interval always read the latest values without needing
  // responses in any effect dep array (which would reset the interval).
  const responsesRef = useRef<ResponseRow[]>([])
  responsesRef.current = responses

  // Ref for the palette scroll container — used to auto-scroll the active button into view.
  const paletteRef = useRef<HTMLDivElement>(null)

  // ---------------------------------------------------------------------------
  // Read attemptId from URL on mount
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!attemptIdParam) {
      setError('No test attempt ID provided.')
      setLoading(false)
      return
    }
    setAttemptId(attemptIdParam)
  }, [attemptIdParam])

  // ---------------------------------------------------------------------------
  // Load test data after attemptId is set
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!attemptId) return

    async function loadTest() {
      setLoading(true)
      setError(null)

      // 1. Get attempt metadata (including timer settings)
      const { data: attemptRow, error: attemptError } = await supabase
        .from('test_attempts')
        .select('started_at, use_timer, minutes')
        .eq('id', attemptId)
        .single()

      if (attemptError) {
        setError('Failed to load test.')
        setLoading(false)
        return
      }

      // 2. Set started_at only if not already set (safe on refresh)
      if (!attemptRow.started_at) {
        await supabase
          .from('test_attempts')
          .update({ started_at: new Date().toISOString() })
          .eq('id', attemptId)
      }

      // 3. Configure timer if enabled
      if (attemptRow.use_timer && attemptRow.minutes) {
        setTimeRemaining(attemptRow.minutes * 60)
      }

      // 4. Questions ordered by position
      const { data: aqRows, error: aqErr } = await supabase
        .from('attempt_questions')
        .select('question_id, position, questions(id, question_text)')
        .eq('attempt_id', attemptId)
        .order('position')

      if (aqErr) {
        setError('Failed to load questions.')
        setLoading(false)
        return
      }

      // 5. Answer choices — bulk fetch for all questions in one query
      const qIds = aqRows.map((r: any) => r.question_id)
      const { data: choiceRows, error: chErr } = await supabase
        .from('answer_choices')
        .select('id, question_id, choice_letter, choice_text')
        .in('question_id', qIds)

      if (chErr) {
        setError('Failed to load choices.')
        setLoading(false)
        return
      }

      // 6. Response rows — every field needed to hydrate UI state
      const { data: respRows, error: respErr } = await supabase
        .from('question_responses')
        .select(
          'question_id, selected_choice_id, displayed_choices_order, ' +
          'eliminated_choices, marked_for_review, tab_switch_count'
        )
        .eq('attempt_id', attemptId)

      if (respErr) {
        setError('Failed to load responses.')
        setLoading(false)
        return
      }

      // 7. Commit all state atomically
      setQuestions(aqRows.map((r: any) => ({
        id: r.questions.id,
        question_text: r.questions.question_text,
        position: r.position,
      })))
      setChoices(choiceRows as AnswerChoice[])
      setResponses(respRows as ResponseRow[])
      setLoading(false)

      // 8. Start timer after data is visible
      if (attemptRow.use_timer && attemptRow.minutes) {
        setTimerActive(true)
      }
    }

    loadTest()
  }, [attemptId])

  // ---------------------------------------------------------------------------
  // Timer countdown — ticks every second when active
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!timerActive || timeRemaining === null || submitted) return
    if (timeRemaining <= 0) { handleSubmit(); return }

    const id = setInterval(() =>
      setTimeRemaining(prev => (prev !== null && prev > 0 ? prev - 1 : 0)), 1000)
    return () => clearInterval(id)
  }, [timerActive, timeRemaining, submitted])

  // ---------------------------------------------------------------------------
  // Autosave — flush all response state to the DB every 30 seconds.
  // The per-click saves on selectAnswer are the fast path; this is the safety net.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!attemptId || loading || submitted) return

    autosaveRef.current = setInterval(() => doSave(), 30_000)
    return () => { if (autosaveRef.current) clearInterval(autosaveRef.current) }
  }, [attemptId, loading, submitted])

  // ---------------------------------------------------------------------------
  // Tab tracking — count how many times the user leaves the tab.
  // Incremented against whichever question is currently active.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!attemptId || loading || submitted) return

    function onVisibilityChange() {
      if (!document.hidden) return // only count tab-away events
      const qId = questions[currentIndexRef.current]?.id
      if (!qId) return
      setResponses(prev =>
        prev.map(r =>
          r.question_id === qId
            ? { ...r, tab_switch_count: r.tab_switch_count + 1 }
            : r
        )
      )
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [attemptId, loading, submitted, questions])

  // Auto-scroll the active palette button into view whenever currentIndex changes.
  useEffect(() => {
    if (!paletteRef.current) return
    const activeBtn = paletteRef.current.querySelector<HTMLElement>('[data-palette-active="true"]')
    activeBtn?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }, [currentIndex])

  // ---------------------------------------------------------------------------
  // Persistence helpers
  // ---------------------------------------------------------------------------

  // Push every response row to the DB sequentially.
  // Used by the autosave interval and by the final flush before submit.
  async function doSave() {
    if (!attemptId) return
    for (const r of responsesRef.current) {
      await supabase
        .from('question_responses')
        .update({
          selected_choice_id: r.selected_choice_id,
          eliminated_choices: r.eliminated_choices,
          marked_for_review: r.marked_for_review,
          tab_switch_count: r.tab_switch_count,
        })
        .eq('attempt_id', attemptId)
        .eq('question_id', r.question_id)
    }
  }

  // ---------------------------------------------------------------------------
  // Answer selection — optimistic update with rollback on error
  // ---------------------------------------------------------------------------
  async function selectAnswer(questionId: string, choiceId: string) {
    if (!attemptId || submitting || submitted) return

    // Guard: cannot select an eliminated choice
    const row = responses.find(r => r.question_id === questionId)
    if (row?.eliminated_choices?.includes(choiceId)) return

    const previousChoiceId = row?.selected_choice_id ?? null

    // Optimistic UI update
    setResponses(prev =>
      prev.map(r => r.question_id === questionId ? { ...r, selected_choice_id: choiceId } : r)
    )

    // Persist to DB
    const { error } = await supabase
      .from('question_responses')
      .update({ selected_choice_id: choiceId })
      .eq('attempt_id', attemptId)
      .eq('question_id', questionId)

    if (error) {
      // Rollback and surface the error
      setResponses(prev =>
        prev.map(r => r.question_id === questionId ? { ...r, selected_choice_id: previousChoiceId } : r)
      )
      setError('Failed to save answer. Please try again.')
    }
  }

  // ---------------------------------------------------------------------------
  // Clear answer — deselects the current answer for a question
  // ---------------------------------------------------------------------------
  async function clearAnswer(questionId: string) {
    if (!attemptId || submitting || submitted) return

    const row = responses.find(r => r.question_id === questionId)
    const previousChoiceId = row?.selected_choice_id ?? null

    // Optimistic UI update
    setResponses(prev =>
      prev.map(r => r.question_id === questionId ? { ...r, selected_choice_id: null } : r)
    )

    // Persist to DB
    const { error } = await supabase
      .from('question_responses')
      .update({ selected_choice_id: null })
      .eq('attempt_id', attemptId)
      .eq('question_id', questionId)

    if (error) {
      // Rollback on failure
      setResponses(prev =>
        prev.map(r => r.question_id === questionId ? { ...r, selected_choice_id: previousChoiceId } : r)
      )
      setError('Failed to clear answer. Please try again.')
    }
  }

  // ---------------------------------------------------------------------------
  // Elimination toggle
  // ---------------------------------------------------------------------------
  function toggleElimination(questionId: string, choiceId: string) {
    if (submitting || submitted) return

    setResponses(prev =>
      prev.map(r => {
        if (r.question_id !== questionId) return r

        const wasEliminated = r.eliminated_choices.includes(choiceId)
        const newEliminated = wasEliminated
          ? r.eliminated_choices.filter(id => id !== choiceId)
          : [...r.eliminated_choices, choiceId]

        // If we're eliminating a currently-selected choice, deselect it first
        const newSelected =
          !wasEliminated && r.selected_choice_id === choiceId
            ? null
            : r.selected_choice_id

        return { ...r, eliminated_choices: newEliminated, selected_choice_id: newSelected }
      })
    )

    // Persist the deselection immediately if we just knocked out the selected choice
    const row = responses.find(r => r.question_id === questionId)
    const wasEliminated = row?.eliminated_choices.includes(choiceId)
    if (!wasEliminated && row?.selected_choice_id === choiceId) {
      supabase
        .from('question_responses')
        .update({ selected_choice_id: null })
        .eq('attempt_id', attemptId)
        .eq('question_id', questionId)
    }
  }

  // ---------------------------------------------------------------------------
  // Mark for review toggle
  // ---------------------------------------------------------------------------
  function toggleMarked(questionId: string) {
    if (submitting || submitted) return
    setResponses(prev =>
      prev.map(r => r.question_id === questionId ? { ...r, marked_for_review: !r.marked_for_review } : r)
    )
  }

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------
  function goTo(index: number) {
    if (index >= 0 && index < questions.length) setCurrentIndex(index)
  }

  // In review mode, prev/next skip to the nearest marked question.
  function prevIndex(): number {
    if (viewMode === 'review') {
      for (let i = currentIndex - 1; i >= 0; i--) {
        if (responses.find(r => r.question_id === questions[i].id)?.marked_for_review) return i
      }
      return currentIndex // no earlier marked question — stay put
    }
    return Math.max(0, currentIndex - 1)
  }

  function nextIndex(): number {
    if (viewMode === 'review') {
      for (let i = currentIndex + 1; i < questions.length; i++) {
        if (responses.find(r => r.question_id === questions[i].id)?.marked_for_review) return i
      }
      return currentIndex
    }
    return Math.min(questions.length - 1, currentIndex + 1)
  }

  // When switching to review mode, snap to the first marked question
  // so prev/next don't start from an unmarked position.
  function switchViewMode(mode: ViewMode) {
    setViewMode(mode)
    if (mode === 'review') {
      for (let i = 0; i < questions.length; i++) {
        if (responses.find(r => r.question_id === questions[i].id)?.marked_for_review) {
          setCurrentIndex(i)
          return
        }
      }
      // Nothing marked — index stays; the render path shows a message
    }
  }

  // ---------------------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------------------
  async function handleSubmit() {
    if (!attemptId || submitting || submitted) return

    const confirmed = window.confirm(
      'Are you sure you want to submit? You cannot change your answers after submitting.'
    )
    if (!confirmed) return

    setSubmitting(true)
    setTimerActive(false)

    // Stop the autosave interval
    if (autosaveRef.current) {
      clearInterval(autosaveRef.current)
      autosaveRef.current = null
    }

    // Final flush — every row, every field, right now
    await doSave()

    // Write total tab-switch count onto the attempt row
    const totalSwitches = responses.reduce((sum, r) => sum + r.tab_switch_count, 0)
    await supabase
      .from('test_attempts')
      .update({ out_of_browser_seconds: totalSwitches })
      .eq('id', attemptId)

    // Score the attempt server-side
    const { data, error } = await supabase.rpc('submit_test', { p_attempt_id: attemptId })
    if (error) {
      setError(`Failed to submit: ${error.message}`)
      setSubmitting(false)
      return
    }

    setScore(data as { score: number; total: number })
    setSubmitted(true)
    setSubmitting(false)
  }

  // ---------------------------------------------------------------------------
  // Report Issue
  // ---------------------------------------------------------------------------
  function openReport(questionId: string) {
    setReportState({
      questionId,
      difficulty: null,
      quality: null,
      text: '',
      submitting: false,
      error: null,
    })
  }

  async function submitReport() {
    if (!reportState.questionId || reportState.submitting) return

    if (reportState.difficulty === null && reportState.quality === null && !reportState.text.trim()) {
      setReportState(s => ({ ...s, error: 'Please fill in at least one field.' }))
      return
    }

    setReportState(s => ({ ...s, submitting: true, error: null }))

    const { data: userData } = await supabase.auth.getUser()
    const { error } = await supabase.from('question_feedback').insert({
      user_id: userData.user?.id,
      question_id: reportState.questionId,
      attempt_id: attemptId,
      difficulty_rating: reportState.difficulty,
      quality_rating: reportState.quality,
      feedback_text: reportState.text.trim() || null,
    })

    if (error) {
      setReportState(s => ({ ...s, submitting: false, error: 'Failed to submit. Try again.' }))
      return
    }

    // Success — close modal
    setReportState({
      questionId: null,
      difficulty: null,
      quality: null,
      text: '',
      submitting: false,
      error: null,
    })
  }

  // ---------------------------------------------------------------------------
  // Formatting helpers
  // ---------------------------------------------------------------------------
  function formatTime(secs: number): string {
    const m = Math.floor(secs / 60)
    const s = (secs % 60).toString().padStart(2, '0')
    return `${m}:${s}`
  }

  // Palette button colour: yellow if marked, green if answered, else gray.
  // Yellow takes priority over green so marked-and-answered reads as "needs review".
  function paletteClass(questionId: string): string {
    const r = responses.find(row => row.question_id === questionId)
    if (r?.marked_for_review) return 'bg-yellow-400 text-black'
    if (r?.selected_choice_id) return 'bg-green-500 text-white'
    return 'bg-gray-200 text-gray-700'
  }

  // Props forwarded to every QuestionCard
  const cardProps = {
    responses, choices, questions, viewMode, currentIndex,
    selectAnswer, clearAnswer, toggleElimination, toggleMarked,
    openReport, goTo, prevIndex, nextIndex,
  }

  // Derived: does any question have marked_for_review = true?
  const anyMarked = responses.some(r => r.marked_for_review)

  // ---------------------------------------------------------------------------
  // Early-return screens
  // ---------------------------------------------------------------------------
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-lg text-gray-600">Loading questions…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white p-8 rounded-xl shadow max-w-md">
          <h2 className="text-xl font-bold text-red-600 mb-4">Error</h2>
          <p className="text-gray-700">{error}</p>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="mt-4 text-white px-4 py-2 rounded-lg"
            style={{ backgroundColor: NAVY }}
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    )
  }

  if (submitted && score) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white p-8 rounded-xl shadow max-w-md w-full text-center space-y-4">
          <h2 className="text-2xl font-bold">Test Complete!</h2>
          <p className="text-5xl font-bold" style={{ color: NAVY }}>
            {score.score} / {score.total}
          </p>
          <p className="text-lg text-gray-600">
            {score.total > 0 ? Math.round((score.score / score.total) * 100) : 0}%
          </p>
          <div className="flex flex-col gap-2 pt-4">
            <button
              type="button"
              onClick={() => navigate(`/results/${attemptId}`)}
              className="text-white px-6 py-3 rounded-lg font-medium hover:opacity-90 transition-opacity"
              style={{ backgroundColor: NAVY }}
            >
              View Detailed Results
            </button>
            <button
              type="button"
              onClick={() => navigate(isAnonymous ? '/login' : '/')}
              className="bg-gray-600 text-white px-6 py-2 rounded-lg hover:bg-gray-700 transition-colors"
            >
              {isAnonymous ? 'Back to Login' : 'Back to Dashboard'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (questions.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-lg text-gray-600">No questions available.</p>
      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // Main render
  // ---------------------------------------------------------------------------
  return (
    <div className="min-h-screen bg-blue-600 flex flex-col">

      {/* ── header ─────────────────────────────────────────────────────────── */}
      <header
        className="px-6 py-4 flex justify-between items-center shadow-md"
        style={{ backgroundColor: NAVY }}
      >
        {/* left: test title */}
        <h1 className="text-white font-semibold text-base">Practice Test</h1>

        {/* center: timer (only when enabled) */}
        {timeRemaining !== null && (
          <div className="flex flex-col items-center">
            <span className={[
              'text-xl font-bold tabular-nums',
              timeRemaining < 60   ? 'text-red-400'
              : timeRemaining < 300  ? 'text-yellow-300'
              : 'text-white',
            ].join(' ')}>
              {formatTime(timeRemaining)}
            </span>
            <span className="text-blue-300 text-xs tracking-wide">Remaining</span>
          </div>
        )}

        {/* right: view-mode dropdown + submit */}
        <div className="flex items-center gap-3">
          <select
            value={viewMode}
            onChange={e => switchViewMode(e.target.value as ViewMode)}
            className="bg-white text-gray-800 border-0 px-3 py-1.5 rounded-lg text-sm font-medium cursor-pointer"
          >
            <option value="one">One at a Time</option>
            <option value="all">All Questions</option>
            <option value="review">Review Only</option>
          </select>

          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="bg-white font-semibold px-4 py-1.5 rounded-lg text-sm hover:bg-blue-50 disabled:opacity-50 transition-colors flex items-center gap-1.5"
            style={{ color: NAVY }}
          >
            {submitting ? 'Submitting…' : '✈ Submit'}
          </button>
        </div>
      </header>

      {/* ── question area ───────────────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto space-y-6">

          {/* one-at-a-time mode */}
          {viewMode === 'one' && questions[currentIndex] && (
            <QuestionCard question={questions[currentIndex]} {...cardProps} />
          )}

          {/* all-questions mode */}
          {viewMode === 'all' && questions.map(q => (
            <QuestionCard key={q.id} question={q} {...cardProps} />
          ))}

          {/* review-only mode */}
          {viewMode === 'review' && (
            anyMarked
              ? <QuestionCard question={questions[currentIndex]} {...cardProps} />
              : (
                <div className="bg-white rounded-xl shadow-lg p-8 text-center space-y-2">
                  <p className="text-gray-700 font-medium">No questions marked for review.</p>
                  <p className="text-sm text-gray-400">
                    Switch to another view and check "I want to review this again" on questions you want to revisit.
                  </p>
                </div>
              )
          )}
        </div>
      </main>

      {/* ── question palette (always visible, horizontally scrollable) ──────── */}
      <footer className="bg-white border-t border-gray-200 py-3">
        {/*
          Width matches the question card area (max-w-3xl, px-6 gutter on each side).
          overflow-x-auto + flex-nowrap keeps all buttons in a single scrollable row.
          scrollbar-thin styling via native CSS — no plugin needed.
        */}
        <div className="max-w-3xl mx-auto px-6">
          <div
            ref={paletteRef}
            className="flex gap-2 overflow-x-auto pb-1"
            style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e1 transparent' }}
          >
            {questions.map((q, i) => {
              const isCurrentInSingleView = i === currentIndex && viewMode !== 'all'
              const isMarked = responses.find(r => r.question_id === q.id)?.marked_for_review
              const blocked = viewMode === 'review' && !isMarked

              return (
                <button
                  key={q.id}
                  type="button"
                  data-palette-active={isCurrentInSingleView ? 'true' : 'false'}
                  onClick={() => {
                    if (blocked) return
                    setCurrentIndex(i)
                    if (viewMode === 'all') {
                      document.getElementById(`q-${q.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                    }
                  }}
                  className={[
                    'w-9 h-9 flex-shrink-0 rounded-lg text-sm font-semibold border-2 transition-colors',
                    paletteClass(q.id),
                    blocked ? 'opacity-35 cursor-not-allowed' : 'cursor-pointer hover:opacity-80',
                  ].join(' ')}
                  style={isCurrentInSingleView ? { borderColor: NAVY } : { borderColor: 'transparent' }}
                  title={`Question ${i + 1}`}
                >
                  {i + 1}
                </button>
              )
            })}
          </div>
        </div>
      </footer>

      {/* ── report-issue modal ──────────────────────────────────────────────── */}
      {reportState.questionId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 p-6 space-y-4">

            {/* modal header */}
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold text-gray-900">Report an Issue</h3>
              <button
                type="button"
                onClick={() => setReportState(s => ({ ...s, questionId: null }))}
                className="text-gray-400 hover:text-gray-700 text-xl leading-none"
              >
                ✕
              </button>
            </div>

            {reportState.error && (
              <p className="text-red-600 text-sm">{reportState.error}</p>
            )}

            {/* difficulty rating */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Difficulty (1–5)
              </label>
              <div className="flex gap-2">
                {[1, 2, 3, 4, 5].map(n => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setReportState(s => ({ ...s, difficulty: n }))}
                    className={[
                      'w-9 h-9 rounded-lg border text-sm font-semibold transition-colors',
                      reportState.difficulty === n
                        ? 'text-white border-transparent'
                        : 'border-gray-300 hover:bg-gray-100',
                    ].join(' ')}
                    style={reportState.difficulty === n ? { backgroundColor: NAVY } : undefined}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            {/* quality rating */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Quality (1–5)
              </label>
              <div className="flex gap-2">
                {[1, 2, 3, 4, 5].map(n => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setReportState(s => ({ ...s, quality: n }))}
                    className={[
                      'w-9 h-9 rounded-lg border text-sm font-semibold transition-colors',
                      reportState.quality === n
                        ? 'text-white border-transparent'
                        : 'border-gray-300 hover:bg-gray-100',
                    ].join(' ')}
                    style={reportState.quality === n ? { backgroundColor: NAVY } : undefined}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            {/* comments */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Comments (optional)
              </label>
              <textarea
                value={reportState.text}
                onChange={e => setReportState(s => ({ ...s, text: e.target.value }))}
                rows={3}
                placeholder="Describe the issue…"
                className="border border-gray-300 px-3 py-2 w-full rounded-lg text-sm resize-none focus:outline-none focus:ring-2"
                style={{ '--tw-ring-color': NAVY } as React.CSSProperties}
              />
            </div>

            {/* actions */}
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setReportState(s => ({ ...s, questionId: null }))}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitReport}
                disabled={reportState.submitting}
                className="text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50 hover:opacity-90 transition-opacity"
                style={{ backgroundColor: NAVY }}
              >
                {reportState.submitting ? 'Sending…' : 'Submit'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}