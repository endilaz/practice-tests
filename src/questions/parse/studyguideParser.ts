/*
 * studyguideParser.ts
 * Pure parsing logic for FBLA study guide imports (DOCX + PDF), extracted
 * from DocxImportStudyguides.tsx so it can be unit-tested. Everything here
 * except extractPdfText/extractDocxText/parseDocument is plain
 * string-in/data-out and runs under Node — see studyguideParser.test.ts.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ChoiceLetter = 'A' | 'B' | 'C' | 'D'

export type ParsedChoice = {
  letter: ChoiceLetter
  text: string
}

export type ParsedQuestion = {
  questionNumber: number
  questionText: string
  choices: ParsedChoice[]
  correctAnswer: ChoiceLetter | null
  issues: string[]
}

export type TopicBlock = {
  /** Normalised key used for answer key matching, e.g. "accounting i" */
  normalisedName: string
  /** Display name as it appeared in the document, e.g. "Accounting I" */
  displayName: string
  questions: ParsedQuestion[]
}

export type ParseResult = {
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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const VALID_LETTERS: ChoiceLetter[] = ['A', 'B', 'C', 'D']

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
      const yKey = Math.round(item.y / 4) * 4
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
 * Match an "X Answer Key" header line, tolerating OCR-introduced spaces
 * anywhere in the line — including inside the topic name itself.
 * e.g. "Introduction to Parliamentary Pr ocedure Answer Key"
 *      "Introduction to Business Answe r Key"
 *
 * Strategy:
 *   1. Collapse ALL whitespace and check if the result ends with "answerkey".
 *   2. If so, walk backwards through the original line consuming the characters
 *      of "answerkey" (skipping spaces), then return whatever precedes that
 *      suffix as the topic name (trimmed).
 *
 * Returns the topic name portion (original spacing preserved, trimmed), or null.
 */
export function matchAnswerKeyHeader(line: string): string | null {
  // Fast path: normal well-formed header
  const direct = line.match(/^(.+?)\s+answer\s+key$/i)
  if (direct) return direct[1].trim()

  // Slow path: collapse and check, then recover topic name from original
  const collapsed = line.replace(/\s+/g, '')
  if (!/^.+answerkey$/i.test(collapsed)) return null

  // Walk backwards through `line`, matching "answerkey" right-to-left,
  // skipping any spaces we encounter.
  const target = 'answerkey'   // 9 chars
  let ti = target.length - 1   // index into target (right-to-left)
  let li = line.length - 1     // index into original line

  while (li >= 0 && ti >= 0) {
    const ch = line[li].toLowerCase()
    if (ch === ' ') { li--; continue }         // skip spaces in original
    if (ch === target[ti]) { ti--; li-- }      // matched next target char
    else break                                 // mismatch — shouldn't happen after collapsed check
  }

  // Everything before position li+1 is the topic name
  const topicPart = line.slice(0, li + 1).trim()
  return topicPart.length > 0 ? topicPart : null
}

/**
 * Parse answer keys from plain text lines (PDF format).
 *
 * In PDFs, answer keys are plain paragraphs — no Word tables.
 * Format: header "Accounting I Answer Key" followed by "1) D", "2) A" etc.
 * The 2017-20 PDF also has a "OBJECTIVE TEST ANSWER KEYS" sentinel, but
 * we don't require it (same approach as DOCX fix).
 */
export function parseAnswerKeysFromLines(
  lines: string[]
): Map<string, Record<number, ChoiceLetter>> {
  const keys = new Map<string, Record<number, ChoiceLetter>>()
  // Global: handles multi-column merged rows, space-optional after paren
  // Paren may be a literal ")" or an OCR-misread glyph (Y, l, j, etc.).
  // A fully missing paren (fix 1) is also accepted when the number is
  // preceded by a word boundary so we don't match arbitrary numbers in text.
  // const entryRe = /(?<!\d)(\d+)[)Ylj]?\s*([A-D])(?=[\s,\d]|$)/gi
  // const headerRe = /^(.+?)\s+answer\s+key$/i
  // headerRe removed — replaced by matchAnswerKeyHeader() helper

  // Pre-process orphan "N)" lines — two cases:
  //
  // Case A (forward): orphan is followed by a line that starts with [A-D].
  //   e.g. "6)\nB 16) C 26) B" → "6) B 16) C 26) B"
  //   The orphan number's answer is the letter at the start of the next line.
  //
  // Case B (backward): orphan follows a line that already contains answer entries,
  //   meaning the PDF printed the number on the next line after its answer letter.
  //   e.g. "C 20) D 30) D\n10)" → the orphan 10 belongs BEFORE 20 on the prev line.
  //   We find 10's answer (the "C" that precedes "20)") and insert "10) C" in
  //   sorted order so the line becomes "10) C 20) D 30) D".

  // Regex for a bare orphan line: just a number and optional misread paren
  const ORPHAN_RE = /^\d+[)Ylj]?\s*$/

  // First pass — Case A
  const merged: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    const nextLine = i + 1 < lines.length ? lines[i + 1].trim() : ''

    if (ORPHAN_RE.test(trimmed) && /^[A-D](?:\s|$)/i.test(nextLine)) {
      // Normalise the paren while merging
      merged.push(trimmed.replace(/[Ylj]/, ')') + ' ' + nextLine)
      i++ // consume next line
    } else {
      merged.push(trimmed)
    }
  }

  // Second pass — Case B (iterate backwards so splices don't shift indices)
  // Lookahead allows: whitespace, comma, digit (start of next entry), or end-of-string.
  // The digit case handles packed lines like "5) C15) A26) A" with no separator.
  const ENTRY_SCAN_RE = /(?<!\d)(\d+)[)Ylj]?\s*([A-D])(?=[\s,\d]|$)/gi

  for (let i = merged.length - 1; i > 0; i--) {
    const line = merged[i].trim()
    if (!ORPHAN_RE.test(line)) continue

    const orphanNum = parseInt(line.match(/\d+/)![0])
    const prevLine = merged[i - 1].trim()

    // Extract all (number → letter) entries from the previous line in text order
    type Entry = { num: number; letter: string; raw: string; index: number }
    const prevEntries: Entry[] = []
    for (const em of prevLine.matchAll(ENTRY_SCAN_RE)) {
      prevEntries.push({
        num: parseInt(em[1]),
        letter: em[2].toUpperCase(),
        raw: em[0].trim(),
        index: em.index ?? 0,
      })
    }

    // Previous line must have at least one entry to be an answer-key line
    if (prevEntries.length === 0) continue

    // Find the orphan's answer letter: it's the letter that immediately precedes
    // the first entry whose number is greater than orphanNum.
    // e.g. prevLine = "C 20) D 30) D", orphanNum=10
    //   → nextHigher=20, text before "20) D" is "C " → orphanLetter = "C"
    let orphanLetter: string | null = null
    const sortedByNum = [...prevEntries].sort((a, b) => a.num - b.num)
    const nextHigherEntry = sortedByNum.find(e => e.num > orphanNum)

    if (nextHigherEntry) {
      // Scan backwards from just before nextHigherEntry for a bare letter
      const before = prevLine.slice(0, nextHigherEntry.index)
      const lm = before.match(/([A-D])\s*$/i)
      if (lm) orphanLetter = lm[1].toUpperCase()
    } else {
      // orphanNum > all existing entries — its answer is after the last entry
      const lastEntry = prevEntries[prevEntries.length - 1]
      const afterIdx = lastEntry.index + lastEntry.raw.length
      const after = prevLine.slice(afterIdx)
      const lm = after.match(/^\s*([A-D])/i)
      if (lm) orphanLetter = lm[1].toUpperCase()
    }

    if (!orphanLetter) continue // can't determine answer — leave as-is

    // Rebuild previous line with orphan inserted at its sorted position
    const orphanToken = `${orphanNum}) ${orphanLetter}`
    const insertBefore = prevEntries.find(e => e.num > orphanNum)
    let newPrevLine: string
    if (insertBefore) {
      newPrevLine = (
        prevLine.slice(0, insertBefore.index) +
        orphanToken + ' ' +
        prevLine.slice(insertBefore.index)
      ).trim()
    } else {
      newPrevLine = (prevLine + ' ' + orphanToken).trim()
    }

    merged[i - 1] = newPrevLine
    merged.splice(i, 1) // remove consumed orphan line
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

    const topicPart = matchAnswerKeyHeader(trimmed)
    if (topicPart) {
      if (currentKey && Object.keys(currentEntries).length > 0) {
        keys.set(currentKey, currentEntries)
        // Also store under fully space-collapsed key so that OCR spaces inside
        // the topic name (e.g. "Intr oduction to...") don't break fuzzy lookup
        keys.set(normaliseTopicNameFuzzy(currentKey), currentEntries)
      }
      inAnswerSection = true
      currentKey = normaliseTopicName(topicPart)
      currentEntries = {}
      continue
    }

    if (!inAnswerSection || !currentKey) continue

    // Normalize "30 )" -> "30)" before matching
    const normalised = trimmed.replace(/(\d+)\s+\)/g, '$1)')
    // Lookahead: whitespace, comma, digit (packed entries like "5)C15)A"), or end-of-string
    for (const em of normalised.matchAll(/(?<!\d)(\d+)[)Ylj]?\s*([A-D])(?=[\s,\d]|$)/gi)) {
      currentEntries[parseInt(em[1])] = em[2].toUpperCase() as ChoiceLetter
    }
  }

  if (currentKey && Object.keys(currentEntries).length > 0) {
    // Store under fuzzy key too for PDF mid-word-split recovery
    keys.set(currentKey, currentEntries)
    keys.set(normaliseTopicNameFuzzy(currentKey), currentEntries)
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

  const entryRe = /^(\d+)[)Ylj]?\s*([A-D])$/i
  // headerRe replaced by matchAnswerKeyHeader() for OCR-space tolerance

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

      const topicPart = matchAnswerKeyHeader(text)
      if (topicPart) {
        inAnswerKeySection = true   // also works for 2010-13 with no sentinel
        pendingTopicKey = normaliseTopicName(topicPart)
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

      if (Object.keys(entries).length > 0) {
        keys.set(pendingTopicKey, entries)
        // Also store under space-collapsed key for OCR-space topic name tolerance
        keys.set(normaliseTopicNameFuzzy(pendingTopicKey), entries)
      }
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
export function detectFormat(lines: string[]): '2017' | '2010' {
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
export function parseTopicBlocks(
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
    const answerKey = answerKeys.get(seg.normName)
      ?? answerKeys.get(normaliseTopicNameFuzzy(seg.normName))
      ?? {}

    if (Object.keys(answerKey).length === 0) {
      issues.push(`No answer key found for topic "${seg.displayName}"`)      
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
  // 2017: "A) choice text" (uppercase) — space after paren required
  // 2010: "a. choice text" or "a.choice text" (lowercase, space optional after dot)
  //       Both forms occur in practice, especially when PDF merges items onto one line.
  const choiceRe = fmt === '2017'
    ? /^([A-D])\)\s+(.*)/i
    : /^([A-Da-d])\.\s*(.*)/    // \s* — space after dot is optional

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
    // e.g. "5. Barriers... a. listening" or "5. Question text a.ROM b.virtual PC"
    // Split at the first choice marker — space after dot is optional.
    if (fmt === '2010') {
      const inlineChoiceIdx = questionText.search(/\s+[a-d]\.\s*/i)
      if (inlineChoiceIdx !== -1) {
        const rest = questionText.slice(inlineChoiceIdx).trim()
        questionText = questionText.slice(0, inlineChoiceIdx).trim()
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
      // e.g. "non-persistent...remission  d. persistent..." or "ROM b.virtual PC"
      // Space after dot is optional; require at least one space before the letter.
      if (fmt === '2010') {
        const inlineNextChoice = /\s+([b-d])\.\s*/i
        const inlineIdx = choiceText.search(inlineNextChoice)
        if (inlineIdx !== -1) {
          const rest = choiceText.slice(inlineIdx).trim()
          choiceText = choiceText.slice(0, inlineIdx).trim()
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

/** Normalise a topic name: lowercase, collapse whitespace, trim. */
export function normaliseTopicName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * Fuzzy-normalise: remove ALL spaces. Fallback for PDF mid-word splits
 * e.g. "Pr ocedure" -> "procedure" matches "procedure".
 */
export function normaliseTopicNameFuzzy(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '')
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
// Parse pipeline — shared by initial file parse and re-parse-from-text
// ---------------------------------------------------------------------------

/**
 * Run the question + answer-key parsing pipeline on already-extracted lines.
 * Used by both the initial file parse and the "re-parse from edited text" path.
 *
 * For DOCX files the answer key lives in Word tables (not body paragraphs), so
 * an optional xmlDoc can be supplied to re-extract table-based keys via the DOM
 * walker. For PDF and re-parse-from-text paths, answer keys are parsed directly
 * from the lines (they appear as plain paragraphs in both those cases).
 */
export function parseFromLines(
  lines: string[],
  xmlDoc?: Document
): ParseResult {
  const answerKeys = xmlDoc
    ? parseAnswerKeys([], [], xmlDoc)          // DOCX: keys in Word tables
    : parseAnswerKeysFromLines(lines)          // PDF / re-parse: keys inline

  const { topics, issues } = parseTopicBlocks(lines, answerKeys)
  return { topics, parsingIssues: issues, rawLines: lines, stats: computeStats(topics) }
}

export async function parseDocument(file: File): Promise<ParseResult> {
  const buffer = await file.arrayBuffer()

  if (file.name.toLowerCase().endsWith('.pdf')) {
    const bodyLines = await extractPdfText(buffer)
    return parseFromLines(bodyLines)
  } else {
    const { bodyLines, xmlDoc } = await extractDocxText(buffer)
    // Pass xmlDoc so table-based answer keys are parsed from the DOM.
    return parseFromLines(bodyLines, xmlDoc)
  }
}
