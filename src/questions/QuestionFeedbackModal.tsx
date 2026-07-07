/*
 * QuestionFeedbackModal.tsx
 * Admin modal showing all user feedback for one question — summary averages,
 * written comments, and ratings-only responses. Fetches its own data on mount;
 * extracted from QuestionsAdmin.tsx.
 */
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

type QuestionFeedback = {
  id: string
  user_email: string
  difficulty_rating: number | null
  quality_rating: number | null
  feedback_text: string | null
  created_at: string
}

export function QuestionFeedbackModal({
  question,
  onClose,
}: {
  question: { id: string; question_text: string }
  onClose: () => void
}) {
  const [feedbackItems, setFeedbackItems] = useState<QuestionFeedback[]>([])
  const [loadingFeedback, setLoadingFeedback] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function loadFeedback() {
      setLoadingFeedback(true)
      try {
        // users(email) is a LEFT join on purpose. With users!inner(email), RLS
        // on the users table silently filters out feedback rows whose author
        // row the admin cannot read — the whole list comes back empty. With a
        // left join the feedback row survives and the email is just null.
        const { data, error: fbErr } = await supabase
          .from('question_feedback')
          .select('id, difficulty_rating, quality_rating, feedback_text, created_at, users(email)')
          .eq('question_id', question.id)
          .order('created_at', { ascending: false })

        if (fbErr) throw fbErr
        if (cancelled) return

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
        if (!cancelled) setLoadingFeedback(false)
      }
    }

    loadFeedback()
    return () => { cancelled = true }
  }, [question.id])

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full my-8">
        <div className="p-6 space-y-5">
          {/* Header */}
          <div className="flex items-start justify-between border-b pb-4">
            <div className="flex-1 pr-4">
              <h3 className="text-lg font-bold text-gray-900 mb-1">Question Feedback</h3>
              <p className="text-sm text-gray-600 line-clamp-2">{question.question_text}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
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
              onClick={onClose}
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
