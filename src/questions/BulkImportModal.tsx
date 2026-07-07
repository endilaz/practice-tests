/*
 * BulkImportModal.tsx
 * Admin modal for bulk-importing questions — a JSON tab (schema-validated
 * file upload with preview) and a DOCX tab (generic + FBLA study guide
 * importers). Extracted from QuestionsAdmin.tsx.
 */
import { useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/auth/useAuth'
import { bulkImportSchema, type BulkImportData } from './question.schema'
import { DocxImport } from './DocxImport'
import { DocxImportFBLA } from './DocxImportStudyguides'

type ImportTab = 'json' | 'docx'

export function BulkImportModal({
  initialTab,
  topics,
  onClose,
  onImported,
}: {
  initialTab: ImportTab
  topics: { id: string; name: string }[]
  onClose: () => void
  /** Called after at least one question was imported so the list refreshes. */
  onImported: () => void | Promise<void>
}) {
  const { user } = useAuth()

  const [importTab, setImportTab]         = useState<ImportTab>(initialTab)
  const [importData, setImportData]       = useState<BulkImportData | null>(null)
  const [importErrors, setImportErrors]   = useState<string[]>([])
  const [importing, setImporting]         = useState(false)
  const [importSuccess, setImportSuccess] = useState<{ count: number; topic: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

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
        setImportErrors(result.error.issues.map(err =>
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
        await onImported()
      }
      if (errors.length > 0) {
        setImportErrors(errors)
      }
      if (successCount === importData.questions.length) {
        setTimeout(() => onClose(), 2000)
      }
    } catch (err: any) {
      console.error('Import error:', err)
      setImportErrors([err.message || 'Failed to import questions'])
    } finally {
      setImporting(false)
    }
  }

  return (
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
              onClick={onClose}
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
                  onClick={onClose}
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
  )
}
