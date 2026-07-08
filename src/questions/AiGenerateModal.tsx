/*
 * AiGenerateModal.tsx
 * Admin flow for AI-generated questions: pick a topic + count, call the
 * generate-questions Edge Function (which uses the topic's existing questions
 * as reference), then review each candidate — edit, approve, or discard —
 * before anything is inserted. Approved candidates insert with
 * is_ai_generated = true via the shared insertQuestion path.
 */
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/auth/useAuth'
import { questionSchema, type QuestionFormData } from './question.schema'
import { aiGenerateResponseSchema } from './aiCandidate.schema'
import { insertQuestion } from './insertQuestion'

type Topic = { id: string; name: string }

type CandidateStatus = 'pending' | 'approving' | 'approved' | 'discarded'

type EditableCandidate = {
  form: QuestionFormData
  status: CandidateStatus
  error: string | null
}

export type AiGenerateModalProps = {
  topics: Topic[]
  onClose: () => void
  onImported: () => void
}

const MAX_COUNT = 10

export function AiGenerateModal({ topics, onClose, onImported }: AiGenerateModalProps) {
  const { user } = useAuth()

  const [topicId, setTopicId] = useState('')
  const [count, setCount] = useState(5)
  const [generating, setGenerating] = useState(false)
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [candidates, setCandidates] = useState<EditableCandidate[]>([])
  const [approvedCount, setApprovedCount] = useState(0)

  function close() {
    if (approvedCount > 0) onImported()
    onClose()
  }

  // ---------------------------------------------------------------------------
  // Generate — call the Edge Function and map candidates into editable forms
  // ---------------------------------------------------------------------------
  async function handleGenerate() {
    if (!topicId || generating) return
    setGenerating(true)
    setGenerateError(null)
    setCandidates([])

    try {
      const { data, error } = await supabase.functions.invoke('generate-questions', {
        body: { topic_id: topicId, count },
      })

      if (error) {
        // FunctionsHttpError carries the HTTP response — surface the server's message
        let message = error.message || 'Generation failed'
        const context = (error as { context?: Response }).context
        if (context && typeof context.json === 'function') {
          try {
            const body = await context.json()
            if (body?.error) message = body.error
          } catch { /* keep the generic message */ }
        }
        throw new Error(message)
      }

      const parsed = aiGenerateResponseSchema.safeParse(data)
      if (!parsed.success) {
        throw new Error('The generator returned an unexpected response. Try again.')
      }

      setCandidates(parsed.data.candidates.map(c => ({
        form: {
          topic_id: topicId,
          question_text: c.question_text,
          explanation_text: c.explanation_text,
          difficulty_level: null,
          choices: [...c.choices].sort((a, b) => a.letter.localeCompare(b.letter)),
        },
        status: 'pending',
        error: null,
      })))
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : 'Generation failed')
    } finally {
      setGenerating(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Candidate editing
  // ---------------------------------------------------------------------------
  function updateCandidate(index: number, update: (form: QuestionFormData) => QuestionFormData) {
    setCandidates(prev =>
      prev.map((c, i) => (i === index ? { ...c, form: update(c.form) } : c))
    )
  }

  function setCandidateState(index: number, patch: Partial<EditableCandidate>) {
    setCandidates(prev => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)))
  }

  // ---------------------------------------------------------------------------
  // Approve / discard
  // ---------------------------------------------------------------------------
  async function approveCandidate(index: number): Promise<boolean> {
    if (!user) return false
    const candidate = candidates[index]
    if (!candidate || candidate.status !== 'pending') return false

    const result = questionSchema.safeParse(candidate.form)
    if (!result.success) {
      setCandidateState(index, { error: result.error.issues[0]?.message || 'Invalid question' })
      return false
    }

    setCandidateState(index, { status: 'approving', error: null })
    try {
      await insertQuestion(result.data, user.id, { isAiGenerated: true })
      setCandidateState(index, { status: 'approved' })
      setApprovedCount(n => n + 1)
      return true
    } catch (err) {
      setCandidateState(index, {
        status: 'pending',
        error: err instanceof Error ? err.message : 'Failed to save question',
      })
      return false
    }
  }

  async function approveAll() {
    for (let i = 0; i < candidates.length; i++) {
      if (candidates[i].status === 'pending') {
        await approveCandidate(i)
      }
    }
  }

  const pendingCount = candidates.filter(c => c.status === 'pending').length

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-xl max-w-3xl w-full my-8">
        <div className="p-6 space-y-6">

          {/* Header */}
          <div className="flex items-center justify-between pb-4 border-b">
            <div>
              <h3 className="text-xl font-bold text-gray-900">Generate Questions with AI</h3>
              <p className="text-sm text-gray-600 mt-1">
                Uses this topic's existing questions as reference. Review each candidate before it's added —
                approved questions are marked as AI-generated.
              </p>
            </div>
            <button
              type="button"
              onClick={close}
              className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
            >
              ×
            </button>
          </div>

          {/* Controls */}
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-48">
              <label className="block text-sm font-medium text-gray-700 mb-1">Topic</label>
              <select
                value={topicId}
                onChange={e => setTopicId(e.target.value)}
                disabled={generating}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select a topic</option>
                {topics.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Count</label>
              <input
                type="number"
                min={1}
                max={MAX_COUNT}
                value={count}
                onChange={e => setCount(Math.min(Math.max(parseInt(e.target.value) || 1, 1), MAX_COUNT))}
                disabled={generating}
                className="w-20 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <button
              type="button"
              onClick={handleGenerate}
              disabled={!topicId || generating}
              className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors font-medium"
            >
              {generating ? 'Generating…' : candidates.length > 0 ? 'Generate More' : 'Generate'}
            </button>
          </div>

          {generateError && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              {generateError}
            </div>
          )}

          {generating && (
            <p className="text-sm text-gray-500">Asking the model for {count} question{count !== 1 ? 's' : ''}… this usually takes a few seconds.</p>
          )}

          {/* Candidate list */}
          {candidates.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-gray-600">
                  {pendingCount} pending · {approvedCount} approved
                </p>
                {pendingCount > 1 && (
                  <button
                    type="button"
                    onClick={approveAll}
                    className="text-sm text-green-700 border border-green-300 px-3 py-1.5 rounded-lg hover:bg-green-50 transition-colors font-medium"
                  >
                    Approve all remaining
                  </button>
                )}
              </div>

              {candidates.map((candidate, idx) => {
                if (candidate.status === 'discarded') return null
                const approved = candidate.status === 'approved'
                const busy = candidate.status === 'approving'

                return (
                  <div
                    key={idx}
                    className={`border rounded-lg p-4 space-y-3 ${
                      approved ? 'border-green-300 bg-green-50' : 'border-gray-200'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-wider text-indigo-600">
                        AI Candidate {idx + 1}
                      </span>
                      {approved && (
                        <span className="text-xs font-medium text-green-700">✓ Added to question pool</span>
                      )}
                    </div>

                    {candidate.error && (
                      <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">
                        {candidate.error}
                      </div>
                    )}

                    {/* Question text */}
                    <textarea
                      value={candidate.form.question_text}
                      onChange={e => updateCandidate(idx, f => ({ ...f, question_text: e.target.value }))}
                      disabled={approved || busy}
                      rows={3}
                      maxLength={2000}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none text-sm disabled:bg-gray-50 disabled:text-gray-500"
                    />

                    {/* Choices */}
                    <div className="space-y-2">
                      {candidate.form.choices.map((choice, cIdx) => (
                        <div key={choice.letter} className="flex items-center gap-2">
                          <input
                            type="radio"
                            name={`ai-correct-${idx}`}
                            checked={choice.is_correct}
                            disabled={approved || busy}
                            onChange={() =>
                              updateCandidate(idx, f => ({
                                ...f,
                                choices: f.choices.map((c, i) => ({ ...c, is_correct: i === cIdx })),
                              }))
                            }
                            className="w-4 h-4 text-blue-600 flex-shrink-0"
                            title="Mark as correct answer"
                          />
                          <span className="font-bold text-gray-700 text-sm w-5 flex-shrink-0">{choice.letter}.</span>
                          <input
                            type="text"
                            value={choice.text}
                            disabled={approved || busy}
                            onChange={e =>
                              updateCandidate(idx, f => {
                                const newChoices = [...f.choices]
                                newChoices[cIdx] = { ...newChoices[cIdx], text: e.target.value }
                                return { ...f, choices: newChoices }
                              })
                            }
                            maxLength={500}
                            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm disabled:bg-gray-50 disabled:text-gray-500"
                          />
                        </div>
                      ))}
                    </div>

                    {/* Explanation */}
                    <textarea
                      value={candidate.form.explanation_text}
                      onChange={e => updateCandidate(idx, f => ({ ...f, explanation_text: e.target.value }))}
                      disabled={approved || busy}
                      rows={2}
                      maxLength={2000}
                      placeholder="Explanation (optional)"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none text-sm disabled:bg-gray-50 disabled:text-gray-500"
                    />

                    {/* Actions */}
                    {!approved && (
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setCandidateState(idx, { status: 'discarded' })}
                          disabled={busy}
                          className="px-3 py-1.5 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors"
                        >
                          Discard
                        </button>
                        <button
                          type="button"
                          onClick={() => approveCandidate(idx)}
                          disabled={busy}
                          className="px-4 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors font-medium"
                        >
                          {busy ? 'Adding…' : 'Approve'}
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Footer */}
          <div className="flex justify-end pt-4 border-t">
            <button
              type="button"
              onClick={close}
              className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
