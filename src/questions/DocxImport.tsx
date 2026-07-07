import { useState, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/auth/useAuth'

type ParsedQuestion = {
  questionNumber: number
  questionText: string
  choices: {
    letter: 'A' | 'B' | 'C' | 'D'
    text: string
  }[]
  correctAnswer: 'A' | 'B' | 'C' | 'D' | null
  issues: string[]
}

type ParseResult = {
  questions: ParsedQuestion[]
  answerKey: Record<number, string>
  parsingIssues: string[]
  stats: {
    total: number
    valid: number
    invalid: number
    missingChoices: number
    missingAnswers: number
  }
}

export function DocxImport() {
  const { user } = useAuth()
  const [file, setFile] = useState<File | null>(null)
  const [topicName, setTopicName] = useState('')
  const [parseResult, setParseResult] = useState<ParseResult | null>(null)
  const [parsing, setParsing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<{ count: number; topic: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function reset() {
    setFile(null)
    setTopicName('')
    setParseResult(null)
    setError(null)
    setSuccess(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const selectedFile = e.target.files?.[0]
    if (!selectedFile) return

    setFile(selectedFile)
    setParseResult(null)
    setError(null)
    setSuccess(null)

    // Validate file type
    if (!selectedFile.name.endsWith('.docx')) {
      setError('File must be a .docx file')
      return
    }

    // Validate file size (10MB max)
    if (selectedFile.size > 10 * 1024 * 1024) {
      setError('File too large. Maximum size is 10MB')
      return
    }
  }

  async function parseDocx() {
    if (!file) return

    setParsing(true)
    setError(null)
    setParseResult(null)

    try {
      // Read file as ArrayBuffer
      const arrayBuffer = await file.arrayBuffer()
      
      // Extract text from DOCX (it's a ZIP file with XML)
      const JSZip = (await import('jszip')).default
      const zip = await JSZip.loadAsync(arrayBuffer)
      
      // Read the main document XML
      const docXml = await zip.file('word/document.xml')?.async('text')
      if (!docXml) {
        throw new Error('Invalid DOCX file: missing document.xml')
      }

      // Parse XML to extract text
      const parser = new DOMParser()
      const xmlDoc = parser.parseFromString(docXml, 'text/xml')
      
      // Extract all text elements
      const textElements = xmlDoc.getElementsByTagNameNS(
        'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
        't'
      )
      
      const lines: string[] = []
      for (let i = 0; i < textElements.length; i++) {
        const text = textElements[i].textContent
        if (text && text.trim()) {
          lines.push(text.trim())
        }
      }

      // Parse questions and answer key
      const result = parseQuestionsAndAnswers(lines)
      setParseResult(result)

    } catch (err: any) {
      console.error('Parse error:', err)
      setError(err.message || 'Failed to parse DOCX file')
    } finally {
      setParsing(false)
    }
  }

  function parseQuestionsAndAnswers(lines: string[]): ParseResult {
    const questions: ParsedQuestion[] = []
    const parsingIssues: string[] = []
    const answerKey: Record<number, string> = {}

    // First pass: Extract answer key from end of document
    // Answer key format: "1)\nC\n2)\nD\n..." at the end
    let answerKeyStartIdx = -1
    
    // Look for start of answer key (sequential question numbers with single letters)
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim()
      
      // Check if this looks like an answer key entry
      if (/^\d+\)$/.test(line)) {
        // Check next line is a single letter A-D
        if (i + 1 < lines.length && /^[A-D]$/.test(lines[i + 1].trim())) {
          answerKeyStartIdx = i
          // Keep going back to find the actual start
          continue
        }
      }
      
      // If we found answer key entries and now hit something else, we found the start
      if (answerKeyStartIdx !== -1 && !/^\d+\)$/.test(line) && !/^[A-D]$/.test(line)) {
        answerKeyStartIdx = i + 1
        break
      }
    }

    // Extract answer key
    if (answerKeyStartIdx !== -1) {
      for (let i = answerKeyStartIdx; i < lines.length - 1; i++) {
        const qNumMatch = lines[i].match(/^(\d+)\)$/)
        if (qNumMatch) {
          const qNum = parseInt(qNumMatch[1])
          const answer = lines[i + 1].trim()
          if (/^[A-D]$/.test(answer)) {
            answerKey[qNum] = answer
            i++ // Skip the answer line
          }
        }
      }
    } else {
      parsingIssues.push('Could not find answer key at end of document')
    }

    // Second pass: Parse questions (stop before answer key)
    const questionEndIdx = answerKeyStartIdx !== -1 ? answerKeyStartIdx : lines.length
    let i = 0

    while (i < questionEndIdx) {
      const line = lines[i].trim()

      // Look for question number: "1)", "2)", etc.
      const qNumMatch = line.match(/^(\d+)\)$/)
      if (!qNumMatch) {
        i++
        continue
      }

      const questionNumber = parseInt(qNumMatch[1])
      i++

      // Collect question text (everything until we hit "A)")
      const questionLines: string[] = []
      while (i < questionEndIdx && !/^[A-D]\)/.test(lines[i])) {
        if (lines[i].trim()) {
          questionLines.push(lines[i].trim())
        }
        i++
      }

      const questionText = questionLines.join(' ').trim()

      // Extract choices A-D
      const choices: { letter: 'A' | 'B' | 'C' | 'D'; text: string }[] = []
      const issues: string[] = []

      for (const expectedLetter of ['A', 'B', 'C', 'D'] as const) {
        if (i >= questionEndIdx) {
          issues.push(`Missing choice ${expectedLetter}`)
          break
        }

        const choiceMatch = lines[i].match(/^([A-D])\)\s*(.*)$/)
        if (choiceMatch) {
          const letter = choiceMatch[1] as 'A' | 'B' | 'C' | 'D'
          let text = choiceMatch[2].trim()

          // Choice text might continue on next lines
          i++
          while (i < questionEndIdx && !/^[A-D]\)/.test(lines[i]) && !/^\d+\)$/.test(lines[i])) {
            text += ' ' + lines[i].trim()
            i++
          }

          if (letter !== expectedLetter) {
            issues.push(`Expected choice ${expectedLetter}, got ${letter}`)
          }

          choices.push({ letter, text: text.trim() })
        } else {
          issues.push(`Could not parse choice ${expectedLetter}`)
          i++
        }
      }

      // Validation
      if (!questionText) {
        issues.push('Empty question text')
      }

      if (choices.length !== 4) {
        issues.push(`Has ${choices.length} choices (need 4)`)
      }

      const correctAnswer = answerKey[questionNumber] as 'A' | 'B' | 'C' | 'D' | null || null
      if (!correctAnswer) {
        issues.push('No answer in answer key')
      }

      questions.push({
        questionNumber,
        questionText,
        choices,
        correctAnswer,
        issues
      })
    }

    // Calculate stats
    const valid = questions.filter(q => q.issues.length === 0 && q.correctAnswer).length
    const invalid = questions.length - valid
    const missingChoices = questions.filter(q => q.choices.length !== 4).length
    const missingAnswers = questions.filter(q => !q.correctAnswer).length

    return {
      questions,
      answerKey,
      parsingIssues,
      stats: {
        total: questions.length,
        valid,
        invalid,
        missingChoices,
        missingAnswers
      }
    }
  }

  async function handleImport() {
    if (!parseResult || !user || !topicName.trim()) return

    setImporting(true)
    setError(null)
    setSuccess(null)

    try {
      // Filter to only valid questions
      const validQuestions = parseResult.questions.filter(
        q => q.issues.length === 0 && q.correctAnswer && q.choices.length === 4
      )

      if (validQuestions.length === 0) {
        throw new Error('No valid questions to import')
      }

      // Step 1: Find or create topic
      let topicId: string

      const { data: existingTopic } = await supabase
        .from('topics')
        .select('id')
        .eq('name', topicName.trim())
        .single()

      if (existingTopic) {
        topicId = existingTopic.id
      } else {
        const { data: newTopic, error: topicError } = await supabase
          .from('topics')
          .insert({ name: topicName.trim() })
          .select()
          .single()

        if (topicError) throw new Error(`Failed to create topic: ${topicError.message}`)
        topicId = newTopic.id
      }

      // Step 2: Import questions
      let successCount = 0
      const errors: string[] = []

      for (const q of validQuestions) {
        try {
          // Insert question
          const { data: question, error: qError } = await supabase
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

          if (qError) throw qError

          // Insert answer choices
          const choicesData = q.choices.map(c => ({
            question_id: question.id,
            choice_letter: c.letter,
            choice_text: c.text,
            is_correct: c.letter === q.correctAnswer,
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
          errors.push(`Question ${q.questionNumber}: ${err.message}`)
        }
      }

      if (successCount > 0) {
        setSuccess({ count: successCount, topic: topicName.trim() })
      }

      if (errors.length > 0) {
        setError(`Imported ${successCount} questions with ${errors.length} errors. Check console for details.`)
        console.error('Import errors:', errors)
      }

      if (successCount === validQuestions.length) {
        // Full success - reset after delay
        setTimeout(() => {
          reset()
        }, 3000)
      }
    } catch (err: any) {
      console.error('Import error:', err)
      setError(err.message || 'Failed to import questions')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-bold text-gray-900 mb-2">Import from DOCX</h3>
        <p className="text-sm text-gray-600">
          Upload a Word document with questions, choices, and answer key
        </p>
      </div>

      {/* Success Message */}
      {success && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg">
          ✓ Successfully imported {success.count} question{success.count !== 1 ? 's' : ''} to topic "{success.topic}"
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* File Upload */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Select DOCX File
        </label>
        <input
          ref={fileInputRef}
          type="file"
          accept=".docx"
          onChange={handleFileSelect}
          disabled={parsing || importing}
          className="block w-full text-sm text-gray-600 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 disabled:opacity-50"
        />
        <p className="text-xs text-gray-500 mt-2">
          Maximum file size: 10MB. Document should contain questions with A-D choices and answer key at the end.
        </p>
      </div>

      {/* Topic Name */}
      {file && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Topic Name
          </label>
          <input
            type="text"
            value={topicName}
            onChange={e => setTopicName(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="e.g., Advertising - District Test"
            disabled={parsing || importing}
          />
        </div>
      )}

      {/* Parse Button */}
      {file && topicName && !parseResult && (
        <button
          onClick={parseDocx}
          disabled={parsing}
          className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors font-medium"
        >
          {parsing ? 'Parsing Document...' : 'Parse Document'}
        </button>
      )}

      {/* Parse Results */}
      {parseResult && (
        <div className="border border-gray-200 rounded-lg p-4 bg-gray-50 space-y-4">
          <div>
            <h4 className="font-semibold text-gray-900 mb-2">Parse Results</h4>
            
            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
              <div className="bg-white p-3 rounded border">
                <div className="text-2xl font-bold text-gray-900">{parseResult.stats.total}</div>
                <div className="text-xs text-gray-600">Total Questions</div>
              </div>
              <div className="bg-white p-3 rounded border">
                <div className="text-2xl font-bold text-green-600">{parseResult.stats.valid}</div>
                <div className="text-xs text-gray-600">Valid</div>
              </div>
              <div className="bg-white p-3 rounded border">
                <div className="text-2xl font-bold text-red-600">{parseResult.stats.invalid}</div>
                <div className="text-xs text-gray-600">Invalid</div>
              </div>
              <div className="bg-white p-3 rounded border">
                <div className="text-2xl font-bold text-yellow-600">{parseResult.stats.missingChoices}</div>
                <div className="text-xs text-gray-600">Missing Choices</div>
              </div>
              <div className="bg-white p-3 rounded border">
                <div className="text-2xl font-bold text-orange-600">{parseResult.stats.missingAnswers}</div>
                <div className="text-xs text-gray-600">Missing Answers</div>
              </div>
            </div>

            {/* Parsing Issues */}
            {parseResult.parsingIssues.length > 0 && (
              <div className="bg-yellow-50 border border-yellow-200 rounded p-3 mb-4">
                <p className="font-medium text-yellow-800 mb-2">Parsing Issues:</p>
                <ul className="text-sm text-yellow-700 space-y-1">
                  {parseResult.parsingIssues.map((issue, idx) => (
                    <li key={idx}>• {issue}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Question Issues Preview */}
            {parseResult.stats.invalid > 0 && (
              <details className="bg-white border rounded p-3">
                <summary className="cursor-pointer text-sm font-medium text-gray-700">
                  View Questions with Issues ({parseResult.stats.invalid})
                </summary>
                <div className="mt-3 space-y-2 max-h-64 overflow-y-auto">
                  {parseResult.questions
                    .filter(q => q.issues.length > 0)
                    .slice(0, 20)
                    .map(q => (
                      <div key={q.questionNumber} className="border-l-4 border-red-400 pl-3 py-2 bg-red-50">
                        <div className="font-medium text-sm">Question {q.questionNumber}</div>
                        <div className="text-xs text-gray-600 mb-1 line-clamp-1">{q.questionText}</div>
                        <ul className="text-xs text-red-600 space-y-1">
                          {q.issues.map((issue, idx) => (
                            <li key={idx}>• {issue}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  {parseResult.questions.filter(q => q.issues.length > 0).length > 20 && (
                    <p className="text-xs text-gray-500 italic">... and {parseResult.questions.filter(q => q.issues.length > 0).length - 20} more</p>
                  )}
                </div>
              </details>
            )}

            {/* Valid Questions Preview */}
            {parseResult.stats.valid > 0 && (
              <details className="bg-white border rounded p-3">
                <summary className="cursor-pointer text-sm font-medium text-gray-700">
                  Preview Valid Questions ({parseResult.stats.valid})
                </summary>
                <div className="mt-3 space-y-2 max-h-64 overflow-y-auto">
                  {parseResult.questions
                    .filter(q => q.issues.length === 0 && q.correctAnswer)
                    .slice(0, 5)
                    .map(q => (
                      <div key={q.questionNumber} className="border rounded p-3 bg-green-50">
                        <div className="font-medium text-sm mb-1">Question {q.questionNumber}</div>
                        <div className="text-sm text-gray-700 mb-2">{q.questionText}</div>
                        <div className="space-y-1">
                          {q.choices.map(c => (
                            <div
                              key={c.letter}
                              className={`text-xs ${c.letter === q.correctAnswer ? 'text-green-700 font-medium' : 'text-gray-600'}`}
                            >
                              {c.letter}) {c.text}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  {parseResult.stats.valid > 5 && (
                    <p className="text-xs text-gray-500 italic">... and {parseResult.stats.valid - 5} more</p>
                  )}
                </div>
              </details>
            )}
          </div>

          {/* Import Actions */}
          <div className="flex gap-3 pt-4 border-t">
            <button
              onClick={reset}
              disabled={importing}
              className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleImport}
              disabled={importing || parseResult.stats.valid === 0}
              className="bg-green-600 text-white px-6 py-2 rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors font-medium flex-1"
            >
              {importing
                ? 'Importing...'
                : `Import ${parseResult.stats.valid} Valid Question${parseResult.stats.valid !== 1 ? 's' : ''}`}
            </button>
          </div>
        </div>
      )}

      {/* Format Help */}
      <details className="text-sm">
        <summary className="cursor-pointer text-blue-600 hover:text-blue-700 font-medium">
          Expected DOCX format
        </summary>
        <pre className="mt-2 bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto text-xs">
{`Questions Section:
1)
Question text here?
A) Choice A
B) Choice B
C) Choice C
D) Choice D
2)
Next question...

Answer Key Section (at end):
1)
C
2)
D
3)
A
...`}
        </pre>
      </details>
    </div>
  )
}
