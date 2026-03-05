import { useEffect, useState, useMemo } from 'react'
import { supabase } from '@/lib/supabase'

type QuestionStat = {
  question_id: string
  question_text: string
  topic_name: string
  times_attempted: number
  times_correct: number
  correctness_percentage: number
  avg_time_spent: number
  times_marked: number
  avg_difficulty: number | null
  avg_quality: number | null
}

type AnswerDistribution = {
  choice_letter: string
  choice_text: string
  selection_count: number
  is_correct: boolean
}

type Feedback = {
  id: string
  user_email: string
  difficulty_rating: number | null
  quality_rating: number | null
  feedback_text: string | null
  created_at: string
}

export default function QuestionAnalytics() {
  const [stats, setStats] = useState<QuestionStat[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Detail modal state
  const [selectedQuestion, setSelectedQuestion] = useState<QuestionStat | null>(null)
  const [answerDist, setAnswerDist] = useState<AnswerDistribution[]>([])
  const [feedback, setFeedback] = useState<Feedback[]>([])
  const [loadingDetail, setLoadingDetail] = useState(false)

  type SortKey =
| 'attempts_desc' | 'attempts_asc'
| 'correct_desc'  | 'correct_asc'
| 'time_desc'     | 'time_asc'
| 'marked_desc'
  const [searchText, setSearchText]     = useState('')
  const [filterTopic, setFilterTopic]   = useState('')
  const [sortKey, setSortKey]           = useState<SortKey>('attempts_desc')
  // Unique topic names derived from loaded stats — no extra DB call
  const topicOptions = useMemo(
    () => Array.from(new Set(stats.map(s => s.topic_name))).sort(),
    [stats]
  )
  const filteredStats = useMemo(() => {
    const needle = searchText.trim().toLowerCase()
    let result = stats.filter(s => {
      const matchesSearch = !needle || s.question_text.toLowerCase().includes(needle)
      const matchesTopic  = !filterTopic || s.topic_name === filterTopic
      return matchesSearch && matchesTopic
    })
    result = [...result].sort((a, b) => {
      switch (sortKey) {
        case 'attempts_desc': return b.times_attempted - a.times_attempted
        case 'attempts_asc':  return a.times_attempted - b.times_attempted
        case 'correct_desc':  return b.correctness_percentage - a.correctness_percentage
        case 'correct_asc':   return a.correctness_percentage - b.correctness_percentage
        case 'time_desc':     return b.avg_time_spent - a.avg_time_spent
        case 'time_asc':      return a.avg_time_spent - b.avg_time_spent
        case 'marked_desc':   return b.times_marked - a.times_marked
        default: return 0
      }
    })
    return result
  }, [stats, searchText, filterTopic, sortKey])

  useEffect(() => {
    loadQuestionStats()
  }, [])

  async function loadQuestionStats() {
    setLoading(true)
    setError(null)

    try {
      // Get all questions with their stats
      const { data: questions, error: qError } = await supabase
        .from('questions')
        .select('id, question_text, topics(name)')
        .order('created_at', { ascending: false })

      if (qError) throw qError

      // For each question, calculate stats from question_responses
      const statsPromises = questions.map(async (q: any) => {
        const { data: responses } = await supabase
          .from('question_responses')
          .select('is_correct, time_spent_seconds, marked_for_review')
          .eq('question_id', q.id)

        const { data: feedbackData } = await supabase
          .from('question_feedback')
          .select('difficulty_rating, quality_rating')
          .eq('question_id', q.id)

        const timesAttempted = responses?.length || 0
        const timesCorrect = responses?.filter(r => r.is_correct === true).length || 0
        const timesMarked = responses?.filter(r => r.marked_for_review).length || 0
        const totalTime = responses?.reduce((sum, r) => sum + (r.time_spent_seconds || 0), 0) || 0

        const avgDifficulty = feedbackData && feedbackData.length > 0
          ? feedbackData.reduce((sum, f) => sum + (f.difficulty_rating || 0), 0) / feedbackData.filter(f => f.difficulty_rating).length
          : null

        const avgQuality = feedbackData && feedbackData.length > 0
          ? feedbackData.reduce((sum, f) => sum + (f.quality_rating || 0), 0) / feedbackData.filter(f => f.quality_rating).length
          : null

        return {
          question_id: q.id,
          question_text: q.question_text,
          topic_name: q.topics?.name || 'Unknown',
          times_attempted: timesAttempted,
          times_correct: timesCorrect,
          correctness_percentage: timesAttempted > 0 ? Math.round((timesCorrect / timesAttempted) * 100) : 0,
          avg_time_spent: timesAttempted > 0 ? Math.round(totalTime / timesAttempted) : 0,
          times_marked: timesMarked,
          avg_difficulty: avgDifficulty ? Math.round(avgDifficulty * 10) / 10 : null,
          avg_quality: avgQuality ? Math.round(avgQuality * 10) / 10 : null,
        }
      })

      const calculatedStats = await Promise.all(statsPromises)
      setStats(calculatedStats)
    } catch (err: any) {
      console.error('Load question stats error:', err)
      setError(err.message || 'Failed to load question analytics')
    } finally {
      setLoading(false)
    }
  }

  async function loadQuestionDetail(questionId: string) {
    setLoadingDetail(true)

    try {
      // Load answer distribution
      const { data: choices } = await supabase
        .from('answer_choices')
        .select('id, choice_letter, choice_text, is_correct')
        .eq('question_id', questionId)
        .order('choice_letter')

      const distPromises = (choices || []).map(async (choice: any) => {
        const { count } = await supabase
          .from('question_responses')
          .select('*', { count: 'exact', head: true })
          .eq('question_id', questionId)
          .eq('selected_choice_id', choice.id)

        return {
          choice_letter: choice.choice_letter,
          choice_text: choice.choice_text,
          selection_count: count || 0,
          is_correct: choice.is_correct,
        }
      })

      const distribution = await Promise.all(distPromises)
      setAnswerDist(distribution)

      // Load feedback
      const { data: feedbackData } = await supabase
        .from('question_feedback')
        .select('id, difficulty_rating, quality_rating, feedback_text, created_at, users!inner(email)')
        .eq('question_id', questionId)
        .order('created_at', { ascending: false })

      setFeedback(
        (feedbackData || []).map((f: any) => ({
          id: f.id,
          user_email: f.users?.email || 'Unknown',
          difficulty_rating: f.difficulty_rating,
          quality_rating: f.quality_rating,
          feedback_text: f.feedback_text,
          created_at: f.created_at,
        }))
      )
    } catch (err: any) {
      console.error('Load question detail error:', err)
    } finally {
      setLoadingDetail(false)
    }
  }

  function openDetail(stat: QuestionStat) {
    setSelectedQuestion(stat)
    loadQuestionDetail(stat.question_id)
  }

  function closeDetail() {
    setSelectedQuestion(null)
    setAnswerDist([])
    setFeedback([])
  }

  if (loading) {
    return (
      <div className="p-6">
        <p className="text-gray-600">Loading question analytics...</p>
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
      <h2 className="text-2xl font-bold">Question Analytics</h2>

      {stats.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center">
          <p className="text-gray-500">No question data available yet</p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Filter bar */}
          <div className="flex flex-wrap gap-3 items-center bg-gray-50 border border-gray-200 rounded-lg p-3">
            <div className="flex-1 min-w-48">
              <input
                type="search"
                placeholder="Search question text…"
                value={searchText}
                onChange={e => setSearchText(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <select
              value={filterTopic}
              onChange={e => setFilterTopic(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All topics</option>
              {topicOptions.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <select
              value={sortKey}
              onChange={e => setSortKey(e.target.value as SortKey)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="attempts_desc">Most attempted</option>
              <option value="attempts_asc">Least attempted</option>
              <option value="correct_desc">Highest correct %</option>
              <option value="correct_asc">Lowest correct %</option>
              <option value="time_desc">Slowest (avg time)</option>
              <option value="time_asc">Fastest (avg time)</option>
              <option value="marked_desc">Most marked for review</option>
            </select>
            {(searchText || filterTopic || sortKey !== 'attempts_desc') && (
              <button
                onClick={() => { setSearchText(''); setFilterTopic(''); setSortKey('attempts_desc') }}
                className="text-sm text-gray-500 hover:text-gray-700 underline whitespace-nowrap"
              >
                Clear filters
              </button>
            )}
          </div>

          {/* Result count */}
          <p className="text-sm text-gray-500">
            Showing {filteredStats.length} of {stats.length} question{stats.length !== 1 ? 's' : ''}
          </p>

          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Question</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Topic</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Attempts</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Correct %</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Avg Time</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Marked</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Ratings</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                  {filteredStats.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-6 py-10 text-center text-gray-500">
                        No questions match your filters.{' '}
                        <button
                          onClick={() => { setSearchText(''); setFilterTopic(''); setSortKey('attempts_desc') }}
                          className="text-blue-600 hover:text-blue-800 underline"
                        >
                          Clear filters
                        </button>
                      </td>
                    </tr>
                  ) : filteredStats.map(stat => (
                  <tr key={stat.question_id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 max-w-xs">
                      <p className="text-sm text-gray-900 line-clamp-2">{stat.question_text}</p>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">{stat.topic_name}</td>
                    <td className="px-6 py-4 text-sm text-gray-900">{stat.times_attempted}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${
                        stat.correctness_percentage >= 70
                          ? 'bg-green-100 text-green-800'
                          : stat.correctness_percentage >= 50
                          ? 'bg-yellow-100 text-yellow-800'
                          : 'bg-red-100 text-red-800'
                      }`}>
                        {stat.correctness_percentage}%
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">{stat.avg_time_spent}s</td>
                    <td className="px-6 py-4 text-sm text-gray-600">{stat.times_marked}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {stat.avg_difficulty && stat.avg_quality
                        ? `D:${stat.avg_difficulty} Q:${stat.avg_quality}`
                        : '—'}
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
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {selectedQuestion && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full my-8">
            <div className="p-6 space-y-6">
              {/* Header */}
              <div className="flex justify-between items-start border-b pb-4">
                <div className="flex-1">
                  <h3 className="text-xl font-bold text-gray-900 mb-2">Question Details</h3>
                  <p className="text-gray-700">{selectedQuestion.question_text}</p>
                  <p className="text-sm text-gray-500 mt-1">Topic: {selectedQuestion.topic_name}</p>
                </div>
                <button
                  type="button"
                  onClick={closeDetail}
                  className="text-gray-400 hover:text-gray-600 text-2xl leading-none ml-4"
                >
                  ×
                </button>
              </div>

              {loadingDetail ? (
                <p className="text-gray-600">Loading details...</p>
              ) : (
                <>
                  {/* Answer Distribution */}
                  <div>
                    <h4 className="font-semibold text-gray-900 mb-3">Answer Distribution</h4>
                    <div className="space-y-2">
                      {answerDist.map(dist => (
                        <div key={dist.choice_letter} className="flex items-center gap-3">
                          <span className="font-bold text-gray-700 w-8">{dist.choice_letter}.</span>
                          <div className="flex-1">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-sm text-gray-900">{dist.choice_text}</span>
                              <span className="text-sm font-medium text-gray-700">
                                {dist.selection_count} {dist.selection_count === 1 ? 'selection' : 'selections'}
                                {dist.is_correct && ' ✓'}
                              </span>
                            </div>
                            <div className="w-full bg-gray-200 rounded-full h-2">
                              <div
                                className={`h-2 rounded-full ${dist.is_correct ? 'bg-green-500' : 'bg-blue-500'}`}
                                style={{
                                  width: `${selectedQuestion.times_attempted > 0
                                    ? (dist.selection_count / selectedQuestion.times_attempted) * 100
                                    : 0}%`,
                                }}
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Feedback */}
                  <div>
                    <h4 className="font-semibold text-gray-900 mb-3">User Feedback ({feedback.length})</h4>
                    {feedback.length === 0 ? (
                      <p className="text-sm text-gray-500">No feedback yet</p>
                    ) : (
                      <div className="space-y-3 max-h-64 overflow-y-auto">
                        {feedback.map(f => (
                          <div key={f.id} className="border rounded-lg p-3 bg-gray-50">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-sm font-medium text-gray-700">{f.user_email}</span>
                              <span className="text-xs text-gray-500">
                                {new Date(f.created_at).toLocaleDateString()}
                              </span>
                            </div>
                            {(f.difficulty_rating || f.quality_rating) && (
                              <div className="text-xs text-gray-600 mb-1">
                                {f.difficulty_rating && `Difficulty: ${f.difficulty_rating}/5`}
                                {f.difficulty_rating && f.quality_rating && ' • '}
                                {f.quality_rating && `Quality: ${f.quality_rating}/5`}
                              </div>
                            )}
                            {f.feedback_text && (
                              <p className="text-sm text-gray-700">{f.feedback_text}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}

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