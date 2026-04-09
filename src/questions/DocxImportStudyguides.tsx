import { useState, useRef, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/auth/useAuth'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ChoiceLetter = 'A' | 'B' | 'C' | 'D'

type ParsedChoice = {
  letter: ChoiceLetter
  text: string
}

type ParsedQuestion = {
  questionNumber: number
  questionText: string
  choices: ParsedChoice[]
  correctAnswer: ChoiceLetter | null
  issues: string[]
}

type TopicBlock = {
  /** Normalised key used for answer key matching, e.g. "accounting i" */
  normalisedName: string
  /** Display name as it appeared in the document, e.g. "Accounting I" */
  displayName: string
  questions: ParsedQuestion[]
}

type ParseResult = {
  topics: TopicBlock[]
  parsingIssues: string[]
  /** Raw extracted lines for debugging — shown in the parse viewer */
  rawLines: string[]
  stats: {
    topics: number
    totalQuestions: number
    valid: number
    invalid: number
    missingAnswers: number
  }
}

// Step in the multi-stage UI flow
type Step = 'upload' | 'parsing' | 'review' | 'importing' | 'done'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_LETTERS: ChoiceLetter[] = ['A', 'B', 'C', 'D']

// Lines that should always be discarded before parsing begins
const JUNK_LINE_PATTERNS: RegExp[] = [
  /^©/i,                                   // copyright lines
  /^https?:\/\//i,                          // URLs
  /^www\./i,                                // www URLs
  /^competency:/i,                          // "Competency: Journalizing"
  /^objective test answer keys$/i,          // global answer key header
  /^\d+\s*$/,                               // bare page numbers
  /^fbla competitive events study guide/i,  // footer text
  /^competencies and task lists$/i,
  /^website resources$/i,
  /^overview$/i,
  /^note:/i,
  /^tips?$/i,
  /^study tips?$/i,
  /^topic$/i,
]

// ---------------------------------------------------------------------------
// PDF extraction (browser-native via pdf.js CDN)
// ---------------------------------------------------------------------------

/**
 * Extract all paragraph-level text lines from a PDF using pdf.js.
 * Lines are returned in page order, preserving the structure needed for parsing.
 * pdf.js is loaded dynamically from CDN to avoid bundling it.
 */
async function extractPdfText(buffer: ArrayBuffer): Promise<string[]> {
  // Load pdf.js from CDN if not already present
  if (!(window as any).pdfjsLib) {
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script')
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'
      script.onload = () => resolve()
      script.onerror = () => reject(new Error('Failed to load pdf.js'))
      document.head.appendChild(script)
    })
    // Set worker src
    ;(window as any).pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
  }

  const pdfjsLib = (window as any).pdfjsLib
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise
  const allLines: string[] = []

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum)
    const content = await page.getTextContent()

    // pdf.js gives us individual text items with x/y positions.
    // Group items into lines by their Y position (within a small tolerance),
    // then sort each line by X position to get reading order.
    type Item = { str: string; x: number; y: number }
    const items: Item[] = content.items.map((item: any) => ({
      str: item.str,
      x: Math.round(item.transform[4]),
      y: Math.round(item.transform[5]),
    }))

    // Group by Y (round to nearest 2px to handle slight vertical misalignment)
    const byY = new Map<number, Item[]>()
    for (const item of items) {
      const yKey = Math.round(item.y / 2) * 2
      if (!byY.has(yKey)) byY.set(yKey, [])
      byY.get(yKey)!.push(item)
    }

    // Sort Y keys descending (PDF Y=0 is bottom of page)
    const sortedYs = Array.from(byY.keys()).sort((a, b) => b - a)

    for (const y of sortedYs) {
      const lineItems = byY.get(y)!.sort((a, b) => a.x - b.x)
      const lineText = lineItems.map(i => i.str).join('').trim()
      if (lineText) allLines.push(lineText)
    }
  }

  return allLines
}

/**
 * Parse answer keys from plain text lines (PDF format).
 *
 * In PDFs, answer keys are plain paragraphs — no Word tables.
 * Format: header "Accounting I Answer Key" followed by "1) D", "2) A" etc.
 * The 2017-20 PDF also has a "OBJECTIVE TEST ANSWER KEYS" sentinel, but
 * we don't require it (same approach as DOCX fix).
 */
