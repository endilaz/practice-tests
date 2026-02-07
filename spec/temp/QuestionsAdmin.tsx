import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { questionSchema, type QuestionFormData } from './question.schema'
import { useAuth } from '@/auth/useAuth'

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

  async function updateQuestion(questionId: string, data: QuestionFormData) {
    // Step 1: Backup existing choices in case update fails
    const { data: backupChoices, error: backupError } = await supabase
      .from('answer_choices')
      .select('*')
      .eq('question_id', questionId)

    if (backupError) throw new Error('Failed to load existing choices')

    // Step 2: Update question metadata
    const { error: qError } = await supabase
      .from('questions')
      .update({
        topic_id: data.topic_id,
        question_text: data.question_text.trim(),
        explanation_text: data.explanation_text?.trim() || null,
        difficulty_level: data.difficulty_level,
      })
      .eq('id', questionId)

    if (qError) throw qError

    // Step 3: Replace all choices (delete + insert)
    const { error: deleteError } = await supabase
      .from('answer_choices')
      .delete()
      .eq('question_id', questionId)

    if (deleteError) throw deleteError

    const choicesData = data.choices.map(c => ({
      question_id: questionId,
      choice_letter: c.letter,
      choice_text: c.text.trim(),
      is_correct: c.is_correct,
    }))

    const { error: cError } = await supabase.from('answer_choices').insert(choicesData)
    
    if (cError) {
      // CRITICAL: Restore backup choices to prevent zero-choice state
      if (backupChoices && backupChoices.length > 0) {
        await supabase.from('answer_choices').insert(
          backupChoices.map(({ id, ...rest }) => rest) // Remove id to allow re-insert
        )
      }
      throw new Error('Failed to update choices. Original choices have been restored.')
    }
  }

  async function handleDelete(questionId: string) {
    setDeleting(true)
    
    try {
      const { error } = await supabase.from('questions').delete().eq('id', questionId)
      if (error) throw error
      
      setDeleteConfirm(null)
      await loadData()
    } catch (err: any) {
      console.error('Delete error:', err)
      setError(err.message || 'Failed to delete question')
    } finally {
      setDeleting(false)
    }
  }

  // Loading screen
  if (loading) {
    return (
      <div className="p-6">
        <p className="text-gray-600">Loading questions...</p>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900">Questions</h2>
        <button
          type="button"
          onClick={openCreateForm}
          disabled={topics.length === 0}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          Create Question
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* No topics warning */}
      {topics.length === 0 && (
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded-lg">
          No topics exist. Please create a topic first before adding questions.
        </div>
      )}

      {/* Questions table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Question
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Topic
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Difficulty
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {questions.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-6 py-8 text-center text-gray-500">
                  No questions yet. Create one to get started.
                </td>
              </tr>
            ) : (
              questions.map(q => (
                <tr key={q.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4">
                    <p className="text-sm text-gray-900 line-clamp-2">{q.question_text}</p>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">{q.topics.name}</td>
                  <td className="px-6 py-4 text-sm text-gray-600 text-center">
                    {q.difficulty_level ? (
                      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100">
                        {q.difficulty_level}/5
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-sm space-x-3">
                    <button
                      type="button"
                      onClick={() => openEditForm(q.id)}
                      className="text-blue-600 hover:text-blue-800 font-medium"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteConfirm(q.id)}
                      className="text-red-600 hover:text-red-800 font-medium"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Create/Edit Form Modal - Part 1 */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-xl max-w-3xl w-full my-8">
            <form onSubmit={handleSubmit} className="p-6 space-y-6">
              {/* Modal Header */}
              <div className="flex justify-between items-center pb-4 border-b">
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
    </div>
  )
}