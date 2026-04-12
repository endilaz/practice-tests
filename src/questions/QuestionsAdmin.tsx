import { useEffect, useState, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { questionSchema, bulkImportSchema, type QuestionFormData, type BulkImportData } from './question.schema'
import { useAuth } from '@/auth/useAuth'
import { DocxImport } from './DocxImport'
import { DocxImportFBLA } from './DocxImportStudyguides'

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

type QuestionFeedback = {
  id: string
  user_email: string
  difficulty_rating: number | null
  quality_rating: number | null
  feedback_text: string | null
  created_at: string
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
  const [feedbackItems, setFeedbackItems]         = useState<QuestionFeedback[]>([])
  const [loadingFeedback, setLoadingFeedback]     = useState(false)

  // --- Bulk import state ---
  const [showImportModal, setShowImportModal]   = useState(false)
  const [importFile, setImportFile]             = useState<File | null>(null)
  const [importData, setImportData]             = useState<BulkImportData | null>(null)
  const [importErrors, setImportErrors]         = useState<string[]>([])
  const [importing, setImporting]               = useState(false)
  const [importSuccess, setImportSuccess]       = useState<{ count: number; topic: string } | null>(null)
  const [importTab, setImportTab]               = useState<'json' | 'docx'>('json')
  const fileInputRef = useRef<HTMLInputElement>(null)

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
      const feedbackJoin = feedbackOnly ? ', question_feedback!inner(id)' : ''
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

      setQuestions(data as Question[])
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
      result.error.errors.forEach(err => {
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
    await supabase.from('answer_choices').delete().eq('question_id', id)

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
  // Feedback modal
  // ---------------------------------------------------------------------------

  async function openFeedback(question: Question) {
    setFeedbackQuestion(question)
    setFeedbackItems([])
    setLoadingFeedback(true)

    try {
      const { data, error: fbErr } = await supabase
        .from('question_feedback')
        .select('id, difficulty_rating, quality_rating, feedback_text, created_at, users!inner(email)')
        .eq('question_id', question.id)
        .order('created_at', { ascending: false })

      if (fbErr) throw fbErr

      setFeedbackItems(
        (data || []).map((f: any) => ({
          id: f.id,
          user_email: f.users?.email || 'Unknown',
          difficulty_rating: f.difficulty_rating,
          quality_rating: f.quality_rating,
          feedback_text: f.feedback_text,
          created_at: f.created_at,
        }))
      )
    } catch (err: any) {
      console.error('Load feedback error:', err)
    } finally {
      setLoadingFeedback(false)
    }
  }

  function closeFeedback() {
    setFeedbackQuestion(null)
    setFeedbackItems([])
  }

  // ---------------------------------------------------------------------------
  // Bulk import
  // ---------------------------------------------------------------------------

  function openImportModal() {
    setShowImportModal(true)
    setImportFile(null)
    setImportData(null)
    setImportErrors([])
    setImportSuccess(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function closeImportModal() {
    setShowImportModal(false)
    setImportFile(null)
    setImportData(null)
    setImportErrors([])
    setImportSuccess(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setImportFile(file)
    setImportData(null)
    setImportErrors([])
    setImportSuccess(null)

    if (!file.name.endsWith('.json')) {
      setImportErrors(['File must be a .json file'])
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setImportErrors(['File too large. Maximum size is 5MB'])
      return
    }

    try {
      const text = await file.text()
      const json = JSON.parse(text)
      const result = bulkImportSchema.safeParse(json)
      if (!result.success) {
        setImportErrors(result.error.errors.map(err =>
          `${err.path.join('.') || 'Root'}: ${err.message}`
        ))
        return
      }
      setImportData(result.data)
    } catch (err: any) {
      if (err instanceof SyntaxError) {
        setImportErrors(['Invalid JSON file. Please check the file format.'])
      } else {
        setImportErrors([err.message || 'Failed to read file'])
      }
    }
  }

  async function handleImport() {
    if (!importData || !user) return

    setImporting(true)
    setImportErrors([])
    setImportSuccess(null)

    try {
      // Find or create topic
      let topicId: string
      const existingTopic = topics.find(t => t.name.toLowerCase() === importData.topic.toLowerCase())

      if (existingTopic) {
        topicId = existingTopic.id
      } else {
        const { data: newTopic, error: topicError } = await supabase
          .from('topics')
          .insert({ name: importData.topic.trim() })
          .select()
          .single()
        if (topicError) throw new Error(`Failed to create topic: ${topicError.message}`)
        topicId = newTopic.id
      }

      // Insert questions in batches
      const BATCH_SIZE = 50
      let successCount = 0
      const errors: string[] = []

      for (let i = 0; i < importData.questions.length; i += BATCH_SIZE) {
        const batch = importData.questions.slice(i, i + BATCH_SIZE)

        for (const [idx, q] of batch.entries()) {
          try {
            const { data: question, error: qError } = await supabase
              .from('questions')
              .insert({
                topic_id: topicId,
                question_text: q.question_text.trim(),
                explanation_text: q.explanation_text?.trim() || null,
                difficulty_level: q.difficulty_level || null,
                created_by_admin_id: user.id,
              })
              .select()
              .single()

            if (qError) throw qError

            const choicesData = q.answer_choices.map(c => ({
              question_id: question.id,
              choice_letter: c.letter,
              choice_text: c.text.trim(),
              is_correct: c.is_correct,
            }))

            const { error: cError } = await supabase.from('answer_choices').insert(choicesData)

            if (cError) {
              await supabase.from('questions').delete().eq('id', question.id)
              throw cError
            }

            successCount++
          } catch (err: any) {
            errors.push(`Question ${i + idx + 1}: ${err.message}`)
          }
        }
      }

      if (successCount > 0) {
        setImportSuccess({ count: successCount, topic: importData.topic })
        await loadQuestions()
      }
      if (errors.length > 0) {
        setImportErrors(errors)
      }
      if (successCount === importData.questions.length) {
        setTimeout(() => closeImportModal(), 2000)
      }
    } catch (err: any) {
      console.error('Import error:', err)
      setImportErrors([err.message || 'Failed to import questions'])
    } finally {
      setImporting(false)
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
            onClick={() => { setImportTab('docx'); openImportModal() }}
            className="bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 transition-colors font-medium"
          >
            Import DOCX
          </button>
          <button
            onClick={() => { setImportTab('json'); openImportModal() }}
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
                    onClick={() => openFeedback(q)}
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
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full my-8">
            <div className="p-6 space-y-5">
              {/* Header */}
              <div className="flex items-start justify-between border-b pb-4">
                <div className="flex-1 pr-4">
                  <h3 className="text-lg font-bold text-gray-900 mb-1">Question Feedback</h3>
                  <p className="text-sm text-gray-600 line-clamp-2">{feedbackQuestion.question_text}</p>
                </div>
                <button
                  type="button"
                  onClick={closeFeedback}
                  className="text-gray-400 hover:text-gray-600 text-2xl leading-none flex-shrink-0"
                >
                  ×
                </button>
              </div>

              {loadingFeedback ? (
                <p className="text-gray-500 text-sm py-4 text-center">Loading feedback...</p>
              ) : feedbackItems.length === 0 ? (
                <p className="text-gray-500 text-sm py-4 text-center">No feedback submitted for this question yet.</p>
              ) : (
                <>
                  {/* Summary bar */}
                  <div className="flex gap-6 bg-gray-50 rounded-lg px-4 py-3 text-sm">
                    <span className="text-gray-600">
                      <span className="font-semibold text-gray-900">{feedbackItems.length}</span> response{feedbackItems.length !== 1 ? 's' : ''}
                    </span>
                    {(() => {
                      const withDiff = feedbackItems.filter(f => f.difficulty_rating)
                      const withQual = feedbackItems.filter(f => f.quality_rating)
                      const withText = feedbackItems.filter(f => f.feedback_text?.trim())
                      return (
                        <>
                          {withDiff.length > 0 && (
                            <span className="text-gray-600">
                              Avg difficulty: <span className="font-semibold text-gray-900">
                                {(withDiff.reduce((s, f) => s + f.difficulty_rating!, 0) / withDiff.length).toFixed(1)}/5
                              </span>
                            </span>
                          )}
                          {withQual.length > 0 && (
                            <span className="text-gray-600">
                              Avg quality: <span className="font-semibold text-gray-900">
                                {(withQual.reduce((s, f) => s + f.quality_rating!, 0) / withQual.length).toFixed(1)}/5
                              </span>
                            </span>
                          )}
                          {withText.length > 0 && (
                            <span className="text-gray-600">
                              <span className="font-semibold text-gray-900">{withText.length}</span> written comment{withText.length !== 1 ? 's' : ''}
                            </span>
                          )}
                        </>
                      )
                    })()}
                  </div>

                  {/* Written comments — shown first and prominently */}
                  {(() => {
                    const withComments = feedbackItems.filter(f => f.feedback_text?.trim())
                    if (withComments.length === 0) return null
                    return (
                      <div>
                        <h4 className="text-sm font-semibold text-gray-700 mb-2">
                          Written Comments ({withComments.length})
                        </h4>
                        <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
                          {withComments.map(f => (
                            <div key={f.id} className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                              <p className="text-sm text-gray-800">{f.feedback_text}</p>
                              <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
                                <span>{f.user_email}</span>
                                <span>·</span>
                                <span>{new Date(f.created_at).toLocaleDateString()}</span>
                                {f.difficulty_rating && <span>· Difficulty: {f.difficulty_rating}/5</span>}
                                {f.quality_rating && <span>· Quality: {f.quality_rating}/5</span>}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  })()}

                  {/* Ratings-only responses */}
                  {(() => {
                    const ratingsOnly = feedbackItems.filter(f => !f.feedback_text?.trim() && (f.difficulty_rating || f.quality_rating))
                    if (ratingsOnly.length === 0) return null
                    return (
                      <div>
                        <h4 className="text-sm font-semibold text-gray-700 mb-2">
                          Ratings Only ({ratingsOnly.length})
                        </h4>
                        <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                          {ratingsOnly.map(f => (
                            <div key={f.id} className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs text-gray-600">
                              <span>{f.user_email}</span>
                              <div className="flex gap-3">
                                {f.difficulty_rating && <span>Difficulty: {f.difficulty_rating}/5</span>}
                                {f.quality_rating && <span>Quality: {f.quality_rating}/5</span>}
                                <span>{new Date(f.created_at).toLocaleDateString()}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  })()}
                </>
              )}

              <div className="flex justify-end border-t pt-4">
                <button
                  type="button"
                  onClick={closeFeedback}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
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
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full my-8">
            <div className="p-6 space-y-6">
              <div className="flex items-center justify-between pb-4 border-b">
                <div>
                  <h3 className="text-xl font-bold text-gray-900">Import Questions</h3>
                  <p className="text-sm text-gray-600 mt-1">Import from JSON or DOCX files</p>
                </div>
                <button
                  type="button"
                  onClick={closeImportModal}
                  disabled={importing}
                  className="text-gray-400 hover:text-gray-600 text-2xl leading-none disabled:opacity-50"
                >
                  ×
                </button>
              </div>

              {/* Tab nav */}
              <div className="flex gap-2 border-b">
                {(['json', 'docx'] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setImportTab(tab)}
                    className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
                      importTab === tab
                        ? 'border-blue-600 text-blue-600'
                        : 'border-transparent text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    {tab === 'json' ? 'JSON Import' : 'DOCX Import'}
                  </button>
                ))}
              </div>

              {importTab === 'json' ? (
                <div className="space-y-6">
                  {importSuccess && (
                    <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg">
                      ✓ Successfully imported {importSuccess.count} question{importSuccess.count !== 1 ? 's' : ''} to topic "{importSuccess.topic}"
                    </div>
                  )}
                  {importErrors.length > 0 && (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-4 max-h-64 overflow-y-auto">
                      <p className="font-medium text-red-700 mb-2">Errors ({importErrors.length}):</p>
                      <ul className="space-y-1 text-sm text-red-600">
                        {importErrors.map((err, idx) => (
                          <li key={idx} className="flex gap-2">
                            <span className="flex-shrink-0">•</span>
                            <span>{err}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Select JSON File</label>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".json"
                      onChange={handleFileSelect}
                      disabled={importing}
                      className="block w-full text-sm text-gray-600 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 disabled:opacity-50"
                    />
                    <p className="text-xs text-gray-500 mt-2">Maximum file size: 5MB. Format must match the JSON schema.</p>
                  </div>

                  {importData && (
                    <div className="border border-gray-200 rounded-lg p-4 bg-gray-50 space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="font-semibold text-gray-900">Preview</h4>
                        <span className="text-sm text-gray-600">
                          {importData.questions.length} question{importData.questions.length !== 1 ? 's' : ''}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div>
                          <span className="text-gray-600">Topic:</span>
                          <span className="ml-2 font-medium text-gray-900">{importData.topic}</span>
                        </div>
                        <div>
                          <span className="text-gray-600">Status:</span>
                          <span className="ml-2 font-medium text-green-600">
                            {topics.find(t => t.name.toLowerCase() === importData.topic.toLowerCase())
                              ? 'Existing topic'
                              : 'Will create new topic'}
                          </span>
                        </div>
                      </div>
                      <div className="space-y-2 mt-4">
                        <p className="text-xs font-medium text-gray-600 uppercase">
                          First {Math.min(3, importData.questions.length)} Questions:
                        </p>
                        {importData.questions.slice(0, 3).map((q, idx) => (
                          <div key={idx} className="bg-white border border-gray-200 rounded p-3 text-sm">
                            <p className="font-medium text-gray-900 line-clamp-2">{q.question_text}</p>
                            <div className="mt-2 space-y-1">
                              {q.answer_choices.map(c => (
                                <div key={c.letter} className="flex items-start gap-2 text-xs">
                                  <span className={`font-medium ${c.is_correct ? 'text-green-600' : 'text-gray-500'}`}>
                                    {c.letter}.
                                  </span>
                                  <span className={c.is_correct ? 'text-green-600 font-medium' : 'text-gray-600'}>
                                    {c.text}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                        {importData.questions.length > 3 && (
                          <p className="text-xs text-gray-500 italic text-center">
                            ... and {importData.questions.length - 3} more
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  <details className="text-sm">
                    <summary className="cursor-pointer text-blue-600 hover:text-blue-700 font-medium">
                      Show JSON format example
                    </summary>
                    <pre className="mt-2 bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto text-xs">
{`{
  "topic": "Accounting",
  "questions": [
    {
      "question_text": "What is the accounting equation?",
      "difficulty_level": 1,
      "explanation_text": "The fundamental equation shows...",
      "answer_choices": [
        { "letter": "A", "text": "Assets = Liabilities + Equity", "is_correct": true },
        { "letter": "B", "text": "Assets = Liabilities - Equity", "is_correct": false },
        { "letter": "C", "text": "Assets + Liabilities = Equity", "is_correct": false },
        { "letter": "D", "text": "Assets = Revenue - Expenses",  "is_correct": false }
      ]
    }
  ]
}`}
                    </pre>
                  </details>

                  <div className="flex justify-end gap-3 pt-4 border-t">
                    <button
                      type="button"
                      onClick={closeImportModal}
                      disabled={importing}
                      className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleImport}
                      disabled={!importData || importing}
                      className="bg-green-600 text-white px-6 py-2 rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors font-medium"
                    >
                      {importing ? 'Importing...' : `Import ${importData?.questions.length || 0} Questions`}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <DocxImport />
                  <DocxImportFBLA />
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}