function parseAnswerKeysFromLines(
  lines: string[]
): Map<string, Record<number, ChoiceLetter>> {
  const keys = new Map<string, Record<number, ChoiceLetter>>()
  // Global: handles multi-column merged rows, space-optional after paren
  const entryRe = /(\d+)\)\s*([A-D])(?=[\s,]|$)/gi
  const headerRe = /^(.+?)\s+answer\s+key$/i

  // Pre-process: merge orphan "N)" lines with the following line.
  // PDF extraction sometimes splits "10)" and "A" onto separate lines.
  const merged: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (/^\d+\s*\)$/.test(trimmed) && i + 1 < lines.length) {
      merged.push(trimmed + ' ' + lines[i + 1].trim())
      i++
    } else {
      merged.push(trimmed)
    }
  }

  let currentKey: string | null = null
  let currentEntries: Record<number, ChoiceLetter> = {}
  let inAnswerSection = false

  for (const line of merged) {
    const trimmed = line.trim()

    if (/^objective test answer keys$/i.test(trimmed)) {
      inAnswerSection = true
      continue
    }

    const hm = trimmed.match(headerRe)
    if (hm) {
      if (currentKey && Object.keys(currentEntries).length > 0) {
        keys.set(currentKey, currentEntries)
      }
      inAnswerSection = true
      currentKey = normaliseTopicName(hm[1])
      currentEntries = {}
      continue
    }

    if (!inAnswerSection || !currentKey) continue

    // Normalize "30 )" -> "30)" before matching
    const normalised = trimmed.replace(/(\d+)\s+\)/g, '$1)')
    entryRe.lastIndex = 0
    for (const em of normalised.matchAll(entryRe)) {
      currentEntries[parseInt(em[1])] = em[2].toUpperCase() as ChoiceLetter
    }
  }

  if (currentKey && Object.keys(currentEntries).length > 0) {
    keys.set(currentKey, currentEntries)
  }

  return keys
}

// ---------------------------------------------------------------------------
// DOCX extraction
// ---------------------------------------------------------------------------

/**
 * Extract all text from a DOCX file, returning two separate line arrays:
 *   - bodyLines: paragraph text from the document body
 *   - tableLines: all text from table cells, flattened in reading order
 *
 * This split is necessary because answer keys are stored in 3-column Word
 * tables and would be missed by a paragraph-only extraction.
 */
async function extractDocxText(
  buffer: ArrayBuffer
): Promise<{ bodyLines: string[]; xmlDoc: Document }> {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(buffer)

  const docXml = await zip.file('word/document.xml')?.async('text')
  if (!docXml) throw new Error('Invalid DOCX file: missing document.xml')

  const parser = new DOMParser()
  const xmlDoc = parser.parseFromString(docXml, 'text/xml')
  const NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

  // Build set of paragraphs inside tables so we exclude them from body lines
  const tableParagraphSet = new Set<Element>()
  const tables = xmlDoc.getElementsByTagNameNS(NS, 'tbl')
  for (let t = 0; t < tables.length; t++) {
    const paras = tables[t].getElementsByTagNameNS(NS, 'p')
    for (let p = 0; p < paras.length; p++) {
      tableParagraphSet.add(paras[p])
    }
  }

  // Extract only non-table paragraphs for question parsing
  const bodyLines: string[] = []
  const allParas = xmlDoc.getElementsByTagNameNS(NS, 'p')
  for (let i = 0; i < allParas.length; i++) {
    if (tableParagraphSet.has(allParas[i])) continue
    const text = paragraphText(allParas[i], NS)
    if (text) bodyLines.push(text)
  }

  // Return xmlDoc so parseAnswerKeys can walk the DOM in document order
  return { bodyLines, xmlDoc }
}

function paragraphText(para: Element, NS: string): string {
  const runs = para.getElementsByTagNameNS(NS, 't')
  let text = ''
  for (let i = 0; i < runs.length; i++) {
    text += runs[i].textContent ?? ''
  }
  return text.trim()
}

// ---------------------------------------------------------------------------
// Answer key parsing
// ---------------------------------------------------------------------------

/**
 * Parse answer key entries from table lines.
 *
 * Table cells contain one entry per paragraph: "1) D", "11) A", "21) B" etc.
 * The topic header immediately precedes its entries as a body paragraph like
 * "Accounting I Answer Key".
 *
 * We combine body lines and table lines in document order, then walk through
 * looking for answer key headers followed by N) L entries.
 *
 * Returns a map: normalisedTopicName -> { [questionNumber]: letter }
 */
