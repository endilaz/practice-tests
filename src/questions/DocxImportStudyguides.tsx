import { useState, useRef, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/auth/useAuth'
import {
  VALID_LETTERS,
  parseDocument,
  parseFromLines,
  type ChoiceLetter,
  type ParsedQuestion,
  type ParseResult,
} from './parse/studyguideParser'

// Step in the multi-stage UI flow
type Step = 'upload' | 'parsing' | 'review' | 'importing' | 'done'

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DocxImportFBLA() {
  const { user } = useAuth()

  const [step, setStep] = useState<Step>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [parseResult, setParseResult] = useState<ParseResult | null>(null)

  // Per-topic state: which topics the user wants to import, and what topic name to use
  const [selectedTopics, setSelectedTopics] = useState<Set<string>>(new Set())
  const [topicNames, setTopicNames] = useState<Record<string, string>>({})
  // Whether to override and skip unanswered questions per topic
  const [overridePartial, setOverridePartial] = useState<Set<string>>(new Set())

  // In-memory question edits: shadows parseResult.topics[].questions per topic.
  // Populated lazily when the user first opens a topic's editor panel.
  // Stored as a full ParsedQuestion[] copy so deletes and field edits are independent
  // of the original parse result (which is never mutated).
  const [editedQuestions, setEditedQuestions] = useState<Record<string, ParsedQuestion[]>>({})
  // Which topics currently have their editor panel expanded
  const [expandedEditors, setExpandedEditors] = useState<Set<string>>(new Set())

  // Editable raw text — initialized from parseResult.rawLines on first parse.
  // The user can edit this and re-run the parser to fix extraction errors
  // (e.g. OCR artifacts, merged lines, missing section headers).
  const [rawText, setRawText] = useState<string>('')
  // Whether the raw text editor panel is currently open
  const [rawEditorOpen, setRawEditorOpen] = useState(false)

  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<{ count: number; topicCount: number } | null>(null)
  const [importErrors, setImportErrors] = useState<string[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Scroll page to top whenever the step changes.
  // Use window.scrollTo rather than scrollIntoView — the latter targets the
  // nearest scrollable ancestor which may be the chat container, not the page.
  // Scroll to top on step change. Try all scroll targets since the
  // container varies by environment (window, documentElement, ancestors).
  useEffect(() => {
    const timer = setTimeout(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTo({ top: 0, behavior: 'smooth' })
      }
    }, 80)
    return () => clearTimeout(timer)
  }, [step])

  // --- Reset ---
  function reset() {
    setStep('upload')
    setFile(null)
    setParseResult(null)
    setSelectedTopics(new Set())
    setTopicNames({})
    setOverridePartial(new Set())
    setEditedQuestions({})
    setExpandedEditors(new Set())
    setRawText('')
    setRawEditorOpen(false)
    setError(null)
    setSuccess(null)
    setImportErrors([])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // --- File select ---
  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null
    setError(null)
    setFile(f)
    if (!f) return
    const isPdf = f.name.toLowerCase().endsWith('.pdf')
    const isDocx = f.name.toLowerCase().endsWith('.docx')
    if (!isPdf && !isDocx) {
      setError('File must be a .docx or .pdf file')
      setFile(null)
      return
    }
    if (f.size > 100 * 1024 * 1024) {
      setError('File too large — maximum 100 MB')
      setFile(null)
      return
    }
  }

  // --- Parse ---
  async function handleParse() {
    if (!file) return
    setError(null)
    setStep('parsing')
    try {
      const result = await parseDocument(file)

      if (result.topics.length === 0) {
        throw new Error(
          'No question sections found. Make sure the document contains "[TOPIC] SAMPLE QUESTIONS" headings.'
        )
      }

      // Pre-populate topic name inputs with detected display names
      const names: Record<string, string> = {}
      const selected = new Set<string>()
      for (const t of result.topics) {
        names[t.normalisedName] = t.displayName
        // Auto-select topics that have at least one valid question
        if (t.questions.some(q => q.issues.length === 0)) {
          selected.add(t.normalisedName)
        }
      }
      setTopicNames(names)
      setSelectedTopics(selected)
      setParseResult(result)
      // Initialize editable raw text from the extracted lines.
      // Joining with newlines lets the user see and edit one line per row.
      setRawText(result.rawLines.join('\\n'))
      setRawEditorOpen(false)
      setStep('review')
    } catch (err: unknown) {
      console.error('Parse error:', err)
      setError(err instanceof Error ? err.message : 'Failed to parse document')
      setStep('upload')
    }
  }

  // --- Toggle topic selection ---
  function toggleTopic(normName: string) {
    setSelectedTopics(prev => {
      const next = new Set(prev)
      if (next.has(normName)) next.delete(normName)
      else next.add(normName)
      return next
    })
  }

  function toggleOverride(normName: string) {
    setOverridePartial(prev => {
      const next = new Set(prev)
      if (next.has(normName)) next.delete(normName)
      else next.add(normName)
      return next
    })
  }

  // --- Editor helpers ---

  /**
   * Returns the live (possibly edited) question list for a topic.
   * Falls back to the original parsed questions if no edits have been made.
   */
  function liveQuestions(normName: string): ParsedQuestion[] {
    return (
      editedQuestions[normName] ??
      parseResult?.topics.find(t => t.normalisedName === normName)?.questions ??
      []
    )
  }

  /**
   * Toggle the editor panel for a topic open/closed.
   * On first open, deep-copies the parsed questions into editedQuestions so
   * subsequent mutations never touch the original parse result.
   */
  function toggleEditor(normName: string) {
    // Lazy-init edits before opening, so liveQuestions() is ready on first render
    if (!editedQuestions[normName] && !expandedEditors.has(normName)) {
      const original =
        parseResult?.topics.find(t => t.normalisedName === normName)?.questions ?? []
      setEditedQuestions(prev => ({
        ...prev,
        [normName]: original.map(q => ({ ...q, choices: [...q.choices] })),
      }))
    }
    setExpandedEditors(prev => {
      const next = new Set(prev)
      if (next.has(normName)) next.delete(normName)
      else next.add(normName)
      return next
    })
  }

  function deleteQuestion(normName: string, questionNumber: number) {
    setEditedQuestions(prev => ({
      ...prev,
      [normName]: (prev[normName] ?? []).filter(q => q.questionNumber !== questionNumber),
    }))
  }

  function updateQuestionText(normName: string, questionNumber: number, text: string) {
    setEditedQuestions(prev => ({
      ...prev,
      [normName]: (prev[normName] ?? []).map(q =>
        q.questionNumber === questionNumber ? { ...q, questionText: text } : q
      ),
    }))
  }

  function updateChoiceText(
    normName: string,
    questionNumber: number,
    letter: ChoiceLetter,
    text: string
  ) {
    setEditedQuestions(prev => ({
      ...prev,
      [normName]: (prev[normName] ?? []).map(q => {
        if (q.questionNumber !== questionNumber) return q
        return { ...q, choices: q.choices.map(c => c.letter === letter ? { ...c, text } : c) }
      }),
    }))
  }

  /**
   * Set the correct answer for a question.
   * Also clears the "No answer in key" issue so the question is no longer blocked.
   */
  function updateCorrectAnswer(normName: string, questionNumber: number, letter: ChoiceLetter) {
    setEditedQuestions(prev => ({
      ...prev,
      [normName]: (prev[normName] ?? []).map(q =>
        q.questionNumber === questionNumber
          ? { ...q, correctAnswer: letter, issues: q.issues.filter(i => i !== 'No answer in key') }
          : q
      ),
    }))
  }

  // --- Re-parse from edited raw text ---
  /**
   * Re-runs the parsing pipeline on the user-edited raw text instead of the
   * original file. Splits the textarea content into lines, feeds them through
   * parseFromLines(), and replaces the current parseResult — identical to what
   * handleParse() does after file extraction, but skipping the file I/O step.
   *
   * Note: for DOCX files the answer key normally comes from Word table cells,
   * which are NOT present in rawLines (body-only extraction). If the user needs
   * to fix answer key data for a DOCX, they should add "N) L" style lines in
   * the raw text under a "<Topic> Answer Key" header — the PDF-style plain-text
   * answer key parser will pick them up.
   */
  function handleReparse() {
    setError(null)
    const lines = rawText.split('\\n')

    let result: ParseResult
    try {
      result = parseFromLines(lines)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Re-parse failed')
      return
    }

    if (result.topics.length === 0) {
      setError('No question sections found after re-parse. Check that "[TOPIC] SAMPLE QUESTIONS" headings are present.')
      return
    }

    // Re-run the same auto-selection logic as the initial parse
    const names: Record<string, string> = {}
    const selected = new Set<string>()
    for (const t of result.topics) {
      names[t.normalisedName] = t.displayName
      if (t.questions.some(q => q.issues.length === 0)) {
        selected.add(t.normalisedName)
      }
    }

    setParseResult(result)
    setTopicNames(names)
    setSelectedTopics(selected)
    // Clear all in-memory question edits — they referred to the old parse result
    setEditedQuestions({})
    setExpandedEditors(new Set())
    setOverridePartial(new Set())
  }

  // --- Validate before import ---
  function canImport(): { blocked: boolean; reason?: string } {
    if (!parseResult) return { blocked: true }
    if (selectedTopics.size === 0) return { blocked: true, reason: 'No topics selected' }

    for (const normName of selectedTopics) {
      const topic = parseResult.topics.find(t => t.normalisedName === normName)!
      const name = topicNames[normName]?.trim()
      if (!name) return { blocked: true, reason: `Topic name cannot be empty (${topic.displayName})` }

      const missing = liveQuestions(normName).filter(q => !q.correctAnswer).length
      if (missing > 0 && !overridePartial.has(normName)) {
        return {
          blocked: true,
          reason: `"${topic.displayName}" has ${missing} unanswered question(s). Either fix them in the editor, override, or deselect the topic.`,
        }
      }
    }
    return { blocked: false }
  }

  // --- Import ---
  async function handleImport() {
    if (!parseResult || !user) return
    const { blocked, reason } = canImport()
    if (blocked) { setError(reason ?? 'Cannot import'); return }

    setError(null)
    setImportErrors([])
    setStep('importing')

    const errs: string[] = []
    let totalImported = 0
    let topicsImported = 0

    for (const normName of selectedTopics) {
      const topicName = topicNames[normName].trim()
      const usePartial = overridePartial.has(normName)

      // Determine which questions to import — use live (possibly edited) list
      const toImport = liveQuestions(normName).filter(q => {
        if (q.choices.length !== 4) return false
        if (!q.correctAnswer && !usePartial) return false
        if (!q.correctAnswer && usePartial) return false // still skip unanswered even in override
        return q.issues.length === 0 || (usePartial && !q.issues.some(i => i !== 'No answer in key'))
      })

      if (toImport.length === 0) {
        errs.push(`${topicName}: No valid questions to import`)
        continue
      }

      try {
        // Find or create topic
        let topicId: string
        const { data: existing } = await supabase
          .from('topics')
          .select('id')
          .eq('name', topicName)
          .single()

        if (existing) {
          topicId = existing.id
        } else {
          const { data: newTopic, error: topicErr } = await supabase
            .from('topics')
            .insert({ name: topicName })
            .select()
            .single()
          if (topicErr) throw new Error(`Failed to create topic "${topicName}": ${topicErr.message}`)
          topicId = newTopic.id
        }

        // Insert questions
        let topicCount = 0
        for (const q of toImport) {
          try {
            const { data: question, error: qErr } = await supabase
              .from('questions')
              .insert({
                topic_id: topicId,
                question_text: q.questionText,
                explanation_text: null,
                difficulty_level: null,
                created_by_admin_id: user.id,
              })
              .select()
              .single()

            if (qErr) throw qErr

            const choicesData = q.choices.map(c => ({
              question_id: question.id,
              choice_letter: c.letter,
              choice_text: c.text,
              is_correct: c.letter === q.correctAnswer,
            }))

            const { error: cErr } = await supabase.from('answer_choices').insert(choicesData)
            if (cErr) {
              // Roll back orphaned question
              await supabase.from('questions').delete().eq('id', question.id)
              throw cErr
            }

            topicCount++
            totalImported++
          } catch (err: unknown) {
            errs.push(`${topicName} Q${q.questionNumber}: ${err instanceof Error ? err.message : String(err)}`)
          }
        }

        if (topicCount > 0) topicsImported++
      } catch (err: unknown) {
        errs.push(err instanceof Error ? err.message : String(err))
      }
    }

    setImportErrors(errs)
    setSuccess({ count: totalImported, topicCount: topicsImported })
    setStep('done')
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const importCheck = step === 'review' ? canImport() : { blocked: false }

  return (
    <div ref={scrollRef} className="space-y-6 overflow-y-auto max-h-[80vh] scroll-smooth">
      {/* Header */}
      <div>
        <h3 className="text-lg font-bold text-gray-900 mb-1">Import from FBLA Study Guide</h3>
        <p className="text-sm text-gray-500">
          Supports both 2010–13 and 2017–20 study guide formats. Multiple topics per document.
          Answer keys are matched automatically.
        </p>
      </div>

      {/* Error banner */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* ── STEP: upload ── */}
      {step === 'upload' && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Select DOCX File
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".docx,.pdf"
              onChange={handleFileSelect}
              className="block w-full text-sm text-gray-600 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
            />
            <p className="text-xs text-gray-400 mt-1">Max 100 MB · .docx or .pdf</p>
          </div>

          {file && (
            <div className="flex items-center gap-3 p-3 bg-blue-50 border border-blue-100 rounded-lg">
              <span className="text-blue-500 text-lg">📄</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate">{file.name}</p>
                <p className="text-xs text-gray-500">{(file.size / 1024).toFixed(1)} KB</p>
              </div>
              <button
                onClick={handleParse}
                className="bg-blue-600 text-white text-sm font-medium px-4 py-1.5 rounded-lg hover:bg-blue-700 transition-colors"
              >
                Parse Document
              </button>
            </div>
          )}

          <details className="text-sm">
            <summary className="cursor-pointer text-blue-600 hover:text-blue-700 font-medium">
              What documents work?
            </summary>
            <div className="mt-2 p-3 bg-gray-50 rounded-lg text-gray-600 space-y-1 text-xs leading-relaxed">
              <p>✓ FBLA 2017–20 Competitive Events Study Guide (full 400-page or individual topics)</p>
              <p>✓ FBLA 2010–13 study guides</p>
              <p>✓ Multiple topics in one file — each is imported separately</p>
              <p>✓ Answer keys in 3-column tables at the back are detected automatically</p>
              <p>✓ PDF versions of the study guide (400-page combined doc supported)</p>
            </div>
          </details>
        </div>
      )}

      {/* ── STEP: parsing ── */}
      {step === 'parsing' && (
        <div className="flex flex-col items-center justify-center py-12 gap-4">
          <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
          <div className="text-center">
            <p className="font-medium text-gray-800">Parsing document…</p>
            <p className="text-sm text-gray-500 mt-1">Extracting questions and matching answer keys</p>
          </div>
        </div>
      )}

      {/* ── STEP: review ── */}
      {step === 'review' && parseResult && (
        <div className="space-y-4">
          {/* Global stats */}
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: 'Topics found', value: parseResult.stats.topics, color: 'text-gray-900' },
              { label: 'Questions', value: parseResult.stats.totalQuestions, color: 'text-gray-900' },
              { label: 'Valid', value: parseResult.stats.valid, color: 'text-green-600' },
              { label: 'Issues', value: parseResult.stats.invalid, color: parseResult.stats.invalid > 0 ? 'text-red-500' : 'text-gray-300' },
            ].map(s => (
              <div key={s.label} className="p-3 bg-white border rounded-lg text-center">
                <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
                <div className="text-xs text-gray-500 mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>

          {/* Global parsing issues */}
          {parseResult.parsingIssues.length > 0 && (
            <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
              <p className="text-xs font-medium text-yellow-800 mb-1">Parsing notes:</p>
              <ul className="space-y-0.5">
                {parseResult.parsingIssues.map((note, i) => (
                  <li key={i} className="text-xs text-yellow-700">• {note}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Per-topic cards */}
          <div className="space-y-3">
            {parseResult.topics.map(topic => {
              const normName = topic.normalisedName
              const isSelected = selectedTopics.has(normName)
              // Use live (possibly edited) question list for all counts
              const live = liveQuestions(normName)
              const missingCount = live.filter(q => !q.correctAnswer).length
              const otherIssues = live.filter(
                q => q.issues.some(i => i !== 'No answer in key')
              ).length
              const validCount = live.filter(q => q.issues.length === 0).length
              const isOverridden = overridePartial.has(normName)
              const isEditorOpen = expandedEditors.has(normName)

              return (
                <div
                  key={normName}
                  className={`border rounded-lg overflow-hidden transition-colors ${
                    isSelected ? 'border-blue-300 bg-blue-50/30' : 'border-gray-200 bg-white opacity-60'
                  }`}
                >
                  {/* Topic header row */}
                  <div className="flex items-center gap-3 p-3">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleTopic(normName)}
                      className="w-4 h-4 text-blue-600 rounded"
                    />
                    <div className="flex-1 min-w-0">
                      <input
                        type="text"
                        value={topicNames[normName] ?? topic.displayName}
                        onChange={e => setTopicNames(prev => ({ ...prev, [normName]: e.target.value }))}
                        disabled={!isSelected}
                        className="w-full text-sm font-medium border-0 bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-400 rounded px-1 disabled:text-gray-400"
                        placeholder="Topic name"
                      />
                    </div>
                    <div className="flex items-center gap-2 text-xs shrink-0">
                      <span className="text-green-600 font-medium">{validCount} valid</span>
                      {missingCount > 0 && (
                        <span className="text-red-500">{missingCount} missing answers</span>
                      )}
                      {otherIssues > 0 && (
                        <span className="text-orange-500">{otherIssues} other issues</span>
                      )}
                    </div>
                  </div>

                  {/* Blocker for missing answers */}
                  {isSelected && missingCount > 0 && (
                    <div className={`px-4 py-3 border-t ${isOverridden ? 'bg-yellow-50 border-yellow-200' : 'bg-red-50 border-red-200'}`}>
                      {!isOverridden ? (
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-xs text-red-700">
                            ⚠ {missingCount} question(s) have no answer key match — import blocked.
                          </p>
                          <button
                            onClick={() => toggleOverride(normName)}
                            className="text-xs text-red-700 underline hover:text-red-900 shrink-0"
                          >
                            Skip and import {validCount} answered
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-xs text-yellow-700">
                            {missingCount} unanswered question(s) will be skipped.
                          </p>
                          <button
                            onClick={() => toggleOverride(normName)}
                            className="text-xs text-yellow-700 underline shrink-0"
                          >
                            Undo
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Preview of invalid questions */}
                  {isSelected && otherIssues > 0 && (
                    <details className="border-t border-orange-200">
                      <summary className="cursor-pointer px-4 py-2 text-xs font-medium text-orange-700 bg-orange-50">
                        {otherIssues} question(s) with other issues (will be skipped)
                      </summary>
                      <div className="px-4 py-2 max-h-32 overflow-y-auto space-y-1">
                        {live
                          .filter(q => q.issues.some(i => i !== 'No answer in key'))
                          .map((q, idx) => (
                            <div key={`${normName}-issue-${q.questionNumber}-${idx}`} className="text-xs text-gray-600">
                              <span className="font-mono text-orange-500 mr-1">Q{q.questionNumber}</span>
                              {q.issues.filter(i => i !== 'No answer in key').join('; ')}
                            </div>
                          ))}
                      </div>
                    </details>
                  )}

                  {/* ── Question editor ── */}
                  {isSelected && (
                    <div className="border-t border-gray-200">
                      <button
                        onClick={() => toggleEditor(normName)}
                        className="w-full flex items-center justify-between px-4 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                      >
                        <span>✏️ Edit questions ({live.length})</span>
                        <span className="text-gray-400">{isEditorOpen ? '▲ collapse' : '▼ expand'}</span>
                      </button>

                      {isEditorOpen && (
                        <div className="divide-y divide-gray-100 max-h-[520px] overflow-y-auto border-t border-gray-100">
                          {live.length === 0 && (
                            <p className="px-4 py-3 text-xs text-gray-400 italic">
                              All questions have been deleted.
                            </p>
                          )}
                          {live.map((q, idx) => {
                            // Issues still relevant after any edits
                            const activeIssues = q.issues.filter(
                              i => i !== 'No answer in key' || !q.correctAnswer
                            )
                            return (
                              <div
                                key={`${normName}-q-${q.questionNumber}-${idx}`}
                                className={`px-4 py-3 space-y-2 ${activeIssues.length > 0 ? 'bg-red-50/40' : ''}`}
                              >
                                {/* Row: question number + correct-answer selector + delete */}
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-mono text-gray-400 shrink-0 w-8">
                                    Q{q.questionNumber}
                                  </span>
                                  <label className="text-xs text-gray-500 shrink-0">Correct:</label>
                                  <select
                                    value={q.correctAnswer ?? ''}
                                    onChange={e =>
                                      updateCorrectAnswer(normName, q.questionNumber, e.target.value as ChoiceLetter)
                                    }
                                    className={`text-xs border rounded px-1 py-0.5 ${
                                      q.correctAnswer
                                        ? 'border-green-400 text-green-700 bg-green-50'
                                        : 'border-red-400 text-red-600 bg-red-50'
                                    }`}
                                  >
                                    <option value="">—</option>
                                    {VALID_LETTERS.map(l => (
                                      <option key={l} value={l}>{l}</option>
                                    ))}
                                  </select>
                                  <button
                                    onClick={() => deleteQuestion(normName, q.questionNumber)}
                                    className="ml-auto text-xs text-red-400 hover:text-red-600 shrink-0 transition-colors"
                                    title="Delete this question"
                                  >
                                    🗑 Delete
                                  </button>
                                </div>

                                {/* Question text */}
                                <textarea
                                  value={q.questionText}
                                  onChange={e =>
                                    updateQuestionText(normName, q.questionNumber, e.target.value)
                                  }
                                  rows={2}
                                  className="w-full text-xs border border-gray-200 rounded px-2 py-1 resize-y focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white"
                                  placeholder="Question text"
                                />

                                {/* Choices: always render all 4 slots A–D.
                                    Missing choices get an empty editable input so the
                                    user can type them in directly in the editor. */}
                                <div className="space-y-1">
                                  {VALID_LETTERS.map(letter => {
                                    const c = q.choices.find(ch => ch.letter === letter)
                                    const isMissing = !c
                                    return (
                                      <div key={letter} className="flex items-center gap-2">
                                        {/* Letter badge — click to mark correct */}
                                        <button
                                          onClick={() =>
                                            updateCorrectAnswer(normName, q.questionNumber, letter)
                                          }
                                          title="Set as correct answer"
                                          className={`w-6 h-6 text-xs font-bold rounded shrink-0 transition-colors ${
                                            letter === q.correctAnswer
                                              ? 'bg-green-500 text-white'
                                              : 'bg-gray-100 text-gray-500 hover:bg-green-100 hover:text-green-700'
                                          }`}
                                        >
                                          {letter}
                                        </button>
                                        <input
                                          type="text"
                                          value={c?.text ?? ''}
                                          placeholder={isMissing ? 'Missing — type to add' : ''}
                                          onChange={e => {
                                            if (isMissing) {
                                              // Add the choice to the question's choices array
                                              setEditedQuestions(prev => ({
                                                ...prev,
                                                [normName]: (prev[normName] ?? []).map(eq => {
                                                  if (eq.questionNumber !== q.questionNumber) return eq
                                                  const newChoices = [
                                                    ...eq.choices,
                                                    { letter, text: e.target.value },
                                                  ].sort((a, b) => a.letter.localeCompare(b.letter))
                                                  // Recalculate issues: remove the "Missing choice X" for this letter
                                                  const newIssues = eq.issues.filter(
                                                    iss => iss !== `Missing choice ${letter}` &&
                                                           iss !== `Has ${eq.choices.length}/4 choices`
                                                  )
                                                  const stillMissing = VALID_LETTERS.filter(
                                                    l => !newChoices.find(nc => nc.letter === l)
                                                  )
                                                  if (stillMissing.length > 0) {
                                                    newIssues.push(`Has ${newChoices.length}/4 choices`)
                                                  }
                                                  return { ...eq, choices: newChoices, issues: newIssues }
                                                }),
                                              }))
                                            } else {
                                              updateChoiceText(normName, q.questionNumber, letter, e.target.value)
                                            }
                                          }}
                                          className={`flex-1 text-xs border rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-400 ${
                                            isMissing
                                              ? 'border-dashed border-red-300 bg-red-50 placeholder:text-red-300'
                                              : letter === q.correctAnswer
                                                ? 'border-green-300 bg-green-50'
                                                : 'border-gray-200 bg-white'
                                          }`}
                                        />
                                      </div>
                                    )
                                  })}
                                </div>

                                {/* Remaining issues */}
                                {activeIssues.length > 0 && (
                                  <p className="text-xs text-orange-600">
                                    ⚠ {activeIssues.join(' · ')}
                                  </p>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Raw text editor — lets the user fix extraction errors and re-parse */}
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <button
              onClick={() => setRawEditorOpen(o => !o)}
              className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors text-left"
            >
              <span>🛠 Edit raw extracted text &amp; re-parse</span>
              <span className="text-gray-400 text-xs">{rawEditorOpen ? '▲ collapse' : '▼ expand'}</span>
            </button>

            {rawEditorOpen && (
              <div className="border-t border-gray-200 p-4 space-y-3">
                <p className="text-xs text-gray-500 leading-relaxed">
                  This is the text extracted from your file, one line per row. Edit it to fix OCR
                  errors, merge split lines, correct answer key entries, or add missing section
                  headers — then click <strong>Re-parse</strong> to rebuild the topic list above.
                  Edits here are independent of the per-question editor above.
                </p>
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                  ⚠ For DOCX files, answer keys live in Word table cells which are not shown here.
                  You can add plain-text answer key lines in the format{' '}
                  <span className="font-mono">Topic Name Answer Key</span> followed by{' '}
                  <span className="font-mono">1) A  2) B  3) C …</span> and they will be picked up
                  on re-parse.
                </p>
                <textarea
                  value={rawText}
                  onChange={e => setRawText(e.target.value)}
                  rows={20}
                  spellCheck={false}
                  className="w-full text-xs font-mono border border-gray-300 rounded-lg px-3 py-2 resize-y focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white leading-relaxed"
                  placeholder="Extracted text will appear here after parsing…"
                />
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-gray-400">
                    {rawText.split('\\n').length} lines · {rawText.length} chars
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setRawText(parseResult.rawLines.join('\\n'))}
                      className="px-3 py-1.5 text-xs border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                      title="Discard edits and restore the original extracted text"
                    >
                      Reset to original
                    </button>
                    <button
                      onClick={handleReparse}
                      className="px-4 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    >
                      ↺ Re-parse
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Blocked reason */}
          {importCheck.blocked && importCheck.reason && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {importCheck.reason}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              onClick={reset}
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 transition-colors"
            >
              Start over
            </button>
            <button
              onClick={handleImport}
              disabled={importCheck.blocked}
              className="flex-1 bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {importCheck.blocked
                ? 'Resolve issues above to import'
                : `Import ${[...selectedTopics].reduce((n, k) => {
                    const partial = overridePartial.has(k)
                    return n + liveQuestions(k).filter(q =>
                      q.issues.length === 0 || (partial && q.issues.every(i => i === 'No answer in key') && q.correctAnswer)
                    ).length
                  }, 0)} questions across ${selectedTopics.size} topic(s)`}
            </button>
          </div>
        </div>
      )}

      {/* ── STEP: importing ── */}
      {step === 'importing' && (
        <div className="flex flex-col items-center justify-center py-12 gap-4">
          <div className="w-10 h-10 border-4 border-green-600 border-t-transparent rounded-full animate-spin" />
          <p className="font-medium text-gray-800">Saving to database…</p>
        </div>
      )}

      {/* ── STEP: done ── */}
      {step === 'done' && success && (
        <div className="space-y-4">
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-start gap-3">
            <span className="text-green-500 text-xl">✓</span>
            <div>
              <p className="font-semibold text-green-800">
                Imported {success.count} question{success.count !== 1 ? 's' : ''} across{' '}
                {success.topicCount} topic{success.topicCount !== 1 ? 's' : ''}
              </p>
            </div>
          </div>

          {importErrors.length > 0 && (
            <details className="bg-red-50 border border-red-200 rounded-lg">
              <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-red-700">
                {importErrors.length} error(s) during import
              </summary>
              <ul className="px-4 pb-3 space-y-1">
                {importErrors.map((e, i) => (
                  <li key={i} className="text-xs text-red-600">• {e}</li>
                ))}
              </ul>
            </details>
          )}

          <button
            onClick={reset}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 transition-colors"
          >
            Import another document
          </button>
        </div>
      )}
    </div>
  )
}