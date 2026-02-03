import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useGenerateTest } from './useGenerateTest'

type Question = {
  id: string
  question_text: string
  position: number
}

type AnswerChoice = {
  id: string
  question_id: string
  choice_letter: string
  choice_text: string
}

type Response = {
  question_id: string
  selected_choice_id: string | null
  displayed_choices_order: string[] // e.g. ["C", "A", "D", "B"]
}

export default function TestShell() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { generateTest, loading: generating, error: generateError } = useGenerateTest()

  const [attemptId, setAttemptId] = useState<string | null>(null)
  const [questions, setQuestions] = useState<Question[]>([])
  const [choices, setChoices] = useState<AnswerChoice[]>([])
  const [responses, setResponses] = useState<Response[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Timer state
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null) // seconds, null = no timer
  const [timerActive, setTimerActive] = useState(false)

  // Submit state
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [score, setScore] = useState<{ score: number; total: number } | null>(null)

  // Generate test on mount
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

    const questionCount = parseInt(count, 10)
    const timerMinutes = timerEnabled && minutes ? parseInt(minutes, 10) : 0

    generateTest({
      topicId,
      questionCount,
      useTimer: timerEnabled,
      minutes: timerMinutes,
    }).then(id => {
      if (id) {
        setAttemptId(id)
        if (timerEnabled && timerMinutes > 0) {
          setTimeRemaining(timerMinutes * 60)
        }
      } else {
        setLoading(false)
      }
    })
  }, [searchParams])

  // Load test data after generation
  useEffect(() => {
    if (!attemptId) return

    async function loadTest() {
      setLoading(true)
      setError(null)

      // 1. Mark test as started (set started_at only if not already set)
      const { data: attemptData } = await supabase
        .from('test_attempts')
        .select('started_at')
        .eq('id', attemptId)
        .single()

      if (!attemptData?.started_at) {
        const { error: updateError } = await supabase
          .from('test_attempts')
          .update({ started_at: new Date().toISOString() })
          .eq('id', attemptId)

        if (updateError) {
          setError('Failed to start test.')
          setLoading(false)
          return
        }
      }

      // 2. Load questions for this attempt (with position for ordering)
      const { data: questionsData, error: questionsError } = await supabase
        .from('attempt_questions')
        .select('question_id, position, questions(id, question_text)')
        .eq('attempt_id', attemptId)
        .order('position')

      if (questionsError) {
        setError('Failed to load questions.')
        setLoading(false)
        return
      }

      // 3. Load all answer choices for these questions
      const questionIds = questionsData.map((q: any) => q.question_id)
      const { data: choicesData, error: choicesError } = await supabase
        .from('answer_choices')
        .select('id, question_id, choice_letter, choice_text')
        .in('question_id', questionIds)

      if (choicesError) {
        setError('Failed to load answer choices.')
        setLoading(false)
        return
      }

      // 4. Load existing responses (for display order and any saved answers)
      const { data: responsesData, error: responsesError } = await supabase
        .from('question_responses')
        .select('question_id, selected_choice_id, displayed_choices_order')
        .eq('attempt_id', attemptId)

      if (responsesError) {
        setError('Failed to load responses.')
        setLoading(false)
        return
      }

      // 5. Build state
      const loadedQuestions: Question[] = questionsData.map((q: any) => ({
        id: q.questions.id,
        question_text: q.questions.question_text,
        position: q.position,
      }))

      setQuestions(loadedQuestions)
      setChoices(choicesData as AnswerChoice[])
      setResponses(responsesData as Response[])
      setLoading(false)

      // 6. Start timer if enabled
      if (timeRemaining !== null) {
        setTimerActive(true)
      }
    }

    loadTest()
  }, [attemptId])

  // Timer countdown
  useEffect(() => {
    if (!timerActive || timeRemaining === null || submitted) return

    if (timeRemaining <= 0) {
      // Time's up — auto-submit
      handleSubmit()
      return
    }

    const interval = setInterval(() => {
      setTimeRemaining(prev => (prev !== null && prev > 0 ? prev - 1 : 0))
    }, 1000)

    return () => clearInterval(interval)
  }, [timerActive, timeRemaining, submitted])

  // Current question
  const currentQuestion = questions[currentIndex]
  const currentResponse = responses.find(r => r.question_id === currentQuestion?.id)
  const currentChoices = currentQuestion
    ? choices.filter(c => c.question_id === currentQuestion.id)
    : []

  // Sort choices by displayed_choices_order
  const orderedChoices = currentResponse
    ? currentResponse.displayed_choices_order
        .map(letter => currentChoices.find(c => c.choice_letter === letter))
        .filter(Boolean) as AnswerChoice[]
    : currentChoices

  async function selectAnswer(choiceId: string) {
    if (!attemptId || !currentQuestion || submitting || submitted) return

    // Optimistic update
    setResponses(prev =>
      prev.map(r =>
        r.question_id === currentQuestion.id
          ? { ...r, selected_choice_id: choiceId }
          : r
      )
    )

    // Persist to database
    const { error } = await supabase
      .from('question_responses')
      .update({ selected_choice_id: choiceId })
      .eq('attempt_id', attemptId)
      .eq('question_id', currentQuestion.id)

    if (error) {
      console.error('Failed to save answer:', error)
      // Revert optimistic update on error
      setResponses(prev =>
        prev.map(r =>
          r.question_id === currentQuestion.id
            ? { ...r, selected_choice_id: currentResponse?.selected_choice_id ?? null }
            : r
        )
      )
    }
  }

  function goToPrevious() {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1)
    }
  }

  function goToNext() {
    if (currentIndex < questions.length - 1) {
      setCurrentIndex(currentIndex + 1)
    }
  }

  async function handleSubmit() {
    if (!attemptId || submitting || submitted) return

    const confirmed = window.confirm(
      'Are you sure you want to submit? You cannot change your answers after submitting.'
    )
    if (!confirmed) return

    setSubmitting(true)
    setTimerActive(false) // Stop timer

    const { data, error } = await supabase.rpc('submit_test', {
      p_attempt_id: attemptId,
    })

    if (error) {
      setError(`Failed to submit test: ${error.message}`)
      setSubmitting(false)
      return
    }

    setScore(data as { score: number; total: number })
    setSubmitted(true)
    setSubmitting(false)
  }

  // Format timer display
  function formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  function getTimerColor(): string {
    if (timeRemaining === null) return 'text-gray-700'
    if (timeRemaining < 60) return 'text-red-600 font-bold'
    if (timeRemaining < 300) return 'text-yellow-600 font-semibold'
    return 'text-gray-700'
  }

  // Loading states
  if (generating || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-lg text-gray-600">
          {generating ? 'Generating test...' : 'Loading questions...'}
        </p>
      </div>
    )
  }

  if (generateError || error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white p-8 rounded shadow max-w-md">
          <h2 className="text-xl font-bold text-red-600 mb-4">Error</h2>
          <p className="text-gray-700">{generateError || error}</p>
          <button
            onClick={() => navigate('/')}
            className="mt-4 bg-blue-600 text-white px-4 py-2 rounded"
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
        <div className="bg-white p-8 rounded shadow max-w-md text-center space-y-4">
          <h2 className="text-2xl font-bold">Test Complete!</h2>
          <p className="text-4xl font-bold text-blue-600">
            {score.score} / {score.total}
          </p>
          <p className="text-lg text-gray-600">
            {Math.round((score.score / score.total) * 100)}%
          </p>
          <button
            onClick={() => navigate('/')}
            className="bg-blue-600 text-white px-6 py-2 rounded"
          >
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

  return (
    <div className="min-h-screen bg-blue-600 flex flex-col">
      {/* Header */}
      <header className="bg-white shadow px-6 py-4 flex justify-between items-center">
        <h1 className="text-lg font-semibold">Practice Test</h1>
        <div className="flex items-center gap-6">
          {timeRemaining !== null && (
            <span className={`text-lg ${getTimerColor()}`}>
              {formatTime(timeRemaining)}
            </span>
          )}
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="bg-green-600 text-white px-4 py-2 rounded disabled:opacity-50"
          >
            {submitting ? 'Submitting...' : 'Submit Test'}
          </button>
        </div>
      </header>

      {/* Question Card */}
      <main className="flex-1 flex items-center justify-center p-6">
        <div className="bg-white rounded shadow-lg max-w-2xl w-full p-8 space-y-6">
          <p className="text-sm text-gray-600">
            Question {currentIndex + 1} of {questions.length}
          </p>

          <h2 className="text-xl font-bold">{currentQuestion.question_text}</h2>

          <div className="space-y-3">
            {orderedChoices.map(choice => (
              <button
                key={choice.id}
                onClick={() => selectAnswer(choice.id)}
                className={`w-full text-left px-4 py-3 rounded border-2 transition-colors ${
                  currentResponse?.selected_choice_id === choice.id
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-900 border-gray-300 hover:bg-blue-50'
                }`}
              >
                <span className="font-semibold">{choice.choice_letter}.</span>{' '}
                {choice.choice_text}
              </button>
            ))}
          </div>

          {/* Navigation */}
          <div className="flex justify-between pt-4">
            <button
              onClick={goToPrevious}
              disabled={currentIndex === 0}
              className="px-4 py-2 border rounded disabled:opacity-30"
            >
              Previous
            </button>
            <button
              onClick={goToNext}
              disabled={currentIndex === questions.length - 1}
              className="px-4 py-2 border rounded disabled:opacity-30"
            >
              Next
            </button>
          </div>
        </div>
      </main>
    </div>
  )
}