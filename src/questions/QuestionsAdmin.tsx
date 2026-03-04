import { useEffect, useState, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { questionSchema, bulkImportSchema, type QuestionFormData, type BulkImportData } from './question.schema'
import { useAuth } from '@/auth/useAuth'
import { DocxImport } from './DocxImport'

// Types matching database schema exactly
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

const LETTERS = ['A', 'B', 'C', 'D'] as const

export default function QuestionsAdmin() {
  const { user } = useAuth()
  
  // Data state
  const [topics, setTopics] = useState<Topic[]>([])
  const [questions, setQuestions] = useState<Question[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Form state
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formData, setFormData] = useState<QuestionFormData>({
    topic_id: '',
    question_text: '',
    explanation_text: '',
    difficulty_level: null,
    choices: LETTERS.map(letter => ({ letter, text: '', is_correct: false })),
  })
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)

  // Delete confirmation
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Bulk import state
  const [showImportModal, setShowImportModal] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importData, setImportData] = useState<BulkImportData | null>(null)
  const [importErrors, setImportErrors] = useState<string[]>([])
  const [importing, setImporting] = useState(false)
  const [importSuccess, setImportSuccess] = useState<{ count: number; topic: string } | null>(null)
  const [importTab, setImportTab] = useState<'json' | 'docx'>('json')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Load data on mount
  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    setError(null)

    try {
      // Load topics and questions in parallel
      const [topicsRes, questionsRes] = await Promise.all([
        supabase.from('topics').select('id, name').order('name'),
        supabase
          .from('questions')
          .select('id, topic_id, question_text, explanation_text, difficulty_level, created_at, topics!inner(name)')
          .order('created_at', { ascending: false }),
      ])

      if (topicsRes.error) throw topicsRes.error
      if (questionsRes.error) throw questionsRes.error

      setTopics(topicsRes.data as Topic[])
      setQuestions(questionsRes.data as Question[])
    } catch (err: any) {
      console.error('Load error:', err)
      setError(err.message || 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }

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

    // Load question and choices
    const [questionRes, choicesRes] = await Promise.all([
      supabase.from('questions').select('*').eq('id', questionId).single(),
      supabase
        .from('answer_choices')
        .select('*')
        .eq('question_id', questionId)
        .order('choice_letter'),
    ])

    if (questionRes.error || choicesRes.error) {
      setError('Failed to load question for editing')
      setShowForm(false)
      return
    }

    const q = questionRes.data
    const choices = choicesRes.data as AnswerChoice[]

    // Map database choices back to form structure
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

    // Client-side validation with Zod
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
      await loadData()
    } catch (err: any) {
      console.error('Submit error:', err)
      setFormErrors({ submit: err.message || 'Failed to save question' })
    } finally {
      setSubmitting(false)
    }
  }

  async function createQuestion(data: QuestionFormData) {
    if (!user) throw new Error('Not authenticated')

    // Step 1: Insert question
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

    // Step 2: Insert all 4 choices
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
    // Step 1: Update question
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

    // Step 2: Delete existing choices and insert new ones
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
      await loadData()
      setDeleteConfirm(null)
    } catch (err: any) {
      console.error('Delete error:', err)
      setError(err.message || 'Failed to delete question')
    } finally {
      setDeleting(false)
    }
  }

  // Bulk Import Functions
  function openImportModal() {
    setShowImportModal(true)
    setImportFile(null)
    setImportData(null)
    setImportErrors([])
    setImportSuccess(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  function closeImportModal() {
    setShowImportModal(false)
    setImportFile(null)
    setImportData(null)
    setImportErrors([])
    setImportSuccess(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setImportFile(file)
    setImportData(null)
    setImportErrors([])
    setImportSuccess(null)

    // Validate file type
    if (!file.name.endsWith('.json')) {
      setImportErrors(['File must be a .json file'])
      return
    }

    // Validate file size (5MB max)
    if (file.size > 5 * 1024 * 1024) {
      setImportErrors(['File too large. Maximum size is 5MB'])
      return
    }

    // Read and parse file
    try {
      const text = await file.text()
      const json = JSON.parse(text)

      // Validate against schema
      const result = bulkImportSchema.safeParse(json)
      if (!result.success) {
        const errors = result.error.errors.map(err => 
          `${err.path.join('.') || 'Root'}: ${err.message}`
        )
        setImportErrors(errors)
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
      // Step 1: Find or create topic
      let topicId: string
      
      const existingTopic = topics.find(t => t.name.toLowerCase() === importData.topic.toLowerCase())
      
      if (existingTopic) {
        topicId = existingTopic.id
      } else {
        // Create new topic
        const { data: newTopic, error: topicError } = await supabase
          .from('topics')
          .insert({ name: importData.topic.trim() })
          .select()
          .single()

        if (topicError) throw new Error(`Failed to create topic: ${topicError.message}`)
        topicId = newTopic.id
      }

      // Step 2: Insert all questions (batch by batch for safety)
      const BATCH_SIZE = 50
      let successCount = 0
      const errors: string[] = []

      for (let i = 0; i < importData.questions.length; i += BATCH_SIZE) {
        const batch = importData.questions.slice(i, i + BATCH_SIZE)

        for (const [idx, q] of batch.entries()) {
          try {
            // Insert question
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

            // Insert answer choices
            const choicesData = q.answer_choices.map(c => ({
              question_id: question.id,
              choice_letter: c.letter,
              choice_text: c.text.trim(),
              is_correct: c.is_correct,
            }))

            const { error: cError } = await supabase
              .from('answer_choices')
              .insert(choicesData)

            if (cError) {
              // Rollback: delete the question
              await supabase.from('questions').delete().eq('id', question.id)
              throw cError
            }

            successCount++
          } catch (err: any) {
            const questionNum = i + idx + 1
            errors.push(`Question ${questionNum}: ${err.message}`)
          }
        }
      }

      if (successCount > 0) {
        setImportSuccess({ count: successCount, topic: importData.topic })
        await loadData()
      }

      if (errors.length > 0) {
        setImportErrors(errors)
      }

      if (successCount === importData.questions.length) {
        // Full success - close modal after delay
        setTimeout(() => {
          closeImportModal()
        }, 2000)
      }
    } catch (err: any) {
      console.error('Import error:', err)
      setImportErrors([err.message || 'Failed to import questions'])
    } finally {
      setImporting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-gray-600">Loading questions...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Questions</h2>
          <p className="text-sm text-gray-600 mt-1">
            Manage test questions and answer choices
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => {
              setImportTab('docx')
              openImportModal()
            }}
            className="bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 transition-colors font-medium"
          >
            Import DOCX
          </button>
          <button
            onClick={() => {
              setImportTab('json')
              openImportModal()
            }}
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

      {/* Error Display */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Questions List */}
      {questions.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
          <p className="text-gray-600">No questions created yet</p>
          <button
            onClick={openCreateForm}
            className="mt-4 text-blue-600 hover:text-blue-700 font-medium"
          >
            Create your first question
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

      {/* Create/Edit Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-xl max-w-3xl w-full my-8">
            <form onSubmit={handleSubmit} className="p-6 space-y-6">
              {/* Form Header */}
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

              {/* Submit Error */}
              {formErrors.submit && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                  {formErrors.submit}
                </div>
              )}

              {/* Topic Selection */}
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
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
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
                  <p className="text-xs text-gray-500">
                    {formData.question_text.length} / 2000 characters
                  </p>
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
                <p className="text-xs text-gray-500 mb-3">
                  Select the radio button next to the correct answer
                </p>
                <div className="space-y-3">
                  {formData.choices.map((choice, idx) => (
                    <div key={choice.letter} className="flex items-start gap-2">
                      {/* Correct answer radio */}
                      <div className="flex items-center h-10">
                        <input
                          type="radio"
                          name="correct-choice"
                          checked={choice.is_correct}
                          onChange={() => {
                            setFormData({
                              ...formData,
                              choices: formData.choices.map((c, i) => ({
                                ...c,
                                is_correct: i === idx,
                              })),
                            })
                          }}
                          className="w-4 h-4 text-blue-600"
                          title="Mark as correct answer"
                        />
                      </div>
                      
                      {/* Choice input */}
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-gray-700 text-sm w-5">
                            {choice.letter}.
                          </span>
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

              {/* Explanation (Optional) */}
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
                <p className="text-xs text-gray-500 mt-1">
                  Shown to users after they submit the test
                </p>
              </div>

              {/* Difficulty Level (Optional) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Difficulty Level (optional)
                </label>
                <select
                  value={formData.difficulty_level ?? ''}
                  onChange={e =>
                    setFormData({
                      ...formData,
                      difficulty_level: e.target.value ? parseInt(e.target.value) : null,
                    })
                  }
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

              {/* Form Actions */}
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
                  {submitting ? (editingId ? 'Updating...' : 'Creating...') : (editingId ? 'Update Question' : 'Create Question')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
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

      {/* Bulk Import Modal with Tabs */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full my-8">
            <div className="p-6 space-y-6">
              {/* Modal Header */}
              <div className="flex items-center justify-between pb-4 border-b">
                <div>
                  <h3 className="text-xl font-bold text-gray-900">Import Questions</h3>
                  <p className="text-sm text-gray-600 mt-1">
                    Import from JSON or DOCX files
                  </p>
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

              {/* Tab Navigation */}
              <div className="flex gap-2 border-b">
                <button
                  onClick={() => setImportTab('json')}
                  className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
                    importTab === 'json'
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-gray-600 hover:text-gray-900'
                  }`}
                >
                  JSON Import
                </button>
                <button
                  onClick={() => setImportTab('docx')}
                  className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
                    importTab === 'docx'
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-gray-600 hover:text-gray-900'
                  }`}
                >
                  DOCX Import
                </button>
              </div>

              {/* Tab Content */}
              {importTab === 'json' ? (
                <div className="space-y-6">
                  {/* Success Message */}
                  {importSuccess && (
                    <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg">
                      ✓ Successfully imported {importSuccess.count} question{importSuccess.count !== 1 ? 's' : ''} to topic "{importSuccess.topic}"
                    </div>
                  )}

                  {/* Errors */}
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

                  {/* File Input */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Select JSON File
                    </label>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".json"
                      onChange={handleFileSelect}
                      disabled={importing}
                      className="block w-full text-sm text-gray-600 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 disabled:opacity-50"
                    />
                    <p className="text-xs text-gray-500 mt-2">
                      Maximum file size: 5MB. Format must match the JSON schema.
                    </p>
                  </div>

                  {/* Preview */}
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

                      {/* Show first 3 questions preview */}
                      <div className="space-y-2 mt-4">
                        <p className="text-xs font-medium text-gray-600 uppercase">First {Math.min(3, importData.questions.length)} Questions:</p>
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

                  {/* Format Example */}
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
        {
          "letter": "A",
          "text": "Assets = Liabilities + Equity",
          "is_correct": true
        },
        {
          "letter": "B",
          "text": "Assets = Liabilities - Equity",
          "is_correct": false
        },
        {
          "letter": "C",
          "text": "Assets + Liabilities = Equity",
          "is_correct": false
        },
        {
          "letter": "D",
          "text": "Assets = Revenue - Expenses",
          "is_correct": false
        }
      ]
    }
  ]
}`}
                </pre>
              </details>

              {/* Actions */}
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
            // DOCX Import Component
            <DocxImport />
          )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}