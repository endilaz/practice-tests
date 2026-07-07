import { useEffect, useState, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { questionSchema, type QuestionFormData } from './question.schema'
import { useAuth } from '@/auth/useAuth'
import { BulkImportModal } from './BulkImportModal'
import { QuestionFeedbackModal } from './QuestionFeedbackModal'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Topic = {
  id: string
  name: string
}

type Question = {
  id: string
  topic_id: string
  question_text: string
  explanation_text: string | null
  difficulty_level: number | null
  created_at: string
  topics: { name: string }
}

type AnswerChoice = {
  id: string
  question_id: string
  choice_letter: 'A' | 'B' | 'C' | 'D'
  choice_text: string
  is_correct: boolean
}

type SortKey = 'date_desc' | 'date_asc' | 'topic_asc' | 'difficulty_asc' | 'difficulty_desc'

const LETTERS = ['A', 'B', 'C', 'D'] as const
const PAGE_SIZE = 50

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function QuestionsAdmin() {
  const { user } = useAuth()

  // --- List state ---
  const [topics, setTopics]         = useState<Topic[]>([])
  const [questions, setQuestions]   = useState<Question[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState<string | null>(null)

  // --- Pagination ---
  const [page, setPage] = useState(0) // 0-indexed

  // --- Search / filter / sort ---
  const [searchText, setSearchText]           = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [filterTopicId, setFilterTopicId]     = useState('')
  const [sortKey, setSortKey]                 = useState<SortKey>('date_desc')
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [feedbackOnly, setFeedbackOnly] = useState(false)

  // --- Form state ---
  const [showForm, setShowForm]     = useState(false)
  const [editingId, setEditingId]   = useState<string | null>(null)
  const [formData, setFormData]     = useState<QuestionFormData>({
    topic_id: '',
    question_text: '',
    explanation_text: '',
    difficulty_level: null,
    choices: LETTERS.map(letter => ({ letter, text: '', is_correct: false })),
  })
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)

  // --- Delete confirmation ---
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [deleting, setDeleting]           = useState(false)

  // --- Feedback modal ---
  const [feedbackQuestion, setFeedbackQuestion]   = useState<Question | null>(null)

  // --- Bulk import modal ---
  const [showImportModal, setShowImportModal]   = useState(false)
  const [importTab, setImportTab]               = useState<'json' | 'docx'>('json')

  // ---------------------------------------------------------------------------
  // Topics — loaded once on mount (always a small list)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    supabase
      .from('topics')
      .select('id, name')
      .order('name')
      .then(({ data, error: err }) => {
        if (err) console.error('Failed to load topics:', err)
        else setTopics(data as Topic[])
      })
  }, [])

  // ---------------------------------------------------------------------------
  // Search debounce — waits 300ms after last keystroke, then resets page + fires
  // ---------------------------------------------------------------------------
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

  // Reset page when filter or sort changes (discrete selections, no debounce needed)
  useEffect(() => { setPage(0) }, [filterTopicId, sortKey, feedbackOnly])

  // ---------------------------------------------------------------------------
  // Questions — paginated server-side fetch
  // Re-runs when page, debouncedSearch, filterTopicId, or sortKey changes.
  // ---------------------------------------------------------------------------
  const loadQuestions = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      // Build the base query with search + topic filter
      // When feedbackOnly is on, !inner on question_feedback restricts to questions
      // that have at least one feedback row — the join filters rather than expands
      // because we don't select any feedback columns.
      const feedbackJoin = feedbackOnly ? ', question_feedback!inner(question_id)' : ''
      let query = supabase
        .from('questions')
        .select(`id, topic_id, question_text, explanation_text, difficulty_level, created_at, topics!inner(name)${feedbackJoin}`, { count: 'exact' })

        // Text search (case-insensitive)
      if (debouncedSearch) {
        query = query.ilike('question_text', `%${debouncedSearch}%`)
      }

      // Topic filter
      if (filterTopicId) {
        query = query.eq('topic_id', filterTopicId)
      }

      // Sort
      switch (sortKey) {
        case 'date_desc':       query = query.order('created_at', { ascending: false }); break
        case 'date_asc':        query = query.order('created_at', { ascending: true });  break
        case 'topic_asc':       query = query.order('name', { referencedTable: 'topics', ascending: true }); break
        case 'difficulty_asc':  query = query.order('difficulty_level', { ascending: true,  nullsFirst: false }); break
        case 'difficulty_desc': query = query.order('difficulty_level', { ascending: false, nullsFirst: false }); break
      }

      // Pagination
      const from = page * PAGE_SIZE
      const to   = from + PAGE_SIZE - 1
      query = query.range(from, to)

      const { data, error: qErr, count } = await query

      if (qErr) throw qErr

      // Cast via unknown: the template-literal select string defeats
      // supabase-js's compile-time column parser.
      setQuestions(data as unknown as Question[])
      setTotalCount(count ?? 0)
    } catch (err: any) {
      console.error('Load questions error:', err)
      setError(err.message || 'Failed to load questions')
    } finally {
      setLoading(false)
    }
  }, [page, debouncedSearch, filterTopicId, sortKey, feedbackOnly])

  useEffect(() => {
    loadQuestions()
  }, [loadQuestions])

  // ---------------------------------------------------------------------------
  // Form helpers
  // ---------------------------------------------------------------------------

  function resetForm() {
    setFormData({
      topic_id: topics[0]?.id || '',
      question_text: '',
      explanation_text: '',
      difficulty_level: null,
      choices: LETTERS.map(letter => ({ letter, text: '', is_correct: false })),
    })
    setFormErrors({})
  }

  function openCreateForm() {
    setEditingId(null)
    resetForm()
    setShowForm(true)
  }

  async function openEditForm(questionId: string) {
    setEditingId(questionId)
    setFormErrors({})
    setShowForm(true)

    const [questionRes, choicesRes] = await Promise.all([
      supabase.from('questions').select('*').eq('id', questionId).single(),
      supabase.from('answer_choices').select('*').eq('question_id', questionId).order('choice_letter'),
    ])

    if (questionRes.error || choicesRes.error) {
      setError('Failed to load question for editing')
      setShowForm(false)
      return
    }

    const q = questionRes.data
    const choices = choicesRes.data as AnswerChoice[]

    setFormData({
      topic_id: q.topic_id,
      question_text: q.question_text,
      explanation_text: q.explanation_text || '',
      difficulty_level: q.difficulty_level,
      choices: LETTERS.map(letter => {
        const existing = choices.find(c => c.choice_letter === letter)
        return {
          letter,
          text: existing?.choice_text || '',
          is_correct: existing?.is_correct || false,
        }
      }),
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormErrors({})
    setSubmitting(true)

    const result = questionSchema.safeParse(formData)
    if (!result.success) {
      const errors: Record<string, string> = {}
      result.error.issues.forEach(err => {
        errors[err.path.join('.')] = err.message
      })
      setFormErrors(errors)
      setSubmitting(false)
      return
    }

    try {
      if (editingId) {
        await updateQuestion(editingId, result.data)
      } else {
        await createQuestion(result.data)
      }
      setShowForm(false)
      await loadQuestions()
    } catch (err: any) {
      console.error('Submit error:', err)
      setFormErrors({ submit: err.message || 'Failed to save question' })
    } finally {
      setSubmitting(false)
    }
  }

  async function createQuestion(data: QuestionFormData) {
    if (!user) throw new Error('Not authenticated')

    const { data: question, error: qError } = await supabase
      .from('questions')
      .insert({
        topic_id: data.topic_id,
        question_text: data.question_text.trim(),
        explanation_text: data.explanation_text?.trim() || null,
        difficulty_level: data.difficulty_level,
        created_by_admin_id: user.id,
      })
      .select()
      .single()

    if (qError) throw qError

    const choicesData = data.choices.map(c => ({
      question_id: question.id,
      choice_letter: c.letter,
      choice_text: c.text.trim(),
      is_correct: c.is_correct,
    }))

    const { error: cError } = await supabase.from('answer_choices').insert(choicesData)

    if (cError) {
      // Rollback: delete the question we just created
      await supabase.from('questions').delete().eq('id', question.id)
      throw new Error('Failed to create answer choices. Please try again.')
    }
  }

  async function updateQuestion(id: string, data: QuestionFormData) {
    const { error: qError } = await supabase
      .from('questions')
      .update({
        topic_id: data.topic_id,
        question_text: data.question_text.trim(),
        explanation_text: data.explanation_text?.trim() || null,
        difficulty_level: data.difficulty_level,
      })
      .eq('id', id)

    if (qError) throw qError

    // Replace choices: delete then re-insert
    const { error: dError } = await supabase
     .from('answer_choices')
     .delete()
     .eq('question_id', id)
    if (dError) throw new Error(`Failed to clear existing choices: ${dError.message}`)

    const choicesData = data.choices.map(c => ({
      question_id: id,
      choice_letter: c.letter,
      choice_text: c.text.trim(),
      is_correct: c.is_correct,
    }))

    const { error: cError } = await supabase.from('answer_choices').insert(choicesData)
    if (cError) throw new Error('Failed to update answer choices')
  }

  async function handleDelete(id: string) {
    setDeleting(true)
    try {
      const { error } = await supabase.from('questions').delete().eq('id', id)
      if (error) throw error
      setDeleteConfirm(null)
      await loadQuestions()
    } catch (err: any) {
      console.error('Delete error:', err)
      setError(err.message || 'Failed to delete question')
    } finally {
      setDeleting(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------

  const hasActiveFilters = !!(searchText || filterTopicId || sortKey !== 'date_desc' || feedbackOnly)
  const totalPages = Math.ceil(totalCount / PAGE_SIZE)

  function clearFilters() {
    setSearchText('')
    setFilterTopicId('')
    setSortKey('date_desc')
    setFeedbackOnly(false)
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Questions</h2>
          <p className="text-sm text-gray-600 mt-1">Manage test questions and answer choices</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => { setImportTab('docx'); setShowImportModal(true) }}
            className="bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 transition-colors font-medium"
          >
            Import DOCX
          </button>
          <button
            onClick={() => { setImportTab('json'); setShowImportModal(true) }}
            className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors font-medium"
          >
            Import JSON
          </button>
          <button
            onClick={openCreateForm}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors font-medium"
          >
            Create Question
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Search / Filter / Sort bar */}
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
          value={filterTopicId}
          onChange={e => setFilterTopicId(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All topics</option>
          {topics.map(t => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        <select
          value={sortKey}
          onChange={e => setSortKey(e.target.value as SortKey)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="date_desc">Newest first</option>
          <option value="date_asc">Oldest first</option>
          <option value="topic_asc">Topic (A–Z)</option>
          <option value="difficulty_asc">Difficulty (low → high)</option>
          <option value="difficulty_desc">Difficulty (high → low)</option>
        </select>
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none whitespace-nowrap">
            <input
              type="checkbox"
              checked={feedbackOnly}
              onChange={e => setFeedbackOnly(e.target.checked)}
              className="w-4 h-4 text-blue-600 rounded"
            />
            Has feedback
          </label>
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
      {!loading && (
        <p className="text-sm text-gray-500">
          {totalCount === 0
            ? 'No questions found'
            : `Showing ${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, totalCount)} of ${totalCount} question${totalCount !== 1 ? 's' : ''}`
          }
        </p>
      )}

      {/* Questions list */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <p className="text-gray-600">Loading questions...</p>
        </div>
      ) : totalCount === 0 && !hasActiveFilters ? (
        // Truly empty — no questions exist yet
        <div className="text-center py-12 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
          <p className="text-gray-600">No questions created yet</p>
          <button
            onClick={openCreateForm}
            className="mt-4 text-blue-600 hover:text-blue-700 font-medium"
          >
            Create your first question
          </button>
        </div>
      ) : questions.length === 0 ? (
        // Filters active but no matches
        <div className="text-center py-10 bg-gray-50 rounded-lg border border-gray-200">
          <p className="text-gray-500">No questions match your filters.</p>
          <button
            onClick={clearFilters}
            className="mt-2 text-blue-600 hover:text-blue-700 text-sm underline"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {questions.map(q => (
            <div
              key={q.id}
              className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="inline-block px-2 py-1 text-xs font-medium bg-blue-100 text-blue-700 rounded">
                      {q.topics.name}
                    </span>
                    {q.difficulty_level && (
                      <span className="inline-block px-2 py-1 text-xs font-medium bg-gray-100 text-gray-700 rounded">
                        Level {q.difficulty_level}
                      </span>
                    )}
                  </div>
                  <p className="text-gray-900 line-clamp-2">{q.question_text}</p>
                  <p className="text-xs text-gray-500 mt-2">
                    Created {new Date(q.created_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <button
                    onClick={() => setFeedbackQuestion(q)}
                    className="px-3 py-1 text-sm text-purple-600 hover:bg-purple-50 rounded transition-colors"
                  >
                    Feedback
                  </button>
                  <button
                    onClick={() => openEditForm(q.id)}
                    className="px-3 py-1 text-sm text-blue-600 hover:bg-blue-50 rounded transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => setDeleteConfirm(q.id)}
                    className="px-3 py-1 text-sm text-red-600 hover:bg-red-50 rounded transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
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

      {/* ------------------------------------------------------------------ */}
      {/* Feedback Modal                                                       */}
      {/* ------------------------------------------------------------------ */}
      {feedbackQuestion && (
        <QuestionFeedbackModal
          question={feedbackQuestion}
          onClose={() => setFeedbackQuestion(null)}
        />
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Create / Edit Form Modal                                            */}
      {/* ------------------------------------------------------------------ */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-xl max-w-3xl w-full my-8">
            <form onSubmit={handleSubmit} className="p-6 space-y-6">
              <div className="flex items-center justify-between pb-4 border-b">
                <h3 className="text-xl font-bold text-gray-900">
                  {editingId ? 'Edit Question' : 'Create New Question'}
                </h3>
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
                >
                  ×
                </button>
              </div>

              {formErrors.submit && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                  {formErrors.submit}
                </div>
              )}

              {/* Topic */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Topic <span className="text-red-500">*</span>
                </label>
                <select
                  value={formData.topic_id}
                  onChange={e => setFormData({ ...formData, topic_id: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                >
                  <option value="">Select a topic</option>
                  {topics.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
                {formErrors.topic_id && (
                  <p className="text-red-600 text-sm mt-1">{formErrors.topic_id}</p>
                )}
              </div>

              {/* Question Text */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Question Text <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={formData.question_text}
                  onChange={e => setFormData({ ...formData, question_text: e.target.value })}
                  rows={4}
                  maxLength={2000}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  placeholder="Enter the question..."
                  required
                />
                <div className="flex justify-between items-center mt-1">
                  <p className="text-xs text-gray-500">{formData.question_text.length} / 2000 characters</p>
                  {formErrors.question_text && (
                    <p className="text-red-600 text-sm">{formErrors.question_text}</p>
                  )}
                </div>
              </div>

              {/* Answer Choices */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Answer Choices <span className="text-red-500">*</span>
                </label>
                <p className="text-xs text-gray-500 mb-3">Select the radio button next to the correct answer</p>
                <div className="space-y-3">
                  {formData.choices.map((choice, idx) => (
                    <div key={choice.letter} className="flex items-start gap-2">
                      <div className="flex items-center h-10">
                        <input
                          type="radio"
                          name="correct-choice"
                          checked={choice.is_correct}
                          onChange={() => {
                            setFormData({
                              ...formData,
                              choices: formData.choices.map((c, i) => ({ ...c, is_correct: i === idx })),
                            })
                          }}
                          className="w-4 h-4 text-blue-600"
                          title="Mark as correct answer"
                        />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-gray-700 text-sm w-5">{choice.letter}.</span>
                          <input
                            type="text"
                            value={choice.text}
                            onChange={e => {
                              const newChoices = [...formData.choices]
                              newChoices[idx].text = e.target.value
                              setFormData({ ...formData, choices: newChoices })
                            }}
                            maxLength={500}
                            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                            placeholder={`Choice ${choice.letter}`}
                            required
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                {formErrors.choices && (
                  <p className="text-red-600 text-sm mt-2">{formErrors.choices}</p>
                )}
              </div>

              {/* Explanation */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Explanation (optional)
                </label>
                <textarea
                  value={formData.explanation_text}
                  onChange={e => setFormData({ ...formData, explanation_text: e.target.value })}
                  rows={3}
                  maxLength={2000}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  placeholder="Explain why the correct answer is correct..."
                />
                <p className="text-xs text-gray-500 mt-1">Shown to users after they submit the test</p>
              </div>

              {/* Difficulty */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Difficulty Level (optional)
                </label>
                <select
                  value={formData.difficulty_level ?? ''}
                  onChange={e => setFormData({
                    ...formData,
                    difficulty_level: e.target.value ? parseInt(e.target.value) : null,
                  })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Not set</option>
                  <option value="1">1 - Very Easy</option>
                  <option value="2">2 - Easy</option>
                  <option value="3">3 - Medium</option>
                  <option value="4">4 - Hard</option>
                  <option value="5">5 - Very Hard</option>
                </select>
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-4 border-t">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  disabled={submitting}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors font-medium"
                >
                  {submitting
                    ? (editingId ? 'Updating...' : 'Creating...')
                    : (editingId ? 'Update Question' : 'Create Question')
                  }
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Delete Confirmation Modal                                           */}
      {/* ------------------------------------------------------------------ */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 p-6 space-y-4">
            <h3 className="text-lg font-bold text-gray-900">Delete Question?</h3>
            <p className="text-gray-700 text-sm">
              This question will be permanently removed. Past test results will be preserved,
              but this question will not appear in future tests.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeleteConfirm(null)}
                disabled={deleting}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleDelete(deleteConfirm)}
                disabled={deleting}
                className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors font-medium"
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Bulk Import Modal                                                   */}
      {/* ------------------------------------------------------------------ */}
      {showImportModal && (
        <BulkImportModal
          initialTab={importTab}
          topics={topics}
          onClose={() => setShowImportModal(false)}
          onImported={loadQuestions}
        />
      )}
    </div>
  )
}