/*
 * useTestAttempt.ts
 * All data loading, persistence, timer, and navigation state for a test
 * attempt — extracted verbatim from TestShell.tsx so the shell is pure render.
 *
 * Persistence strategy (unchanged):
 *   - selectAnswer / clearAnswer write to the DB immediately (fast path)
 *   - doSave() bulk-flushes every response row — called by the 30-second
 *     autosave interval and as a final flush inside handleSubmit
 *   - responsesRef / currentIndexRef mirror state into refs so interval and
 *     event-listener callbacks always read current values without stale
 *     closures (and without effect dep arrays that would reset the interval)
 */
import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { AnswerChoice, Question, ResponseRow, ViewMode } from './testTypes'

export function useTestAttempt(attemptIdParam: string | undefined) {
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
        .select('question_id, position, questions(id, question_text, is_ai_generated)')
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
        is_ai_generated: r.questions.is_ai_generated ?? false,
      })))
      setChoices(choiceRows as AnswerChoice[])
      // Cast via unknown: supabase-js cannot statically parse this select
      // string, so it falls back to an error type.
      setResponses(respRows as unknown as ResponseRow[])
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

  return {
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
  }
}
