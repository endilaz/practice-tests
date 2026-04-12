import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { TestConfigForm } from '@/tests/TestConfig'
import { useAuth } from '@/auth/useAuth'
import { supabase } from '@/lib/supabase'

type TestAttempt = {
  id: string
  completed_at: string
  score: number
  total_possible: number
  total_time_seconds: number
  topics: { name: string } | null
}

export default function Dashboard() {
  const { role, user } = useAuth()
  const navigate = useNavigate()
  
  const [attempts, setAttempts] = useState<TestAttempt[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [historyLimit, setHistoryLimit] = useState(10)

  useEffect(() => {
    if (user) {
      loadTestHistory()
    }
  }, [user, historyLimit])

  async function loadTestHistory() {
    if (!user) return

    setLoading(true)
    setError(null)

    try {
      const { data, error: fetchError } = await supabase
        .from('test_attempts')
        .select('id, completed_at, score, total_possible, total_time_seconds, topics(name)')
        .eq('user_id', user.id)
        .not('completed_at', 'is', null)
        .order('completed_at', { ascending: false })
        .limit(historyLimit)

      if (fetchError) throw fetchError

      setAttempts(data as TestAttempt[])
    } catch (err: any) {
      console.error('Load test history error:', err)
      setError(err.message || 'Failed to load test history')
    } finally {
      setLoading(false)
    }
  }

  function formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  function formatDate(dateString: string): string {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  function calculatePercentage(score: number, total: number): number {
    return total > 0 ? Math.round((score / total) * 100) : 0
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow px-4 py-3 flex justify-between items-center">
        <h1 className="text-lg font-semibold">FBLA Practice Tests</h1>
        <div className="flex items-center gap-4">
          {role === 'admin' && (
            <Link to="/admin" className="text-sm text-blue-600 underline">
              Admin
            </Link>
          )}
          <Link to="/change-password" className="text-sm text-blue-600 underline">
            Change Password
          </Link>
          <button
            onClick={() => supabase.auth.signOut()}
            className="text-sm text-gray-600 underline"
          >
            Log Out
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto mt-10 px-4 space-y-10">
        {/* Test Config Section */}
        <section>
          <h2 className="text-xl font-bold mb-6">Start a Practice Test</h2>
          <div className="max-w-md">
            <TestConfigForm />
          </div>
        </section>

        {/* Test History Section */}
        <section>
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold">Test History</h2>
            {attempts.length > 0 && (
              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-600">Show:</label>
                <select
                  value={historyLimit}
                  onChange={e => setHistoryLimit(Number(e.target.value))}
                  className="border border-gray-300 rounded px-2 py-1 text-sm"
                >
                  <option value={5}>5 tests</option>
                  <option value={10}>10 tests</option>
                  <option value={20}>20 tests</option>
                  <option value={50}>50 tests</option>
                  <option value={100}>100 tests</option>
                </select>
              </div>
            )}
          </div>
          
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4">
              {error}
            </div>
          )}

          {loading ? (
            <div className="bg-white rounded-lg shadow p-8 text-center">
              <p className="text-gray-600">Loading test history...</p>
            </div>
          ) : attempts.length === 0 ? (
            <div className="bg-white rounded-lg shadow p-8 text-center">
              <p className="text-gray-500 mb-2">No test history yet</p>
              <p className="text-sm text-gray-400">
                Complete a test to see your results here
              </p>
            </div>
          ) : (
            <div className="bg-white rounded-lg shadow overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Date
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Topic
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Score
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Time
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {attempts.map(attempt => {
                    const percentage = calculatePercentage(attempt.score, attempt.total_possible)
                    
                    return (
                      <tr key={attempt.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {formatDate(attempt.completed_at)}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-900">
                          <span className="line-clamp-1">
                            {attempt.topics?.name || 'Unknown Topic'}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-900">
                              {attempt.score}/{attempt.total_possible}
                            </span>
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                              percentage >= 70 
                                ? 'bg-green-100 text-green-800' 
                                : percentage >= 50 
                                ? 'bg-yellow-100 text-yellow-800' 
                                : 'bg-red-100 text-red-800'
                            }`}>
                              {percentage}%
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                          {formatTime(attempt.total_time_seconds)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          <button
                            type="button"
                            onClick={() => navigate(`/results/${attempt.id}`)}
                            className="text-blue-600 hover:text-blue-800 font-medium"
                          >
                            View Results
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}