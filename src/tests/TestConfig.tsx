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

    const parsed = testConfigSchema.safeParse({
      topicId,
      questionCount: Number(questionCount),
      useTimer,
      minutes: useTimer ? Number(minutes) : undefined,
    })

    if (!parsed.success) {
      const first = parsed.error.issues[0]
      setError(first?.message ?? 'Invalid test configuration.')
      return
    }

    setSubmitting(true)

    // Generate the test ONCE here, then navigate with attemptId
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
        <input
          type="number"
          min={1}
          max={100}
          value={questionCount}
          onChange={e => {
            setQuestionCount(e.target.value)
            setError(null)
          }}
          className="border px-2 py-1 w-full"
        />
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={useTimer}
          onChange={e => {
            setUseTimer(e.target.checked)
            setError(null)
          }}
        />
        <label>Enable countdown timer</label>
      </div>

      <div>
        <label className="block font-medium mb-1">
          Time (minutes)
        </label>
        <input
          type="number"
          min={1}
          max={180}
          value={minutes}
          onChange={e => setMinutes(e.target.value)}
          disabled={!useTimer}
          className="border px-2 py-1 w-full disabled:bg-gray-100"
        />
      </div>

      <button
        onClick={submit}
        disabled={submitting}
        className="bg-blue-600 text-white px-4 py-2 w-full disabled:opacity-50"
      >
        {submitting ? 'Starting...' : 'Start Test'}
      </button>
    </div>
  )
}