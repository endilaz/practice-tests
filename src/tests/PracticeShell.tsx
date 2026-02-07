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

export default function PracticeShell() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  const [questions, setQuestions] = useState<QuestionWithChoices[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [selectedChoice, setSelectedChoice] = useState<string | null>(null)
  const [showFeedback, setShowFeedback] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [topicName, setTopicName] = useState('')

  useEffect(() => {
    const topicId = searchParams.get('topic')
    const count = searchParams.get('count')

    if (!topicId || !count) {
      setError('Invalid practice configuration.')
      setLoading(false)
      return
    }

    loadPracticeQuestions(topicId, parseInt(count, 10))
  }, [searchParams])

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

      // Get count of available questions first
      const { count: availableCount, error: countError } = await supabase
        .from('questions')
        .select('*', { count: 'exact', head: true })
        .eq('topic_id', topicId)

      if (countError) throw countError

      if (!availableCount || availableCount === 0) {
        throw new Error('No questions available for this topic')
      }

      const actualCount = Math.min(count, availableCount)
      
      // Get random questions from this topic
      const { data: questionsData, error: qError } = await supabase
        .from('questions')
        .select('id, question_text, explanation_text')
        .eq('topic_id', topicId)

      if (qError) throw qError
      if (!questionsData || questionsData.length === 0) {
        throw new Error('No questions available for this topic')
      }

      // Shuffle and take the requested count (or all available if fewer)
      const shuffled = [...questionsData].sort(() => Math.random() - 0.5).slice(0, actualCount)

      // Load choices for all questions
      const questionIds = shuffled.map(q => q.id)
      const { data: choicesData, error: cError } = await supabase
        .from('answer_choices')
        .select('id, question_id, choice_letter, choice_text, is_correct')
        .in('question_id', questionIds)

      if (cError) throw cError

      // Combine and randomize choice order per question
      const combined: QuestionWithChoices[] = shuffled.map(q => {
        const qChoices = (choicesData || []).filter(c => c.question_id === q.id)
        const displayOrder = [...qChoices]
          .sort(() => Math.random() - 0.5)
          .map(c => c.choice_letter)

        return {
          question: q as Question,
          choices: qChoices as AnswerChoice[],
          displayOrder,
        }
      })

      setQuestions(combined)
      
      // Show warning if we got fewer questions than requested
      if (actualCount < count) {
        setError(`Note: Only ${actualCount} questions available (you requested ${count})`)
      }
    } catch (err: any) {
      console.error('Load practice questions error:', err)
      setError(err.message || 'Failed to load practice questions')
    } finally {
      setLoading(false)
    }
  }

  function handleChoiceSelect(choiceId: string) {
    if (showFeedback) return // Already answered

    setSelectedChoice(choiceId)
    setShowFeedback(true)
  }

  function handleNext() {
    if (currentIndex < questions.length - 1) {
      setCurrentIndex(currentIndex + 1)
      setSelectedChoice(null)
      setShowFeedback(false)
    }
  }

  function handlePrevious() {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1)
      setSelectedChoice(null)
      setShowFeedback(false)
    }
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

  if (questions.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-600">No questions available</p>
      </div>
    )
  }

  const current = questions[currentIndex]
  const orderedChoices = current.displayOrder
    .map(letter => current.choices.find(c => c.choice_letter === letter))
    .filter((c): c is AnswerChoice => c !== undefined)

  const selectedChoiceObj = current.choices.find(c => c.id === selectedChoice)
  const correctChoice = current.choices.find(c => c.is_correct)

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
        <div className="bg-white rounded-xl shadow-lg p-8 space-y-6">
          {/* Progress */}
          <div className="text-sm text-gray-600">
            Question {currentIndex + 1} of {questions.length}
          </div>

          {/* Question Text */}
          <div>
            <h2 className="text-xl font-semibold text-gray-900">
              {current.question.question_text}
            </h2>
          </div>

          {/* Answer Choices */}
          <div className="space-y-3">
            {orderedChoices.map((choice, idx) => {
              const isSelected = choice.id === selectedChoice
              const isCorrect = choice.is_correct
              const showAsCorrect = showFeedback && isCorrect
              const showAsWrong = showFeedback && isSelected && !isCorrect

              let bgColor = 'bg-white'
              let borderColor = 'border-gray-300'
              let textColor = 'text-gray-900'
              let cursor = 'cursor-pointer'

              if (showFeedback) {
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
                  disabled={showFeedback}
                  className={`w-full text-left p-4 rounded-lg border-2 transition-colors ${bgColor} ${borderColor} ${cursor} hover:bg-blue-50 disabled:hover:${bgColor}`}
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

          {/* Feedback */}
          {showFeedback && (
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
                    : `✗ Incorrect. The correct answer is ${correctChoice?.choice_letter}.`}
                </p>
              </div>

              {/* Explanation */}
              {current.question.explanation_text && (
                <div className="bg-blue-50 border-l-4 border-blue-500 p-4 rounded">
                  <p className="text-sm font-semibold text-blue-900 mb-1">Explanation:</p>
                  <p className="text-sm text-blue-800">{current.question.explanation_text}</p>
                </div>
              )}
            </div>
          )}

          {/* Navigation */}
          <div className="flex justify-between items-center pt-4 border-t">
            <button
              type="button"
              onClick={handlePrevious}
              disabled={currentIndex === 0}
              className="bg-gray-600 text-white px-4 py-2 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-700 transition-colors"
            >
              ← Previous
            </button>

            {currentIndex < questions.length - 1 ? (
              <button
                type="button"
                onClick={handleNext}
                disabled={!showFeedback}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-700 transition-colors"
              >
                Next Question →
              </button>
            ) : (
              <button
                type="button"
                onClick={handleExit}
                className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors"
              >
                Finish Practice
              </button>
            )}
          </div>
        </div>

        {/* Question Palette */}
        <div className="mt-6 bg-white rounded-xl shadow-lg p-4">
          <p className="text-sm font-medium text-gray-700 mb-3">Questions:</p>
          <div className="flex flex-wrap gap-2">
            {questions.map((_, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => {
                  setCurrentIndex(idx)
                  setSelectedChoice(null)
                  setShowFeedback(false)
                }}
                className={`w-10 h-10 rounded font-medium transition-colors ${
                  idx === currentIndex
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                {idx + 1}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}