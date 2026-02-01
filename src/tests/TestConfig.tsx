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
  // Numeric fields are stored as strings so the user can clear them
  // and type freely. Validation happens on submit via the Zod schema,
  // not on every keystroke. Storing as number and using `|| 1` as a
  // fallback silently snaps 0 and empty-string to 1, which prevents
  // the user from seeing intermediate states while typing.
  const [topicId, setTopicId] = useState('')
  const [questionCount, setQuestionCount] = useState('25')
  const [useTimer, setUseTimer] = useState(false)
  const [minutes, setMinutes] = useState('30')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  // Prevents duplicate submissions. Currently submit() only calls
  // navigate() which is idempotent, but this pattern is established
  // now so that when Feature 5 wires this to the generate_test() RPC
  // the guard is already in place.
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

  function submit() {
    if (submitting) return
    setError(null)

    const parsed = testConfigSchema.safeParse({
      topicId,
      questionCount: Number(questionCount),
      useTimer,
      minutes: useTimer ? Number(minutes) : undefined,
    })

    if (!parsed.success) {
      // Surface the first validation error specifically rather than
      // a generic message. Tells the user exactly what to fix.
      const first = parsed.error.issues[0]
      setError(first?.message ?? 'Invalid test configuration.')
      return
    }

    setSubmitting(true)

    const params = new URLSearchParams({
      topic: parsed.data.topicId,
      count: String(parsed.data.questionCount),
      timer: parsed.data.useTimer ? '1' : '0',
      minutes: parsed.data.useTimer ? String(parsed.data.minutes) : '0',
    })

    navigate(`/test?${params.toString()}`)
    // Note: submitting is not reset here because navigation unmounts
    // this component. If navigation fails for any reason, the button
    // stays disabled — which is the correct behavior (don't retry
    // automatically, let the user refresh).
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
