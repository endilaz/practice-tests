import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/auth/useAuth'

// Types matching database schema
type TestAttempt = {
  id: string
  user_id: string
  score: number
  total_possible: number
  total_time_seconds: number
  completed_at: string
  topics: { name: string }
}

type QuestionResponse = {
  question_id: string
  selected_choice_id: string | null
  is_correct: boolean | null
  displayed_choices_order: string[]
}

type Question = {
  id: string
  question_text: string
  explanation_text: string | null
  is_ai_generated: boolean
}

type AnswerChoice = {
  id: string
  question_id: string
  choice_letter: 'A' | 'B' | 'C' | 'D'
  choice_text: string
  is_correct: boolean
}

type QuestionWithData = {
  question: Question
  response: QuestionResponse
  choices: AnswerChoice[]
}

const DISPLAY_LABELS = ['A', 'B', 'C', 'D'] as const

export default function Results() {
  const { id: attemptId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user, loading: authLoading } = useAuth()
  const isAnonymous = !!(user as any)?.is_anonymous

  const [attempt, setAttempt] = useState<TestAttempt | null>(null)
  const [questionsData, setQuestionsData] = useState<QuestionWithData[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Wait for auth to load before checking
    if (authLoading) return

    if (!attemptId || !user) {
      setError('Invalid attempt or not authenticated')
      setLoading(false)
      return
    }

    loadResults()
  }, [attemptId, user, authLoading])

  async function loadResults() {
    if (!attemptId || !user) return

    setLoading(true)
    setError(null)

    try {
      // 1. Load attempt metadata with RLS check
      const { data: attemptData, error: attemptError } = await supabase
        .from('test_attempts')
        .select('id, user_id, score, total_possible, total_time_seconds, completed_at, topics!inner(name)')
        .eq('id', attemptId)
        .single()

      if (attemptError) throw new Error('Test attempt not found')
      if (!attemptData) throw new Error('Test attempt not found')

      // Security: Verify ownership (RLS should handle this but double-check)
      if (attemptData.user_id !== user.id) {
        throw new Error('Unauthorized: This is not your test')
      }

      // Verify test is completed
      if (!attemptData.completed_at) {
        navigate(`/test/${attemptId}`)
        return
      }

      // Cast via unknown: supabase-js infers the to-one topics embed as an
      // array without generated DB types; PostgREST returns an object.
      setAttempt(attemptData as unknown as TestAttempt)

      // 2. Load attempt_questions to get position ordering
      const { data: attemptQuestionsData, error: aqError } = await supabase
        .from('attempt_questions')
        .select('question_id, position')
        .eq('attempt_id', attemptId)
        .order('position')

      if (aqError) throw aqError
      if (!attemptQuestionsData || attemptQuestionsData.length === 0) {
        throw new Error('No questions found for this test')
      }

      // 3. Load question responses
      const { data: responsesData, error: responsesError } = await supabase
        .from('question_responses')
        .select('question_id, selected_choice_id, is_correct, displayed_choices_order')
        .eq('attempt_id', attemptId)

      if (responsesError) throw responsesError
      if (!responsesData || responsesData.length === 0) {
        throw new Error('No responses found for this test')
      }

      // 4. Merge position data with responses
      const responsesWithPosition = attemptQuestionsData.map(aq => {
        const response = responsesData.find(r => r.question_id === aq.question_id)
        if (!response) {
          throw new Error(`Response not found for question ${aq.question_id}`)
        }
        return {
          ...response,
          position: aq.position,
        }
      })

      // Already sorted by position from the .order('position') above

      // 5. Load questions
      const questionIds = responsesWithPosition.map(r => r.question_id)
      const { data: questionsData, error: questionsError } = await supabase
        .from('questions')
        .select('id, question_text, explanation_text, is_ai_generated')
        .in('id', questionIds)

      if (questionsError) throw questionsError

      // 6. Load all answer choices for these questions
      const { data: choicesData, error: choicesError } = await supabase
        .from('answer_choices')
        .select('id, question_id, choice_letter, choice_text, is_correct')
        .in('question_id', questionIds)

      if (choicesError) throw choicesError

      // 7. Combine data into structured format (already in position order)
      const combined: QuestionWithData[] = responsesWithPosition.map((response: any) => {
        const question = questionsData?.find(q => q.id === response.question_id)
        const choices = choicesData?.filter(c => c.question_id === response.question_id) || []

        if (!question) {
          throw new Error(`Question ${response.question_id} not found`)
        }

        return {
          question: question as Question,
          response: {
            question_id: response.question_id,
            selected_choice_id: response.selected_choice_id,
            is_correct: response.is_correct,
            displayed_choices_order: response.displayed_choices_order,
          } as QuestionResponse,
          choices: choices as AnswerChoice[],
        }
      })

      setQuestionsData(combined)
    } catch (err: any) {
      console.error('Load results error:', err)
      setError(err.message || 'Failed to load results')
    } finally {
      setLoading(false)
    }
  }

  // Helper: Format time in MM:SS
  function formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  // Helper: Order choices by displayed_choices_order
  function orderChoices(response: QuestionResponse, choices: AnswerChoice[]): AnswerChoice[] {
    if (!response.displayed_choices_order || response.displayed_choices_order.length === 0) {
      // Fallback: sort by choice_letter A,B,C,D
      return [...choices].sort((a, b) => a.choice_letter.localeCompare(b.choice_letter))
    }

    return response.displayed_choices_order
      .map(letter => choices.find(c => c.choice_letter === letter))
      .filter((c): c is AnswerChoice => c !== undefined)
  }

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-lg text-gray-600">Loading results...</p>
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white p-8 rounded-xl shadow max-w-md">
          <h2 className="text-xl font-bold text-red-600 mb-4">Error</h2>
          <p className="text-gray-700">{error}</p>
          <button
            type="button"
            onClick={() => navigate(isAnonymous ? '/login' : '/')}
            className="mt-4 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
          >
            {isAnonymous ? 'Back to Login' : 'Back to Dashboard'}
          </button>
        </div>
      </div>
    )
  }

  // No attempt loaded
  if (!attempt) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-600">No test results found.</p>
      </div>
    )
  }

  // Calculate percentage safely (avoid division by zero)
  const percentage = attempt.total_possible > 0 
    ? Math.round((attempt.score / attempt.total_possible) * 100) 
    : 0

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        {/* Header */}
        <div className="flex justify-between items-center">
          <h1 className="text-3xl font-bold text-gray-900">Test Results</h1>
          <button
            type="button"
            onClick={() => navigate(isAnonymous ? '/login' : '/')}
            className="bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-700 transition-colors"
          >
            {isAnonymous ? 'Back to Login' : 'Back to Dashboard'}
          </button>
        </div>

        {/* Summary Card */}
        <div className="bg-white rounded-xl shadow-lg p-8">
          <div className="text-center space-y-4">
            <h2 className="text-2xl font-bold text-gray-900">{attempt.topics.name}</h2>
            
            {/* Score */}
            <div className="space-y-2">
              <p className="text-6xl font-bold text-blue-600">
                {attempt.score} / {attempt.total_possible}
              </p>
              <p className="text-2xl text-gray-600">{percentage}%</p>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-4 pt-4 max-w-md mx-auto">
              <div className="text-center p-4 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-600">Time Taken</p>
                <p className="text-lg font-semibold text-gray-900">
                  {formatTime(attempt.total_time_seconds)}
                </p>
              </div>
              <div className="text-center p-4 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-600">Completed</p>
                <p className="text-lg font-semibold text-gray-900">
                  {new Date(attempt.completed_at).toLocaleDateString()}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Questions Review */}
        <div className="space-y-6">
          <h2 className="text-2xl font-bold text-gray-900">Question Breakdown</h2>

          {questionsData.map((item, index) => {
            const orderedChoices = orderChoices(item.response, item.choices)

            return (
              <div key={item.question.id} className="bg-white rounded-xl shadow-lg p-6 space-y-4">
                {/* Question Header */}
                <div className="flex items-start justify-between border-b pb-4">
                  <div className="flex-1">
                    <p className="text-sm text-gray-500 mb-2 flex items-center gap-2">
                      Question {index + 1}
                      {item.question.is_ai_generated && (
                        <span
                          className="text-[10px] font-semibold uppercase tracking-wider bg-indigo-100 text-indigo-700 border border-indigo-200 rounded px-1.5 py-0.5"
                          title="This question was generated by AI"
                        >
                          AI
                        </span>
                      )}
                    </p>
                    <h3 className="text-lg font-semibold text-gray-900">
                      {item.question.question_text}
                    </h3>
                  </div>
                  {/* Result indicator */}
                  <div className="ml-4">
                    {item.response.is_correct === true && (
                      <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-800">
                        ✓ Correct
                      </span>
                    )}
                    {item.response.is_correct === false && (
                      <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-red-100 text-red-800">
                        ✗ Incorrect
                      </span>
                    )}
                    {item.response.is_correct === null && (
                      <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-gray-100 text-gray-800">
                        — Unanswered
                      </span>
                    )}
                  </div>
                </div>

                {/* Answer Choices */}
                <div className="space-y-2">
                  {orderedChoices.map((choice, idx) => {
                    const isUserAnswer = choice.id === item.response.selected_choice_id
                    const isCorrectAnswer = choice.is_correct

                    // Determine styling
                    let bgColor = 'bg-white'
                    let borderColor = 'border-gray-300'
                    let textColor = 'text-gray-900'

                    if (isCorrectAnswer) {
                      bgColor = 'bg-green-50'
                      borderColor = 'border-green-500'
                      textColor = 'text-green-900'
                    } else if (isUserAnswer && !isCorrectAnswer) {
                      bgColor = 'bg-red-50'
                      borderColor = 'border-red-500'
                      textColor = 'text-red-900'
                    }

                    return (
                      <div
                        key={choice.id}
                        className={`flex items-start gap-2 p-3 rounded-lg border-2 ${bgColor} ${borderColor}`}
                      >
                        <span className={`font-bold text-sm ${textColor} w-6`}>
                          {DISPLAY_LABELS[idx]}.
                        </span>
                        <span className={`flex-1 text-sm ${textColor}`}>
                          {choice.choice_text}
                        </span>
                        {isUserAnswer && (
                          <span className="text-xs font-medium text-gray-600">Your Answer</span>
                        )}
                        {isCorrectAnswer && (
                          <span className="text-xs font-medium text-green-600">✓ Correct</span>
                        )}
                      </div>
                    )
                  })}
                </div>

                {/* Explanation */}
                {item.question.explanation_text && (
                  <div className="bg-blue-50 border-l-4 border-blue-500 p-4 rounded">
                    <p className="text-sm font-semibold text-blue-900 mb-1">Explanation:</p>
                    <p className="text-sm text-blue-800">{item.question.explanation_text}</p>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Bottom Navigation */}
        <div className="flex justify-center pb-8">
          <button
            type="button"
            onClick={() => navigate(isAnonymous ? '/login' : '/')}
            className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors font-medium"
          >
            {isAnonymous ? 'Back to Login' : 'Back to Dashboard'}
          </button>
        </div>
      </div>
    </div>
  )
}