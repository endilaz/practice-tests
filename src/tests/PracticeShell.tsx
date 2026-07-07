import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'

type Question = {
  id: string
  question_text: string
  explanation_text: string | null
}

type AnswerChoice = {
  id: string
  question_id: string
  choice_letter: 'A' | 'B' | 'C' | 'D'
  choice_text: string
  is_correct: boolean
}

type QuestionWithChoices = {
  question: Question
  choices: AnswerChoice[]
  displayOrder: string[] // Randomized order of choice letters
}

const DISPLAY_LABELS = ['A', 'B', 'C', 'D'] as const

// Fisher-Yates — sort(() => Math.random() - 0.5) is biased and can leave
// items near their original positions far more often than chance.
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export default function PracticeShell() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  const [questionPool, setQuestionPool] = useState<QuestionWithChoices[]>([]) // All available questions
  const [currentQuestion, setCurrentQuestion] = useState<QuestionWithChoices | null>(null)
  const [questionIndex, setQuestionIndex] = useState(0) // Track progress in infinite mode
  const [selectedChoice, setSelectedChoice] = useState<string | null>(null)
  const [isSubmitted, setIsSubmitted] = useState(false)
  const [correctCount, setCorrectCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [topicName, setTopicName] = useState('')
  const [isInfinite, setIsInfinite] = useState(false)

  useEffect(() => {
    const topic = searchParams.get('topic')
    const count = searchParams.get('count')

    if (!topic || !count) {
      setError('Invalid practice configuration.')
      setLoading(false)
      return
    }

    const questionCount = parseInt(count, 10)
    setIsInfinite(questionCount === 0)
    loadPracticeQuestions(topic, questionCount)
  }, [searchParams])

  // Set current question when pool loads or index changes
  useEffect(() => {
    if (questionPool.length > 0) {
      const poolIndex = questionIndex % questionPool.length
      setCurrentQuestion(questionPool[poolIndex])
    }
  }, [questionPool, questionIndex])

  async function loadPracticeQuestions(topicId: string, count: number) {
    setLoading(true)
    setError(null)

    try {
      // Get topic name
      const { data: topic } = await supabase
        .from('topics')
        .select('name')
        .eq('id', topicId)
        .single()

      if (topic) setTopicName(topic.name)

      // Get all questions from this topic
      const { data: questionsData, error: qError } = await supabase
        .from('questions')
        .select('id, question_text, explanation_text')
        .eq('topic_id', topicId)

      if (qError) throw qError
      if (!questionsData || questionsData.length === 0) {
        throw new Error('No questions available for this topic')
      }

      // Load choices for all questions
      const questionIds = questionsData.map(q => q.id)
      const { data: choicesData, error: cError } = await supabase
        .from('answer_choices')
        .select('id, question_id, choice_letter, choice_text, is_correct')
        .in('question_id', questionIds)

      if (cError) throw cError

      // Combine and randomize choice order per question
      const combined: QuestionWithChoices[] = questionsData.map(q => {
        const qChoices = (choicesData || []).filter(c => c.question_id === q.id)
        const displayOrder = shuffle(qChoices).map(c => c.choice_letter)

        return {
          question: q as Question,
          choices: qChoices as AnswerChoice[],
          displayOrder,
        }
      })

      // Shuffle the pool, then cap it at the requested count in finite mode
      // (count = 0 means infinite: cycle through the whole topic).
      const shuffled = shuffle(combined)
      setQuestionPool(count > 0 ? shuffled.slice(0, count) : shuffled)

      // Non-blocking notice if finite mode and fewer questions than requested.
      // Must NOT go through setError — that renders the full error screen and
      // would lock the student out of practicing with the smaller pool.
      if (count > 0 && shuffled.length < count) {
        setNotice(`Only ${shuffled.length} questions available (you requested ${count}).`)
      }
    } catch (err: any) {
      console.error('Load practice questions error:', err)
      setError(err.message || 'Failed to load practice questions')
    } finally {
      setLoading(false)
    }
  }

  function handleChoiceSelect(choiceId: string) {
    if (isSubmitted) return // Already submitted
    setSelectedChoice(choiceId)
  }

  function handleSubmit() {
    if (!selectedChoice || isSubmitted) return
    const choice = currentQuestion?.choices.find(c => c.id === selectedChoice)
    if (choice?.is_correct) setCorrectCount(n => n + 1)
    setIsSubmitted(true)
  }

  function handleNext() {
    setQuestionIndex(questionIndex + 1)
    setSelectedChoice(null)
    setIsSubmitted(false)
  }

  function handleRestart() {
    setQuestionPool(prev => shuffle(prev))
    setQuestionIndex(0)
    setCorrectCount(0)
    setSelectedChoice(null)
    setIsSubmitted(false)
  }

  function handleExit() {
    navigate('/')
  }

  // Loading screen
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-lg text-gray-600">Loading practice questions...</p>
      </div>
    )
  }

  // Error screen
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white p-8 rounded-xl shadow max-w-md">
          <h2 className="text-xl font-bold text-red-600 mb-4">Error</h2>
          <p className="text-gray-700">{error}</p>
          <button
            type="button"
            onClick={handleExit}
            className="mt-4 bg-blue-600 text-white px-4 py-2 rounded-lg"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    )
  }

  if (questionPool.length === 0 || !currentQuestion) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-600">No questions available</p>
      </div>
    )
  }

  // Finite mode: past the last question — show the summary screen
  if (!isInfinite && questionIndex >= questionPool.length) {
    const pct = Math.round((correctCount / questionPool.length) * 100)
    return (
      <div className="min-h-screen bg-blue-600 flex items-center justify-center px-4">
        <div className="bg-white rounded-xl shadow-lg p-8 max-w-md w-full text-center space-y-6">
          <h2 className="text-2xl font-bold text-gray-900">Practice Complete!</h2>
          <p className="text-gray-600">{topicName}</p>
          <div className="py-4">
            <p className="text-5xl font-bold text-blue-600">{pct}%</p>
            <p className="text-gray-600 mt-2">
              {correctCount} of {questionPool.length} correct
            </p>
          </div>
          <div className="flex gap-3 justify-center">
            <button
              type="button"
              onClick={handleRestart}
              className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors font-medium"
            >
              Practice Again
            </button>
            <button
              type="button"
              onClick={handleExit}
              className="bg-gray-600 text-white px-6 py-3 rounded-lg hover:bg-gray-700 transition-colors font-medium"
            >
              Back to Dashboard
            </button>
          </div>
        </div>
      </div>
    )
  }

  const orderedChoices = currentQuestion.displayOrder
    .map(letter => currentQuestion.choices.find(c => c.choice_letter === letter))
    .filter((c): c is AnswerChoice => c !== undefined)

  const selectedChoiceObj = currentQuestion.choices.find(c => c.id === selectedChoice)

  return (
    <div className="min-h-screen bg-blue-600">
      {/* Header */}
      <div className="bg-white border-b shadow-sm">
        <div className="max-w-4xl mx-auto px-4 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-lg font-bold text-gray-900">Practice Mode</h1>
            <p className="text-sm text-gray-600">{topicName}</p>
          </div>
          <button
            type="button"
            onClick={handleExit}
            className="bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-700 transition-colors"
          >
            Exit Practice
          </button>
        </div>
      </div>

      {/* Question Card */}
      <div className="max-w-4xl mx-auto px-4 py-8">
        {notice && (
          <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
            {notice}
          </div>
        )}
        <div className="bg-white rounded-xl shadow-lg p-8 space-y-6">
          {/* Progress */}
          <div className="text-sm text-gray-600">
            {isInfinite ? (
              `Question ${questionIndex + 1} (Infinite mode)`
            ) : (
              `Question ${questionIndex + 1} of ${questionPool.length}`
            )}
          </div>

          {/* Question Text */}
          <div>
            <h2 className="text-xl font-semibold text-gray-900">
              {currentQuestion.question.question_text}
            </h2>
          </div>

          {/* Answer Choices */}
          <div className="space-y-3">
            {orderedChoices.map((choice, idx) => {
              const isSelected = choice.id === selectedChoice
              const isCorrect = choice.is_correct
              const showAsCorrect = isSubmitted && isCorrect
              const showAsWrong = isSubmitted && isSelected && !isCorrect

              let bgColor = 'bg-white'
              let borderColor = 'border-gray-300'
              let textColor = 'text-gray-900'
              let cursor = 'cursor-pointer'

              if (isSubmitted) {
                cursor = 'cursor-default'
              }

              if (showAsCorrect) {
                bgColor = 'bg-green-50'
                borderColor = 'border-green-500'
                textColor = 'text-green-900'
              } else if (showAsWrong) {
                bgColor = 'bg-red-50'
                borderColor = 'border-red-500'
                textColor = 'text-red-900'
              } else if (isSelected) {
                bgColor = 'bg-blue-50'
                borderColor = 'border-blue-500'
              }

              return (
                <button
                  key={choice.id}
                  type="button"
                  onClick={() => handleChoiceSelect(choice.id)}
                  disabled={isSubmitted}
                  className={`w-full text-left p-4 rounded-lg border-2 transition-colors ${bgColor} ${borderColor} ${cursor} ${!isSubmitted ? 'hover:bg-blue-50' : ''}`}
                >
                  <div className="flex items-start gap-3">
                    <span className={`font-bold ${textColor} min-w-[24px]`}>
                      {DISPLAY_LABELS[idx]}.
                    </span>
                    <span className={`flex-1 ${textColor}`}>{choice.choice_text}</span>
                    {showAsCorrect && (
                      <span className="text-green-600 font-bold">✓ Correct</span>
                    )}
                    {showAsWrong && (
                      <span className="text-red-600 font-bold">✗ Wrong</span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>

          {/* Submit Button (before feedback) */}
          {!isSubmitted && selectedChoice && (
            <div className="pt-4 border-t">
              <button
                type="button"
                onClick={handleSubmit}
                className="w-full bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors font-medium"
              >
                Submit Answer
              </button>
            </div>
          )}

          {/* Feedback (after submit) */}
          {isSubmitted && (
            <div className="space-y-4 pt-4 border-t">
              {/* Result message */}
              <div
                className={`p-4 rounded-lg ${
                  selectedChoiceObj?.is_correct
                    ? 'bg-green-50 border border-green-200'
                    : 'bg-red-50 border border-red-200'
                }`}
              >
                <p
                  className={`font-semibold ${
                    selectedChoiceObj?.is_correct ? 'text-green-800' : 'text-red-800'
                  }`}
                >
                  {selectedChoiceObj?.is_correct
                    ? '✓ Correct!'
                    : `✗ Incorrect. The correct answer is highlighted.`}
                </p>
              </div>

              {/* Explanation */}
              {currentQuestion.question.explanation_text && (
                <div className="bg-blue-50 border-l-4 border-blue-500 p-4 rounded">
                  <p className="text-sm font-semibold text-blue-900 mb-1">Explanation:</p>
                  <p className="text-sm text-blue-800">{currentQuestion.question.explanation_text}</p>
                </div>
              )}
            </div>
          )}

          {/* Navigation */}
          <div className="flex justify-end items-center pt-4 border-t">
            <button
              type="button"
              onClick={handleNext}
              disabled={!isSubmitted}
              className="bg-blue-600 text-white px-6 py-3 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-700 transition-colors font-medium"
            >
              {!isInfinite && questionIndex === questionPool.length - 1
                ? 'Finish →'
                : 'Next Question →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}