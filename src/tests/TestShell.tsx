/*
 * TestShell.tsx
 * The test-taking screen. All data loading, persistence, timer, and
 * navigation logic lives in useTestAttempt; the QuestionCard is its own
 * component. This file is the layout: header/timer/submit, question area,
 * palette footer, and the report-issue modal.
 */
import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/auth/useAuth'
import { QuestionCard } from './QuestionCard'
import { useTestAttempt } from './useTestAttempt'
import { NAVY, type ViewMode } from './testTypes'

export default function TestShell() {
  const { id: attemptIdParam } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  // Anonymous sessions: after results, route to /login instead of dashboard.
  const isAnonymous = !!(user as any)?.is_anonymous

  const {
    attemptId,
    questions,
    choices,
    responses,
    currentIndex,
    setCurrentIndex,
    loading,
    error,
    timeRemaining,
    submitting,
    submitted,
    score,
    viewMode,
    selectAnswer,
    clearAnswer,
    toggleElimination,
    toggleMarked,
    goTo,
    prevIndex,
    nextIndex,
    switchViewMode,
    handleSubmit,
  } = useTestAttempt(attemptIdParam)

  // ── report issue modal ─────────────────────────────────────────────────
  const [reportState, setReportState] = useState<{
    questionId: string | null
    difficulty: number | null
    quality: number | null
    text: string
    submitting: boolean
    error: string | null
  }>({ questionId: null, difficulty: null, quality: null, text: '', submitting: false, error: null })

  // Ref for the palette scroll container — used to auto-scroll the active button into view.
  const paletteRef = useRef<HTMLDivElement>(null)

  // Auto-scroll the active palette button into view whenever currentIndex changes.
  useEffect(() => {
    if (!paletteRef.current) return
    const activeBtn = paletteRef.current.querySelector<HTMLElement>('[data-palette-active="true"]')
    activeBtn?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }, [currentIndex])

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