function parseAnswerKeys(
  _bodyLines: string[],
  _tableLines: string[],
  xmlDoc: Document
): Map<string, Record<number, ChoiceLetter>> {
  const keys = new Map<string, Record<number, ChoiceLetter>>()
  const NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

  const entryRe = /^(\d+)\)\s+([A-D])$/i
  const headerRe = /^(.+?)\s+answer\s+key$/i

  // Walk the document body's direct children in document order.
  // Each answer key topic has: a <w:p> header paragraph followed immediately
  // by a <w:tbl> table containing the N) L entries.
  // Walking in order guarantees each table is matched to the header above it,
  // regardless of how many topics are present or whether any are missing.
  const body = xmlDoc.getElementsByTagNameNS(NS, 'body')[0]
  if (!body) return keys

  let inAnswerKeySection = false
  let pendingTopicKey: string | null = null

  for (let i = 0; i < body.childNodes.length; i++) {
    const node = body.childNodes[i] as Element
    if (!node.tagName) continue
    const localName = node.localName ?? node.tagName.split(':').pop() ?? ''

    if (localName === 'p') {
      const text = Array.from(node.getElementsByTagNameNS(NS, 't'))
        .map(t => (t as Element).textContent ?? '')
        .join('')
        .trim()

      // Both formats: "OBJECTIVE TEST ANSWER KEYS" sentinel (2017-20)
      // or direct "X Answer Key" headers (2010-13, no sentinel).
      // Either way, any matching header enables answer key mode.
      if (/^objective test answer keys$/i.test(text)) {
        inAnswerKeySection = true
        continue
      }

      const m = text.match(headerRe)
      if (m) {
        inAnswerKeySection = true   // also works for 2010-13 with no sentinel
        pendingTopicKey = normaliseTopicName(m[1])
      }

    } else if (localName === 'tbl' && inAnswerKeySection && pendingTopicKey) {
      // Table immediately after an answer key header paragraph
      const entries: Record<number, ChoiceLetter> = {}
      const cellParas = node.getElementsByTagNameNS(NS, 'p')

      for (let j = 0; j < cellParas.length; j++) {
        const cellText = Array.from(cellParas[j].getElementsByTagNameNS(NS, 't'))
          .map(t => (t as Element).textContent ?? '')
          .join('')
          .trim()
        const em = cellText.match(entryRe)
        if (em) entries[parseInt(em[1])] = em[2].toUpperCase() as ChoiceLetter
      }

      if (Object.keys(entries).length > 0) keys.set(pendingTopicKey, entries)
      pendingTopicKey = null  // consume — next header sets a new one
    }
  }

  return keys
}

// ---------------------------------------------------------------------------
// Question parsing
// ---------------------------------------------------------------------------

/**
 * Detect whether this document uses the 2017-20 format (N) with uppercase A))
 * or the 2010-13 format (N. with lowercase a.).
 */
function detectFormat(lines: string[]): '2017' | '2010' {
  for (const line of lines) {
    if (/^\d+\)\s+\S/.test(line) && /^[A-D]\)\s/i.test(line)) return '2017'
    if (/^\d+\.\s+\S/.test(line)) return '2010'
    if (/^[A-D]\)\s/i.test(line)) return '2017'
    if (/^[a-d]\.\s/i.test(line)) return '2010'
  }
  return '2017' // default to newer format
}

/**
 * Parse all topic question blocks from body lines.
 *
 * A topic block starts at a line matching "[TOPIC NAME] SAMPLE QUESTIONS"
 * and ends at the next such header or at the answer key section.
 */
function parseTopicBlocks(
  bodyLines: string[],
  answerKeys: Map<string, Record<number, ChoiceLetter>>
): { topics: TopicBlock[]; issues: string[] } {
  const topics: TopicBlock[] = []
  const issues: string[] = []

  // Section header: "ACCOUNTING I SAMPLE QUESTIONS" or "HEALTH CARE ADMINISTRATION SAMPLE QUESTIONS"
  const sectionHeaderRe = /^(.+?)\s+sample\s+questions$/i

  // Split body lines into per-topic segments
  type Segment = { displayName: string; normName: string; lines: string[] }
  const segments: Segment[] = []
  let current: Segment | null = null

  for (const line of bodyLines) {
    const trimmed = line.trim()

    // Stop at answer key section
    if (/^objective test answer keys$/i.test(trimmed)) break

    const m = trimmed.match(sectionHeaderRe)
    if (m) {
      current = {
        displayName: toTitleCase(m[1]),
        normName: normaliseTopicName(m[1]),
        lines: [],
      }
      segments.push(current)
      continue
    }

    if (current) {
      current.lines.push(line)
    }
  }

  // Parse each segment into questions
  for (const seg of segments) {
    const fmt = detectFormat(seg.lines)
    const answerKey = answerKeys.get(seg.normName) ?? {}

    if (Object.keys(answerKey).length === 0) {
      issues.push(`No answer key found for topic "${seg.displayName}" (normalised: "${seg.normName}")`)
    }

    const questions = parseQuestionsFromLines(seg.lines, answerKey, fmt, seg.displayName, issues)

    topics.push({
      normalisedName: seg.normName,
      displayName: seg.displayName,
      questions,
    })
  }

  return { topics, issues }
}

