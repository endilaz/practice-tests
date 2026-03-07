import { useEffect, useState, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

// Matches the return type of the get_question_analytics RPC.
// Note: correctness_pct (not correctness_percentage) to align with the DB function column name.
type QuestionStat = {
  question_id: string
  question_text: string
  topic_name: string
  times_attempted: number
  times_correct: number
  correctness_pct: number
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

type SortKey =
  | 'attempts_desc' | 'attempts_asc'
  | 'correct_desc'  | 'correct_asc'
  | 'time_desc'     | 'time_asc'
  | 'marked_desc'

const PAGE_SIZE = 50

export default function QuestionAnalytics() {
  // --- List state ---
  const [stats, setStats]           = useState<QuestionStat[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState<string | null>(null)

  // --- Filter / sort / pagination ---
  const [page, setPage]                       = useState(0) // 0-indexed
  const [searchText, setSearchText]           = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [filterTopic, setFilterTopic]         = useState('')
  const [sortKey, setSortKey]                 = useState<SortKey>('attempts_desc')
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Topic options for filter dropdown — loaded once, always a small list
  const [topicOptions, setTopicOptions] = useState<string[]>([])

  // --- Detail modal state ---
  const [selectedQuestion, setSelectedQuestion] = useState<QuestionStat | null>(null)
  const [answerDist, setAnswerDist]             = useState<AnswerDistribution[]>([])
  const [feedback, setFeedback]                 = useState<Feedback[]>([])
  const [loadingDetail, setLoadingDetail]       = useState(false)

  // Load topic names once on mount for the filter dropdown
  useEffect(() => {
    supabase
      .from('topics')
      .select('name')
      .order('name')
      .then(({ data }) => {
        if (data) setTopicOptions(data.map((t: { name: string }) => t.name))
      })
  }, [])

  // Debounce search input: wait 300ms after last keystroke before updating
  // debouncedSearch (which triggers the fetch). Also resets page to 0.
  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    searchDebounceRef.current = setTimeout(() => {
      setPage(0)
      setDebouncedSearch(searchText)
    }, 300)
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    }
  }, [searchText])

  // Reset to page 0 when topic filter or sort changes (discrete selections, no debounce needed)
  useEffect(() => { setPage(0) }, [filterTopic, sortKey])

  // Main fetch — 2 parallel RPC calls replacing the old ~6000 per-question requests.
  // Runs whenever page, debouncedSearch, filterTopic, or sortKey changes.
  const loadQuestionStats = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const [statsRes, countRes] = await Promise.all([
        supabase.rpc('get_question_analytics', {
          p_search: debouncedSearch,
          p_topic:  filterTopic,
          p_sort:   sortKey,
          p_limit:  PAGE_SIZE,
          p_offset: page * PAGE_SIZE,
        }),
        supabase.rpc('get_question_analytics_count', {
          p_search: debouncedSearch,
          p_topic:  filterTopic,
        }),
      ])

      if (statsRes.error) throw statsRes.error
      if (countRes.error) throw countRes.error

      setStats(statsRes.data as QuestionStat[])
      // Cast to Number: Supabase returns bigint as string in some JS environments
      setTotalCount(Number(countRes.data))
    } catch (err: any) {
      console.error('Load question stats error:', err)
      setError(err.message || 'Failed to load question analytics')
    } finally {
      setLoading(false)
    }
  }, [page, debouncedSearch, filterTopic, sortKey])

  useEffect(() => {
    loadQuestionStats()
  }, [loadQuestionStats])

  // --- Detail modal ---
  async function loadQuestionDetail(questionId: string) {
    setLoadingDetail(true)

    try {
      // Load answer distribution — 4 choices max, so 4 count queries is fine here
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

  function clearFilters() {
    setSearchText('')
    setFilterTopic('')
    setSortKey('attempts_desc')
  }

  const hasActiveFilters = searchText || filterTopic || sortKey !== 'attempts_desc'
  const totalPages = Math.ceil(totalCount / PAGE_SIZE)

  // Top-level error state (shown above the filter bar so filters remain usable)
  if (error) {
    return (
      <div className="p-6 space-y-4">
        <h2 className="text-2xl font-bold">Question Analytics</h2>
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      <h2 className="text-2xl font-bold">Question Analytics</h2>

      {/* Filter / sort bar */}
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

        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="text-sm text-gray-500 hover:text-gray-700 underline whitespace-nowrap"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Result count */}
      {!loading && totalCount > 0 && (
        <p className="text-sm text-gray-500">
          Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalCount)} of {totalCount} question{totalCount !== 1 ? 's' : ''}
        </p>
      )}

      {/* Table */}
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
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-6 py-10 text-center text-gray-500">
                    Loading...
                  </td>
                </tr>
              ) : stats.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-10 text-center text-gray-500">
                    {hasActiveFilters ? (
                      <>
                        No questions match your filters.{' '}
                        <button
                          onClick={clearFilters}
                          className="text-blue-600 hover:text-blue-800 underline"
                        >
                          Clear filters
                        </button>
                      </>
                    ) : (
                      'No question data available yet.'
                    )}
                  </td>
                </tr>
              ) : (
                stats.map(stat => (
                  <tr key={stat.question_id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 max-w-xs">
                      <p className="text-sm text-gray-900 line-clamp-2">{stat.question_text}</p>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">{stat.topic_name}</td>
                    <td className="px-6 py-4 text-sm text-gray-900">{stat.times_attempted}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${
                        stat.correctness_pct >= 70
                          ? 'bg-green-100 text-green-800'
                          : stat.correctness_pct >= 50
                          ? 'bg-yellow-100 text-yellow-800'
                          : 'bg-red-100 text-red-800'
                      }`}>
                        {stat.correctness_pct}%
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
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination — only shown when there's more than one page */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <button
            onClick={() => setPage(p => p - 1)}
            disabled={page === 0 || loading}
            className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            ← Previous
          </button>
          <span className="text-sm text-gray-600">
            Page {page + 1} of {totalPages}
          </span>
          <button
            onClick={() => setPage(p => p + 1)}
            disabled={(page + 1) * PAGE_SIZE >= totalCount || loading}
            className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Next →
          </button>
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