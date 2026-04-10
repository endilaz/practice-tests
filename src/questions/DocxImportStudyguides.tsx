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
function matchAnswerKeyHeader(line: string): string | null {
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
function parseAnswerKeysFromLines(
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
function normaliseTopicName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * Fuzzy-normalise: remove ALL spaces. Fallback for PDF mid-word splits
 * e.g. "Pr ocedure" -> "procedure" matches "procedure".
 */
function normaliseTopicNameFuzzy(name: string): string {
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

  // In-memory question edits: shadows parseResult.topics[].questions per topic.
  // Populated lazily when the user first opens a topic's editor panel.
  // Stored as a full ParsedQuestion[] copy so deletes and field edits are independent
  // of the original parse result (which is never mutated).
  const [editedQuestions, setEditedQuestions] = useState<Record<string, ParsedQuestion[]>>({})
  // Which topics currently have their editor panel expanded
  const [expandedEditors, setExpandedEditors] = useState<Set<string>>(new Set())

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
      const topic = parseResult.topics.find(t => t.normalisedName === normName)!
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
              const isBlocked = isSelected && missingCount > 0 && !isOverridden
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
                          .map(q => (
                            <div key={q.questionNumber} className="text-xs text-gray-600">
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
                          {live.map(q => {
                            // Issues still relevant after any edits
                            const activeIssues = q.issues.filter(
                              i => i !== 'No answer in key' || !q.correctAnswer
                            )
                            return (
                              <div
                                key={q.questionNumber}
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