/**
 * Parse questions from a single topic's lines using the detected format.
 */
function parseQuestionsFromLines(
  lines: string[],
  answerKey: Record<number, ChoiceLetter>,
  fmt: '2017' | '2010',
  topicDisplay: string,
  globalIssues: string[]
): ParsedQuestion[] {
  const questions: ParsedQuestion[] = []

  // Question number pattern differs by format
  // 2017: "1)" or "1)  Question text..."  (number may be inline with text)
  // 2010: "1. Question text..."
  const qNumRe = fmt === '2017'
    ? /^(\d+)\)\s*(.*)/
    : /^(\d+)\.\s*(.*)/

  // Choice pattern differs by format
  // 2017: "A) choice text" (uppercase)
  // 2010: "a. choice text" (lowercase) — but normalise to uppercase
  const choiceRe = fmt === '2017'
    ? /^([A-D])\)\s+(.*)/i
    : /^([A-Da-d])\.\s+(.*)/

  // Clean lines: remove junk, skip empty
  const cleaned = lines
    .map(l => l.trim())
    .filter(l => l.length > 0 && !isJunkLine(l))

  let i = 0

  while (i < cleaned.length) {
    const line = cleaned[i]
    const qMatch = line.match(qNumRe)

    if (!qMatch) {
      i++
      continue
    }

    const questionNumber = parseInt(qMatch[1])
    let questionText = qMatch[2].trim()
    i++

    // Handle edge case: first choice on same line as question number (2010 format edge case)
    // e.g. "5. Barriers... a. listening" — split at the choice marker
    if (fmt === '2010') {
      const inlineChoiceIdx = questionText.search(/\s+[a-d]\.\s/)
      if (inlineChoiceIdx !== -1) {
        const rest = questionText.slice(inlineChoiceIdx).trim()
        questionText = questionText.slice(0, inlineChoiceIdx).trim()
        // Push the inline choice back as the next line to process
        cleaned.splice(i, 0, rest)
      }
    }

    // Accumulate multi-line question text until we hit a choice or next question
    while (i < cleaned.length) {
      const next = cleaned[i]
      if (choiceRe.test(next)) break
      if (qNumRe.test(next)) break
      if (isJunkLine(next)) { i++; continue }
      // Stop at answer key section boundary
      if (/^.+\s+answer\s+key$/i.test(next.trim())) break
      if (/^objective test answer keys$/i.test(next.trim())) break
      // Append to question text (handles multi-line questions and embedded data tables)
      questionText += ' ' + next
      i++
    }

    questionText = questionText.trim()

    // Parse choices A–D.
    // Strategy: scan forward collecting all lines that match choiceRe,
    // stopping at the next question number or end of cleaned lines.
    // This is robust to stray body lines appearing between choices.
    const choices: ParsedChoice[] = []
    const issuesForQ: string[] = []

    while (choices.length < 4 && i < cleaned.length) {
      const cLine = cleaned[i]

      // Stop at next question — this question's choices are done
      if (qNumRe.test(cLine)) break

      // Skip junk lines silently
      if (isJunkLine(cLine)) { i++; continue }

      const cMatch = cLine.match(choiceRe)
      if (!cMatch) {
        // Non-choice, non-junk line between choices: skip it.
        // (e.g. a wrapped question text line that wasn't caught above,
        //  or a competency note the junk filter missed)
        i++
        continue
      }

      const letter = cMatch[1].toUpperCase() as ChoiceLetter
      let choiceText = cMatch[2].trim()
      i++

      // Accumulate multi-line choice text
      while (i < cleaned.length) {
        const next = cleaned[i]
        if (choiceRe.test(next)) break
        if (qNumRe.test(next)) break
        if (isJunkLine(next)) { i++; continue }
        // Stop at answer key section boundary
        if (/^.+\s+answer\s+key$/i.test(next.trim())) break
        if (/^objective test answer keys$/i.test(next.trim())) break
        choiceText += ' ' + next
        i++
      }

      // Check for inline next-choice marker within the accumulated text.
      // e.g. "non-persistent...remission  d. persistent..." in 2010 format.
      // The inline choice must be a different letter than the current one.
      if (fmt === '2010') {
        const inlineNextChoice = /\s{2,}([b-d])\.\s+/i
        const inlineIdx = choiceText.search(inlineNextChoice)
        if (inlineIdx !== -1) {
          const rest = choiceText.slice(inlineIdx).trim()
          choiceText = choiceText.slice(0, inlineIdx).trim()
          // Splice the inline next choice back as a line to process
          cleaned.splice(i, 0, rest)
        }
      }

      choices.push({ letter, text: choiceText.trim() })
    }

    // Validate choice completeness and order
    for (let ci = 0; ci < VALID_LETTERS.length; ci++) {
      const expected = VALID_LETTERS[ci]
      const found = choices[ci]
      if (!found) {
        issuesForQ.push(`Missing choice ${expected}`)
      } else if (found.letter !== expected) {
        issuesForQ.push(`Choice ${ci + 1} is ${found.letter}, expected ${expected}`)
      }
    }

    // Validation
    if (!questionText) {
      issuesForQ.push('Empty question text')
    }
    if (choices.length !== 4) {
      issuesForQ.push(`Has ${choices.length}/4 choices`)
    }

    const correctAnswer = answerKey[questionNumber] ?? null
    if (!correctAnswer) {
      issuesForQ.push('No answer in key')
    }

    questions.push({
      questionNumber,
      questionText,
      choices,
      correctAnswer,
      issues: issuesForQ,
    })
  }

  if (questions.length === 0) {
    globalIssues.push(`No questions found in topic "${topicDisplay}"`)
  }

  return questions
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function isJunkLine(line: string): boolean {
  const t = line.trim()
  return JUNK_LINE_PATTERNS.some(re => re.test(t))
}

