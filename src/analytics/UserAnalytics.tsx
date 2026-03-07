import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

type UserStat = {
  user_id: string
  email: string
  total_tests: number
  avg_score_percentage: number
  last_active: string
}

type UserDetail = {
  test_history: Array<{
    id: string
    topic_name: string
    score: number
    total: number
    completed_at: string
  }>
  performance_by_topic: Array<{
    topic_name: string
    tests_taken: number
    avg_score_percentage: number
  }>
}

export default function UserAnalytics() {
  const [stats, setStats] = useState<UserStat[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Detail modal state
  const [selectedUser, setSelectedUser] = useState<UserStat | null>(null)
  const [userDetail, setUserDetail] = useState<UserDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)

  useEffect(() => {
    loadUserStats()
  }, [])

  async function loadUserStats() {
    setLoading(true)
    setError(null)

    try {
      // Get all users with completed test attempts
      const { data: users, error: uError } = await supabase
        .from('users')
        .select('id, email')
        .order('email')

      if (uError) throw uError

      // For each user, calculate stats
      const statsPromises = users.map(async (user: any) => {
        const { data: attempts } = await supabase
          .from('test_attempts')
          .select('score, total_possible, completed_at')
          .eq('user_id', user.id)
          .not('completed_at', 'is', null)
          .order('completed_at', { ascending: false })

        if (!attempts || attempts.length === 0) {
          return null // Skip users with no completed tests
        }

        const totalTests = attempts.length
        const totalScore = attempts.reduce((sum, a) => sum + a.score, 0)
        const totalPossible = attempts.reduce((sum, a) => sum + a.total_possible, 0)
        const avgPercentage = totalPossible > 0 ? Math.round((totalScore / totalPossible) * 100) : 0
        const lastActive = attempts[0].completed_at

        return {
          user_id: user.id,
          email: user.email,
          total_tests: totalTests,
          avg_score_percentage: avgPercentage,
          last_active: lastActive,
        }
      })

      const calculatedStats = (await Promise.all(statsPromises)).filter(
        (s): s is UserStat => s !== null
      )
      setStats(calculatedStats)
    } catch (err: any) {
      console.error('Load user stats error:', err)
      setError(err.message || 'Failed to load user analytics')
    } finally {
      setLoading(false)
    }
  }

  async function loadUserDetail(userId: string) {
    setLoadingDetail(true)

    try {
      // Load test history
      const { data: attempts } = await supabase
        .from('test_attempts')
        .select('id, score, total_possible, completed_at, topics(name)')
        .eq('user_id', userId)
        .not('completed_at', 'is', null)
        .order('completed_at', { ascending: false })
        .limit(20)

      const testHistory = (attempts || []).map((a: any) => ({
        id: a.id,
        topic_name: a.topics?.name || 'Unknown',
        score: a.score,
        total: a.total_possible,
        completed_at: a.completed_at,
      }))

      // Calculate performance by topic
      const topicMap = new Map<string, { total: number; correct: number }>()

      attempts?.forEach((a: any) => {
        const topicName = a.topics?.name || 'Unknown'
        const existing = topicMap.get(topicName) || { total: 0, correct: 0 }
        topicMap.set(topicName, {
          total: existing.total + a.total_possible,
          correct: existing.correct + a.score,
        })
      })

      const performanceByTopic = Array.from(topicMap.entries()).map(([topic, stats]) => ({
        topic_name: topic,
        tests_taken: attempts?.filter((a: any) => a.topics?.name === topic).length || 0,
        avg_score_percentage: stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0,
      }))

      setUserDetail({ test_history: testHistory, performance_by_topic: performanceByTopic })
    } catch (err: any) {
      console.error('Load user detail error:', err)
    } finally {
      setLoadingDetail(false)
    }
  }

  function openDetail(stat: UserStat) {
    setSelectedUser(stat)
    loadUserDetail(stat.user_id)
  }

  function closeDetail() {
    setSelectedUser(null)
    setUserDetail(null)
  }

  if (loading) {
    return (
      <div className="p-6">
        <p className="text-gray-600">Loading user analytics...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
          {error}
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      <h2 className="text-2xl font-bold">User Analytics</h2>

      {stats.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center">
          <p className="text-gray-500">No user data available yet</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Total Tests</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Avg Score</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Last Active</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {stats.map(stat => (
                <tr key={stat.user_id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-sm text-gray-900">{stat.email}</td>
                  <td className="px-6 py-4 text-sm text-gray-900">{stat.total_tests}</td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${
                      stat.avg_score_percentage >= 70
                        ? 'bg-green-100 text-green-800'
                        : stat.avg_score_percentage >= 50
                        ? 'bg-yellow-100 text-yellow-800'
                        : 'bg-red-100 text-red-800'
                    }`}>
                      {stat.avg_score_percentage}%
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    {new Date(stat.last_active).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 text-sm">
                    <button
                      type="button"
                      onClick={() => openDetail(stat)}
                      className="text-blue-600 hover:text-blue-800 font-medium"
                    >
                      Details
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail Modal */}
      {selectedUser && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full my-8">
            <div className="p-6 space-y-6">
              {/* Header */}
              <div className="flex justify-between items-center border-b pb-4">
                <div>
                  <h3 className="text-xl font-bold text-gray-900">{selectedUser.email}</h3>
                  <p className="text-sm text-gray-500">
                    {selectedUser.total_tests} tests • {selectedUser.avg_score_percentage}% average
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeDetail}
                  className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
                >
                  ×
                </button>
              </div>

              {loadingDetail ? (
                <p className="text-gray-600">Loading details...</p>
              ) : userDetail ? (
                <>
                  {/* Performance by Topic */}
                  <div>
                    <h4 className="font-semibold text-gray-900 mb-3">Performance by Topic</h4>
                    {userDetail.performance_by_topic.length === 0 ? (
                      <p className="text-sm text-gray-500">No data available</p>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {userDetail.performance_by_topic.map(perf => (
                          <div key={perf.topic_name} className="border rounded-lg p-4">
                            <div className="flex justify-between items-center mb-2">
                              <span className="font-medium text-gray-900">{perf.topic_name}</span>
                              <span className="text-sm text-gray-600">{perf.tests_taken} tests</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="flex-1 bg-gray-200 rounded-full h-2">
                                <div
                                  className={`h-2 rounded-full ${
                                    perf.avg_score_percentage >= 70
                                      ? 'bg-green-500'
                                      : perf.avg_score_percentage >= 50
                                      ? 'bg-yellow-500'
                                      : 'bg-red-500'
                                  }`}
                                  style={{ width: `${perf.avg_score_percentage}%` }}
                                />
                              </div>
                              <span className="text-sm font-medium text-gray-700">
                                {perf.avg_score_percentage}%
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Test History */}
                  <div>
                    <h4 className="font-semibold text-gray-900 mb-3">Recent Test History</h4>
                    {userDetail.test_history.length === 0 ? (
                      <p className="text-sm text-gray-500">No tests yet</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                                Date
                              </th>
                              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                                Topic
                              </th>
                              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                                Score
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-200">
                            {userDetail.test_history.map(test => (
                              <tr key={test.id}>
                                <td className="px-4 py-2 text-gray-900">
                                  {new Date(test.completed_at).toLocaleDateString()}
                                </td>
                                <td className="px-4 py-2 text-gray-900">{test.topic_name}</td>
                                <td className="px-4 py-2">
                                  <span className="text-gray-900">
                                    {test.score}/{test.total}
                                  </span>
                                  <span className="text-gray-500 ml-2">
                                    ({test.total > 0 ? Math.round((test.score / test.total) * 100) : 0}%)
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </>
              ) : null}

              {/* Close Button */}
              <div className="flex justify-end border-t pt-4">
                <button
                  type="button"
                  onClick={closeDetail}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}