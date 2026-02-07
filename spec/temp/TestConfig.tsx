import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useNavigate } from 'react-router-dom'
import { testConfigSchema } from './test.schema'

type Topic = {
  id: string
  name: string
}

export function TestConfigForm() {
  const [topics, setTopics] = useState<Topic[]>([])
  const [topicId, setTopicId] = useState('')
  const [questionCount, setQuestionCount] = useState('25')
  const [useTimer, setUseTimer] = useState(false)
  const [minutes, setMinutes] = useState('30')
  const [practiceMode, setPracticeMode] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  const navigate = useNavigate()

  useEffect(() => {
    loadTopics()
  }, [])

  async function loadTopics() {
    const { data, error } = await supabase
      .from('topics')
      .select('id, name')
      .order('name')

    if (error) {
      setError(error.message)
    } else {
      setTopics(data)
    }
    setLoading(false)
  }

  async function submit() {
    if (submitting) return
    setError(null)

    const count = Number(questionCount)

    // Validate infinite mode is only for practice
    if (count === 0 && !practiceMode) {
      setError('Infinite questions is only available in Practice Mode.')
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
      </div>

      <div>
        <label className="block font-medium mb-1">
          Number of Questions
        </label>
        <select
          value={questionCount}
          onChange={e => {
            setQuestionCount(e.target.value)
            setError(null)
          }}
          className="border px-2 py-1 w-full"
        >
          <option value="10">10 questions</option>
          <option value="25">25 questions</option>
          <option value="50">50 questions</option>
          <option value="100">100 questions</option>
          <option value="0">Infinite (practice mode only)</option>
        </select>
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
        disabled={submitting}
        className="bg-blue-600 text-white px-4 py-2 w-full disabled:opacity-50"
      >
        {submitting ? 'Starting...' : practiceMode ? 'Start Practice' : 'Start Test'}
      </button>
    </div>
  )
}