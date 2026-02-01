import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

type Topic = {
  id: string
  name: string
}

export function TopicsAdmin() {
  const [topics, setTopics] = useState<Topic[]>([])
  const [newTopic, setNewTopic] = useState('')
  const [loading, setLoading] = useState(true)
  const [mutating, setMutating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadTopics()
  }, [])

  async function loadTopics() {
    setLoading(true)
    setError(null)

    const { data, error } = await supabase
      .from('topics')
      .select('id, name')
      .order('name')

    if (error) {
      setError(
        error.code === '42501'
          ? 'You are not authorized to manage topics.'
          : error.message
      )
    } else {
      setTopics(data)
    }

    setLoading(false)
  }

  async function createTopic() {
    const name = newTopic.trim()
    if (!name || mutating) return

    setMutating(true)
    setError(null)

    const { data, error } = await supabase
      .from('topics')
      .insert({ name })
      .select()
      .single()

    if (error) {
      setError(error.message)
    } else {
      setTopics(prev => [...prev, data])
      setNewTopic('')
    }

    setMutating(false)
  }

  async function renameTopic(id: string, name: string) {
    const trimmed = name.trim()
    if (!trimmed || mutating) return

    setMutating(true)
    setError(null)

    const { error } = await supabase
      .from('topics')
      .update({ name: trimmed })
      .eq('id', id)

    if (error) {
      setError(error.message)
    } else {
      setTopics(prev =>
        prev.map(t => (t.id === id ? { ...t, name: trimmed } : t))
      )
    }

    setMutating(false)
  }

  async function deleteTopic(id: string) {
    if (!confirm('Delete this topic?') || mutating) return

    setMutating(true)
    setError(null)

    const { error } = await supabase
      .from('topics')
      .delete()
      .eq('id', id)

    if (error) {
      setError(error.message)
    } else {
      setTopics(prev => prev.filter(t => t.id !== id))
    }

    setMutating(false)
  }

  if (loading) return <p>Loading topics...</p>

  return (
    <div>
      {error && <p className="text-red-600 mb-4">{error}</p>}

      <div className="flex gap-2 mb-4">
        <input
          className="border px-2 py-1 flex-1"
          value={newTopic}
          onChange={e => setNewTopic(e.target.value)}
          placeholder="New topic name"
          disabled={mutating}
        />
        <button
          onClick={createTopic}
          disabled={mutating}
          className="bg-blue-600 text-white px-4 py-1 disabled:opacity-50"
        >
          Add
        </button>
      </div>

      {topics.length === 0 ? (
        <p className="text-gray-600">No topics created yet.</p>
      ) : (
        <ul className="space-y-2">
          {topics.map(topic => (
            <li
              key={topic.id}
              className="flex items-center justify-between border p-2"
            >
              <input
                className="flex-1 mr-2 border px-2 py-1"
                value={topic.name}
                onChange={e =>
                  setTopics(prev =>
                    prev.map(t =>
                      t.id === topic.id
                        ? { ...t, name: e.target.value }
                        : t
                    )
                  )
                }
                onBlur={e => renameTopic(topic.id, e.target.value)}
                disabled={mutating}
              />
              <button
                onClick={() => deleteTopic(topic.id)}
                disabled={mutating}
                className="text-red-600 disabled:opacity-50"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