/** Normalise a topic name for fuzzy matching: lowercase, collapse whitespace, trim. */
function normaliseTopicName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, ' ').trim()
}

function toTitleCase(str: string): string {
  return str
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase())
}

function computeStats(topics: TopicBlock[]) {
  let totalQuestions = 0, valid = 0, invalid = 0, missingAnswers = 0
  for (const t of topics) {
    for (const q of t.questions) {
      totalQuestions++
      if (q.issues.length === 0) valid++
      else invalid++
      if (!q.correctAnswer) missingAnswers++
    }
  }
  return { topics: topics.length, totalQuestions, valid, invalid, missingAnswers }
}

// ---------------------------------------------------------------------------
// Main parse entry point
// ---------------------------------------------------------------------------

async function parseDocument(file: File): Promise<ParseResult> {
  const buffer = await file.arrayBuffer()
  let bodyLines: string[]
  let answerKeys: Map<string, Record<number, ChoiceLetter>>

  if (file.name.toLowerCase().endsWith('.pdf')) {
    // PDF path: extract text lines, parse answer keys from plain paragraphs
    bodyLines = await extractPdfText(buffer)
    answerKeys = parseAnswerKeysFromLines(bodyLines)
  } else {
    // DOCX path: separate body paragraphs from table cells, use DOM walker
    const extracted = await extractDocxText(buffer)
    bodyLines = extracted.bodyLines
    answerKeys = parseAnswerKeys([], [], extracted.xmlDoc)
  }

  const { topics, issues } = parseTopicBlocks(bodyLines, answerKeys)
  return { topics, parsingIssues: issues, rawLines: bodyLines, stats: computeStats(topics) }
}

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

  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<{ count: number; topicCount: number } | null>(null)
  const [importErrors, setImportErrors] = useState<string[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Scroll page to top whenever the step changes.
  // Use window.scrollTo rather than scrollIntoView — the latter targets the
  // nearest scrollable ancestor which may be the chat container, not the page.
  useEffect(() => {
    const timer = setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 50)
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

  // --- Validate before import ---
  function canImport(): { blocked: boolean; reason?: string } {
    if (!parseResult) return { blocked: true }
    if (selectedTopics.size === 0) return { blocked: true, reason: 'No topics selected' }

    for (const normName of selectedTopics) {
      const topic = parseResult.topics.find(t => t.normalisedName === normName)!
      const name = topicNames[normName]?.trim()
      if (!name) return { blocked: true, reason: `Topic name cannot be empty (${topic.displayName})` }

      const missing = topic.questions.filter(q => !q.correctAnswer).length
      if (missing > 0 && !overridePartial.has(normName)) {
        return {
          blocked: true,
          reason: `"${topic.displayName}" has ${missing} unanswered question(s). Either override or deselect the topic.`,
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
      const topic = parseResult.topics.find(t => t.normalisedName === normName)!
      const topicName = topicNames[normName].trim()
      const usePartial = overridePartial.has(normName)

      // Determine which questions to import
      const toImport = topic.questions.filter(q => {
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
    <div ref={scrollRef} className="space-y-6">
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
              const missingCount = topic.questions.filter(q => !q.correctAnswer).length
              const otherIssues = topic.questions.filter(
                q => q.issues.some(i => i !== 'No answer in key')
              ).length
              const validCount = topic.questions.filter(q => q.issues.length === 0).length
              const isOverridden = overridePartial.has(normName)
              const isBlocked = isSelected && missingCount > 0 && !isOverridden

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
                        {topic.questions
                          .filter(q => q.issues.some(i => i !== 'No answer in key'))
                          .map(q => (
                            <div key={q.questionNumber} className="text-xs text-gray-600">
                              <span className="font-mono text-orange-500 mr-1">Q{q.questionNumber}</span>
                              {q.issues.filter(i => i !== 'No answer in key').join('; ')}
                            </div>
                          ))}
                      </div>
                    </details>
                  )}
                </div>
              )
            })}
          </div>

          {/* Raw parse viewer */}
          <details className="border border-gray-200 rounded-lg">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-gray-600 hover:bg-gray-50">
              🔍 Show raw parse data (for debugging)
            </summary>
            <div className="border-t divide-y divide-gray-100 text-xs font-mono">
              {/* Per-topic question breakdown */}
              {parseResult.topics.map(topic => (
                <details key={topic.normalisedName} className="group">
                  <summary className="cursor-pointer px-4 py-2 bg-gray-50 font-sans text-sm font-medium text-gray-700 hover:bg-gray-100">
                    {topic.displayName} — {topic.questions.length} questions
                  </summary>
                  <div className="max-h-96 overflow-y-auto">
                    {topic.questions.map(q => (
                      <div key={q.questionNumber} className={`px-4 py-2 border-l-4 ${q.issues.length > 0 ? 'border-red-400 bg-red-50' : 'border-green-400 bg-white'}`}>
                        <div className="font-sans font-medium text-gray-800 mb-1">
                          Q{q.questionNumber}
                          {q.correctAnswer && <span className="ml-2 text-green-600">✓ {q.correctAnswer}</span>}
                          {!q.correctAnswer && <span className="ml-2 text-red-500">no answer</span>}
                          {q.issues.length > 0 && (
                            <span className="ml-2 text-red-600 text-xs">[{q.issues.join(' | ')}]</span>
                          )}
                        </div>
                        <div className="text-gray-600 mb-1 whitespace-pre-wrap">{q.questionText || '(empty)'}</div>
                        {q.choices.map(c => (
                          <div key={c.letter} className={`ml-2 ${c.letter === q.correctAnswer ? 'text-green-700 font-semibold' : 'text-gray-500'}`}>
                            {c.letter}) {c.text}
                          </div>
                        ))}
                        {q.choices.length === 0 && <div className="ml-2 text-red-500 italic">no choices parsed</div>}
                      </div>
                    ))}
                  </div>
                </details>
              ))}
              {/* Raw extracted lines */}
              <details>
                <summary className="cursor-pointer px-4 py-2 bg-gray-50 font-sans text-sm font-medium text-gray-700 hover:bg-gray-100">
                  Raw extracted lines ({parseResult.rawLines.length})
                </summary>
                <div className="max-h-96 overflow-y-auto px-4 py-2 space-y-0.5">
                  {parseResult.rawLines.map((line, idx) => (
                    <div key={idx} className="flex gap-3">
                      <span className="text-gray-300 select-none w-8 text-right shrink-0">{idx}</span>
                      <span className="text-gray-700 whitespace-pre-wrap break-all">{line}</span>
                    </div>
                  ))}
                </div>
              </details>
            </div>
          </details>

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
                    const t = parseResult.topics.find(t => t.normalisedName === k)!
                    const partial = overridePartial.has(k)
                    return n + t.questions.filter(q =>
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