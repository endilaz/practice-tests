import { useEffect, useRef, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useGenerateTest } from './useGenerateTest'

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
  choice_letter: string // original DB letter — used only for matching display order, never shown
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
// Component
// ---------------------------------------------------------------------------
export default function TestShell() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { generateTest, loading: generating, error: generateError } = useGenerateTest()

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

  // ── phase 2 ────────────────────────────────────────────────────────────
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

  // ---------------------------------------------------------------------------
  // Generate test on mount
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const topicId = searchParams.get('topic')
    const count = searchParams.get('count')
    const timerEnabled = searchParams.get('timer') === '1'
    const minutes = searchParams.get('minutes')

    if (!topicId || !count) {
      setError('Invalid test configuration.')
      setLoading(false)
      return
    }

    generateTest({
      topicId,
      questionCount: parseInt(count, 10),
      useTimer: timerEnabled,
      minutes: timerEnabled && minutes ? parseInt(minutes, 10) : 0,
    }).then(id => {
      if (id) {
        setAttemptId(id)
        if (timerEnabled && minutes) setTimeRemaining(parseInt(minutes, 10) * 60)
      } else {
        setLoading(false)
      }
    })
  }, [searchParams])

  // ---------------------------------------------------------------------------
  // Load test data after generation
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!attemptId) return

    async function loadTest() {
      setLoading(true)
      setError(null)

      // 1. Set started_at only if not already set (safe on refresh)
      const { data: attemptRow } = await supabase
        .from('test_attempts')
        .select('started_at')
        .eq('id', attemptId)
        .single()

      if (!attemptRow?.started_at) {
        await supabase
          .from('test_attempts')
          .update({ started_at: new Date().toISOString() })
          .eq('id', attemptId)
      }

      // 2. Questions (ordered by position)
      const { data: aqRows, error: aqErr } = await supabase
        .from('attempt_questions')
        .select('question_id, position, questions(id, question_text)')
        .eq('attempt_id', attemptId)
        .order('position')

      if (aqErr) { setError('Failed to load questions.'); setLoading(false); return }

      // 3. Answer choices (bulk fetch for all questions)
      const qIds = aqRows.map((r: any) => r.question_id)
      const { data: choiceRows, error: chErr } = await supabase
        .from('answer_choices')
        .select('id, question_id, choice_letter, choice_text')
        .in('question_id', qIds)

      if (chErr) { setError('Failed to load choices.'); setLoading(false); return }

      // 4. Response rows — includes every field we need to hydrate
      const { data: respRows, error: respErr } = await supabase
        .from('question_responses')
        .select(
          'question_id, selected_choice_id, displayed_choices_order, ' +
          'eliminated_choices, marked_for_review, tab_switch_count'
        )
        .eq('attempt_id', attemptId)

      if (respErr) { setError('Failed to load responses.'); setLoading(false); return }

      // 5. Commit state
      setQuestions(aqRows.map((r: any) => ({
        id: r.questions.id,
        question_text: r.questions.question_text,
        position: r.position,
      })))
      setChoices(choiceRows as AnswerChoice[])
      setResponses(respRows as ResponseRow[])
      setLoading(false)

      // 6. Start timer after everything is visible
      if (timeRemaining !== null) setTimerActive(true)
    }

    loadTest()
  }, [attemptId])

  // ---------------------------------------------------------------------------
  // Timer countdown
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!timerActive || timeRemaining === null || submitted) return
    if (timeRemaining <= 0) { handleSubmit(); return }

    const id = setInterval(() =>
      setTimeRemaining(prev => (prev !== null && prev > 0 ? prev - 1 : 0)), 1000)
    return () => clearInterval(id)
  }, [timerActive, timeRemaining, submitted])

  // ---------------------------------------------------------------------------
  // Autosave — 30 s interval. Pushes selected_choice_id, eliminated_choices,
  // marked_for_review, and tab_switch_count for every row. selected_choice_id
  // is also saved per-click, but the periodic flush is the safety net that
  // fixes dropped writes (the NULL issue).
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!attemptId || loading || submitted) return

    autosaveRef.current = setInterval(() => doSave(), 30_000)
    return () => { if (autosaveRef.current) clearInterval(autosaveRef.current) }
  }, [attemptId, loading, submitted])

  // ---------------------------------------------------------------------------
  // Tab tracking — count tab-away events against whichever question is current
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!attemptId || loading || submitted) return

    function onVisibilityChange() {
      if (!document.hidden) return // only count when leaving
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

  // ---------------------------------------------------------------------------
  // Persistence helpers
  // ---------------------------------------------------------------------------

  // Push every response row to the DB in one sequential pass.
  // Used by autosave interval and by the final flush before submit.
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
  // Answer selection
  // ---------------------------------------------------------------------------
  async function selectAnswer(questionId: string, choiceId: string) {
    if (!attemptId || submitting || submitted) return

    // Cannot select an eliminated choice
    const row = responses.find(r => r.question_id === questionId)
    if (row?.eliminated_choices?.includes(choiceId)) return

    const previousChoiceId = row?.selected_choice_id ?? null

    // Optimistic
    setResponses(prev =>
      prev.map(r => r.question_id === questionId ? { ...r, selected_choice_id: choiceId } : r)
    )

    // Persist
    const { error } = await supabase
      .from('question_responses')
      .update({ selected_choice_id: choiceId })
      .eq('attempt_id', attemptId)
      .eq('question_id', questionId)

    if (error) {
      // Revert and surface — fixes the silent-NULL bug
      setResponses(prev =>
        prev.map(r => r.question_id === questionId ? { ...r, selected_choice_id: previousChoiceId } : r)
      )
      setError('Failed to save answer. Please try again.')
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

        // If we're eliminating (not un-eliminating) a choice that is currently
        // selected, deselect it first.
        const newSelected =
          !wasEliminated && r.selected_choice_id === choiceId
            ? null
            : r.selected_choice_id

        return { ...r, eliminated_choices: newEliminated, selected_choice_id: newSelected }
      })
    )

    // If we just deselected, persist that immediately so it doesn't rely
    // solely on the next autosave tick.
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

  // In review mode prev/next skip to the nearest marked question.
  function prevIndex(): number {
    if (viewMode === 'review') {
      for (let i = currentIndex - 1; i >= 0; i--) {
        if (responses.find(r => r.question_id === questions[i].id)?.marked_for_review) return i
      }
      return currentIndex // no earlier marked question — stay put
    }
    return currentIndex - 1
  }

  function nextIndex(): number {
    if (viewMode === 'review') {
      for (let i = currentIndex + 1; i < questions.length; i++) {
        if (responses.find(r => r.question_id === questions[i].id)?.marked_for_review) return i
      }
      return currentIndex
    }
    return currentIndex + 1
  }

  // When the user switches to review mode, snap currentIndex forward to the
  // first marked question so prev/next don't start from an unmarked position.
  function switchViewMode(mode: ViewMode) {
    setViewMode(mode)
    if (mode === 'review') {
      for (let i = 0; i < questions.length; i++) {
        if (responses.find(r => r.question_id === questions[i].id)?.marked_for_review) {
          setCurrentIndex(i)
          return
        }
      }
      // Nothing marked — index stays; the render path shows a message.
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
    if (autosaveRef.current) { clearInterval(autosaveRef.current); autosaveRef.current = null }

    // Final flush — every row, every field, right now. This is the safety net
    // that guarantees nothing is NULL at score time even if earlier writes dropped.
    await doSave()

    // Also write the total tab-switch count onto the attempt row
    const totalSwitches = responses.reduce((sum, r) => sum + r.tab_switch_count, 0)
    await supabase
      .from('test_attempts')
      .update({ out_of_browser_seconds: totalSwitches })
      .eq('id', attemptId)

    // Score
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
    setReportState({ questionId, difficulty: null, quality: null, text: '', submitting: false, error: null })
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
    setReportState({ questionId: null, difficulty: null, quality: null, text: '', submitting: false, error: null })
  }

  // ---------------------------------------------------------------------------
  // Formatting
  // ---------------------------------------------------------------------------
  function formatTime(secs: number) {
    return `${Math.floor(secs / 60)}:${(secs % 60).toString().padStart(2, '0')}`
  }

  function timerClass() {
    if (timeRemaining === null) return 'text-gray-700'
    if (timeRemaining < 60)  return 'text-red-600 font-bold'
    if (timeRemaining < 300) return 'text-yellow-600 font-semibold'
    return 'text-gray-700'
  }

  // Palette button colour: yellow if marked, green if answered, else gray.
  // Yellow takes priority over green so marked-and-answered reads as "needs review".
  function paletteClass(questionId: string) {
    const r = responses.find(row => row.question_id === questionId)
    if (r?.marked_for_review)     return 'bg-yellow-400 text-black'
    if (r?.selected_choice_id)    return 'bg-green-500 text-white'
    return 'bg-gray-200 text-gray-700'
  }

  // ---------------------------------------------------------------------------
  // Sub-render: one question card
  // ---------------------------------------------------------------------------
  function QuestionCard({ question }: { question: Question }) {
    const row = responses.find(r => r.question_id === question.id)
    const ordered = orderChoices(row, choices.filter(c => c.question_id === question.id))
    const qIdx = questions.findIndex(q => q.id === question.id)

    return (
      <div id={`q-${question.id}`} className="bg-white rounded-xl shadow-lg p-8 space-y-6">
        {/* progress + report trigger */}
        <div className="flex justify-between items-center">
          <span className="text-sm text-gray-500">
            Question {qIdx + 1} of {questions.length}
          </span>
          <button
            onClick={() => openReport(question.id)}
            className="text-xs text-gray-500 border border-gray-300 px-2 py-1 rounded hover:bg-gray-100 transition-colors"
          >
            Report Issue
          </button>
        </div>

        {/* question text */}
        <h2 className="text-xl font-bold text-gray-900">{question.question_text}</h2>

        {/* answer choices */}
        <div className="space-y-3">
          {ordered.map((choice, i) => {
            const isEliminated = row?.eliminated_choices?.includes(choice.id) ?? false
            const isSelected   = row?.selected_choice_id === choice.id

            return (
              <div key={choice.id} className="flex items-center gap-2">
                {/* choice button */}
                <button
                  onClick={() => selectAnswer(question.id, choice.id)}
                  disabled={isEliminated}
                  className={[
                    'flex-1 text-left px-4 py-3 rounded-lg border-2 transition-colors',
                    isEliminated
                      ? 'bg-red-50 border-red-200 text-red-400 line-through cursor-not-allowed'
                      : isSelected
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-gray-900 border-gray-300 hover:bg-blue-50 hover:border-blue-300',
                  ].join(' ')}
                >
                  {/* ← positional label, NOT choice.choice_letter */}
                  <span className="font-semibold">{DISPLAY_LABELS[i]}.</span>{' '}
                  {choice.choice_text}
                </button>

                {/* elimination toggle — small ✕ button beside each choice */}
                <button
                  onClick={() => toggleElimination(question.id, choice.id)}
                  className={[
                    'w-8 h-8 flex items-center justify-center rounded border text-sm transition-colors',
                    isEliminated
                      ? 'bg-red-100 border-red-300 text-red-600 hover:bg-red-200'
                      : 'bg-gray-100 border-gray-300 text-gray-500 hover:bg-gray-200',
                  ].join(' ')}
                  title={isEliminated ? 'Un-eliminate' : 'Eliminate'}
                >
                  ✕
                </button>
              </div>
            )
          })}
        </div>

        {/* mark for review */}
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={row?.marked_for_review ?? false}
            onChange={() => toggleMarked(question.id)}
            className="w-4 h-4 accent-blue-600"
          />
          <span className="text-sm text-gray-700">Mark for review</span>
        </label>

        {/* prev / next — only in one-at-a-time and review modes */}
        {viewMode !== 'all' && (
          <div className="flex justify-between pt-3 border-t border-gray-200">
            <button
              onClick={() => goTo(prevIndex())}
              disabled={prevIndex() === currentIndex}
              className="px-4 py-2 border rounded-lg text-sm disabled:opacity-30 hover:bg-gray-50 transition-colors"
            >
              Previous
            </button>
            <button
              onClick={() => goTo(nextIndex())}
              disabled={nextIndex() === currentIndex}
              className="px-4 py-2 border rounded-lg text-sm disabled:opacity-30 hover:bg-gray-50 transition-colors"
            >
              Next
            </button>
          </div>
        )}
      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // Early-return screens
  // ---------------------------------------------------------------------------
  if (generating || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-lg text-gray-600">
          {generating ? 'Generating test…' : 'Loading questions…'}
        </p>
      </div>
    )
  }

  if (generateError || error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white p-8 rounded-xl shadow max-w-md">
          <h2 className="text-xl font-bold text-red-600 mb-4">Error</h2>
          <p className="text-gray-700">{generateError || error}</p>
          <button onClick={() => navigate('/')} className="mt-4 bg-blue-600 text-white px-4 py-2 rounded-lg">
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
          <h2 className="text-2xl font-bold">Test Complete</h2>
          <p className="text-5xl font-bold text-blue-600">{score.score} / {score.total}</p>
          <p className="text-lg text-gray-600">
            {score.total > 0 ? Math.round((score.score / score.total) * 100) : 0}%
          </p>
          <button onClick={() => navigate('/')} className="bg-blue-600 text-white px-6 py-2 rounded-lg">
            Back to Dashboard
          </button>
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
  // Determine what the "review" body shows.
  // If nothing is marked, show a message instead of crashing on an empty card.
  // ---------------------------------------------------------------------------
  const anyMarked = responses.some(r => r.marked_for_review)

  // ---------------------------------------------------------------------------
  // Main render
  // ---------------------------------------------------------------------------
  return (
    <div className="min-h-screen bg-blue-600 flex flex-col">
      {/* ── header ───────────────────────────────────────────────────────── */}
      <header className="bg-white shadow-sm px-6 py-4 flex justify-between items-center">
        <h1 className="text-lg font-semibold text-gray-800">Practice Test</h1>
        <div className="flex items-center gap-4">
          {/* view-mode dropdown */}
          <select
            value={viewMode}
            onChange={e => switchViewMode(e.target.value as ViewMode)}
            className="border border-gray-300 px-2 py-1.5 rounded-lg text-sm bg-white"
          >
            <option value="one">One at a Time</option>
            <option value="all">All Questions</option>
            <option value="review">Review Only</option>
          </select>

          {/* timer */}
          {timeRemaining !== null && (
            <span className={`text-lg ${timerClass()}`}>{formatTime(timeRemaining)}</span>
          )}

          {/* submit */}
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="bg-green-600 hover:bg-green-700 text-white px-4 py-1.5 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
          >
            {submitting ? 'Submitting…' : 'Submit Test'}
          </button>
        </div>
      </header>

      {/* ── question area ─────────────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto space-y-6">
          {viewMode === 'one' && questions[currentIndex] && (
            <QuestionCard question={questions[currentIndex]} />
          )}

          {viewMode === 'all' && questions.map(q => (
            <QuestionCard key={q.id} question={q} />
          ))}

          {viewMode === 'review' && (
            anyMarked
              ? <QuestionCard question={questions[currentIndex]} />
              : <div className="bg-white rounded-xl shadow-lg p-8 text-center space-y-2">
                  <p className="text-gray-700 font-medium">No questions marked for review.</p>
                  <p className="text-sm text-gray-400">
                    Switch to another view and check "Mark for review" on questions you want to revisit.
                  </p>
                </div>
          )}
        </div>
      </main>

      {/* ── question palette (always visible) ────────────────────────────── */}
      <footer className="bg-white border-t border-gray-200 px-6 py-3">
        <div className="max-w-2xl mx-auto flex flex-wrap gap-2">
          {questions.map((q, i) => {
            const isCurrentInSingleView = i === currentIndex && viewMode !== 'all'
            const isMarked = responses.find(r => r.question_id === q.id)?.marked_for_review
            // In review mode, greyed-out buttons for unmarked questions are not clickable.
            const blocked = viewMode === 'review' && !isMarked

            return (
              <button
                key={q.id}
                onClick={() => {
                  if (blocked) return
                  setCurrentIndex(i)
                  if (viewMode === 'all') {
                    document.getElementById(`q-${q.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  }
                }}
                className={[
                  'w-9 h-9 rounded-lg text-sm font-semibold border-2 transition-colors',
                  paletteClass(q.id),
                  isCurrentInSingleView ? 'border-blue-600' : 'border-transparent',
                  blocked ? 'opacity-35 cursor-not-allowed' : 'cursor-pointer hover:opacity-80',
                ].join(' ')}
                title={`Question ${i + 1}`}
              >
                {i + 1}
              </button>
            )
          })}
        </div>
      </footer>

      {/* ── report-issue modal ────────────────────────────────────────────── */}
      {reportState.questionId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 p-6 space-y-4">
            {/* header */}
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold text-gray-900">Report an Issue</h3>
              <button
                onClick={() => setReportState(s => ({ ...s, questionId: null }))}
                className="text-gray-400 hover:text-gray-700 text-xl leading-none"
              >✕</button>
            </div>

            {reportState.error && <p className="text-red-600 text-sm">{reportState.error}</p>}

            {/* difficulty */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Difficulty (1–5)</label>
              <div className="flex gap-2">
                {[1,2,3,4,5].map(n => (
                  <button
                    key={n}
                    onClick={() => setReportState(s => ({ ...s, difficulty: n }))}
                    className={[
                      'w-9 h-9 rounded-lg border text-sm font-semibold transition-colors',
                      reportState.difficulty === n
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'border-gray-300 hover:bg-gray-100',
                    ].join(' ')}
                  >{n}</button>
                ))}
              </div>
            </div>

            {/* quality */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Quality (1–5)</label>
              <div className="flex gap-2">
                {[1,2,3,4,5].map(n => (
                  <button
                    key={n}
                    onClick={() => setReportState(s => ({ ...s, quality: n }))}
                    className={[
                      'w-9 h-9 rounded-lg border text-sm font-semibold transition-colors',
                      reportState.quality === n
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'border-gray-300 hover:bg-gray-100',
                    ].join(' ')}
                  >{n}</button>
                ))}
              </div>
            </div>

            {/* comments */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Comments (optional)</label>
              <textarea
                value={reportState.text}
                onChange={e => setReportState(s => ({ ...s, text: e.target.value }))}
                rows={3}
                placeholder="Describe the issue…"
                className="border border-gray-300 px-3 py-2 w-full rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* actions */}
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => setReportState(s => ({ ...s, questionId: null }))}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 transition-colors"
              >Cancel</button>
              <button
                onClick={submitReport}
                disabled={reportState.submitting}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50 transition-colors"
              >{reportState.submitting ? 'Sending…' : 'Submit'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}