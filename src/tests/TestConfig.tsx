import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useNavigate } from 'react-router-dom'
import { testConfigSchema } from './test.schema'
import { useAuth } from '@/auth/useAuth'

type Topic = {
  id: string
  name: string
}

export function TestConfigForm() {
  const { role, loading: authLoading } = useAuth()

  const [topics, setTopics] = useState<Topic[]>([])
  const [topicId, setTopicId] = useState('')
  const [questionCount, setQuestionCount] = useState('25')
  const [useTimer, setUseTimer] = useState(false)
  const [minutes, setMinutes] = useState('30')
  const [practiceMode, setPracticeMode] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [availableQuestions, setAvailableQuestions] = useState<number>(0)

  const navigate = useNavigate()

  // Wait for auth to settle before loading topics so the role-based
  // [DEBUG] filter has the correct value on first load.
  useEffect(() => {
    if (!authLoading) loadTopics()
  }, [authLoading])

  // Fetch available question count when topic changes
  useEffect(() => {
    if (topicId) {
      fetchAvailableQuestions()
    } else {
      setAvailableQuestions(0)
    }
  }, [topicId])

  async function loadTopics() {
    const { data, error } = await supabase
      .from('topics')
      .select('id, name')
      .order('name')

    if (error) {
      setError(error.message)
    } else {
      // Hide [DEBUG] topics from non-admins (client-side cosmetic filter;
      // no security boundary — RLS already allows all authenticated users
      // to read topics, so this only affects what appears in the selector).
      const filtered =
        role !== null && role === 'admin'
          ? data
          : data.filter(t => !t.name.startsWith('[DEBUG]'))
      setTopics(filtered)
    }
    setLoading(false)
  }

  async function fetchAvailableQuestions() {
    if (!topicId) return

    const { count, error } = await supabase
      .from('questions')
      .select('id', { count: 'exact', head: true })
      .eq('topic_id', topicId)

    if (error) {
      console.error('Failed to fetch question count:', error)
    } else {
      setAvailableQuestions(count ?? 0)
    }
  }

  function handleQuestionCountChange(value: string) {
    // Allow empty string, digits, or "0" for infinite mode
    if (value === '' || /^\d+$/.test(value)) {
      setQuestionCount(value)
      setError(null)
    }
  }

  async function submit() {
    if (submitting) return
    setError(null)

    // Parse question count
    const count = questionCount === '' ? 0 : Number(questionCount)

    // Validate infinite mode is only for practice
    if (count === 0 && !practiceMode) {
      setError('Infinite questions is only available in Practice Mode.')
      return
    }

    // Check available questions (only for non-infinite mode)
    if (count > 0 && count > availableQuestions) {
      setError(`Only ${availableQuestions} question${availableQuestions !== 1 ? 's' : ''} available in this topic`)
      return
    }

    const parsed = testConfigSchema.safeParse({
      topicId,
      questionCount: count === 0 ? 1 : count, // Use 1 for validation, actual infinite handled later
      useTimer,
      minutes: useTimer ? Number(minutes) : undefined,
    })

    if (!parsed.success) {
      const first = parsed.error.issues[0]
      setError(first?.message ?? 'Invalid test configuration.')
      return
    }

    setSubmitting(true)

    // Practice mode: navigate with query params (no test_attempts record)
    if (practiceMode) {
      const params = new URLSearchParams({
        mode: 'practice',
        topic: parsed.data.topicId,
        count: String(count), // Pass 0 for infinite
      })
      navigate(`/practice?${params.toString()}`)
      return
    }

    // Normal test mode: generate test and navigate with attemptId
    const { data, error: rpcError } = await supabase.rpc('generate_test', {
      p_topic_id: parsed.data.topicId,
      p_question_count: parsed.data.questionCount,
      p_use_timer: parsed.data.useTimer,
      p_minutes: parsed.data.useTimer ? parsed.data.minutes : 0,
    })

    if (rpcError) {
      setError(rpcError.message)
      setSubmitting(false)
      return
    }

    const attemptId = data as string
    navigate(`/test/${attemptId}`)
  }

  if (loading) return <p>Loading topics...</p>

  return (
    <div className="space-y-4">
      {error && <p className="text-red-600">{error}</p>}

      <div>
        <label className="block font-medium mb-1">Topic</label>
        <select
          className="border px-2 py-1 w-full"
          value={topicId}
          onChange={e => {
            setTopicId(e.target.value)
            setError(null)
          }}
        >
          <option value="">Select a topic</option>
          {topics.map(t => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        {topicId && availableQuestions > 0 && (
          <p className="text-xs text-gray-500 mt-1">
            {availableQuestions} question{availableQuestions !== 1 ? 's' : ''} available
          </p>
        )}
        {topicId && availableQuestions === 0 && (
          <p className="text-xs text-red-500 mt-1">
            No questions available in this topic
          </p>
        )}
      </div>

      <div>
        <label className="block font-medium mb-1">
          Number of Questions
        </label>
        <input
          type="number"
          min={practiceMode ? 0 : 1}
          max={100}
          value={questionCount}
          onChange={e => handleQuestionCountChange(e.target.value)}
          className="border px-2 py-1 w-full"
          placeholder={practiceMode ? "Enter number (0 for infinite)" : "Enter number (1-100)"}
          disabled={submitting}
        />
        <p className="text-xs text-gray-500 mt-1">
          {practiceMode
            ? 'Enter 0 for infinite practice mode'
            : 'Maximum 100 questions per test'}
        </p>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={useTimer}
          onChange={e => {
            setUseTimer(e.target.checked)
            setError(null)
          }}
          disabled={practiceMode}
        />
        <label className={practiceMode ? 'text-gray-400' : ''}>
          Enable countdown timer
        </label>
      </div>

      <div>
        <label className={`block font-medium mb-1 ${practiceMode ? 'text-gray-400' : ''}`}>
          Time (minutes)
        </label>
        <input
          type="number"
          min={1}
          max={180}
          value={minutes}
          onChange={e => setMinutes(e.target.value)}
          disabled={!useTimer || practiceMode}
          className="border px-2 py-1 w-full disabled:bg-gray-100"
        />
      </div>

      <div className="border-t pt-4">
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={practiceMode}
            onChange={e => {
              setPracticeMode(e.target.checked)
              if (e.target.checked) {
                setUseTimer(false) // Disable timer in practice mode
              }
              setError(null)
            }}
          />
          <label className="font-medium">Practice Mode</label>
        </div>
        <p className="text-xs text-gray-500 mt-1 ml-6">
          See correct answers immediately after each question. No timer, no score tracking.
        </p>
      </div>

      <button
        onClick={submit}
        disabled={submitting || !topicId || availableQuestions === 0 || questionCount === ''}
        className="bg-blue-600 text-white px-4 py-2 w-full disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {submitting ? 'Starting...' : practiceMode ? 'Start Practice' : 'Start Test'}
      </button>
    </div>
  )
}