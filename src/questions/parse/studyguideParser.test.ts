/*
 * studyguideParser.test.ts
 * Regression tests for the FBLA study guide parser. The weird inputs here are
 * not hypothetical — each one reproduces an artifact actually seen in the
 * 2010-13 / 2017-20 guide PDFs (OCR spaces, misread parens, packed answer
 * lines, orphaned question numbers). If a regex change breaks one of these,
 * a real guide import breaks with it.
 */
import { describe, expect, it } from 'vitest'
import {
  detectFormat,
  matchAnswerKeyHeader,
  normaliseTopicName,
  normaliseTopicNameFuzzy,
  parseAnswerKeysFromLines,
  parseFromLines,
} from './studyguideParser'

// ---------------------------------------------------------------------------
// matchAnswerKeyHeader
// ---------------------------------------------------------------------------

describe('matchAnswerKeyHeader', () => {
  it('matches a well-formed header', () => {
    expect(matchAnswerKeyHeader('Accounting I Answer Key')).toBe('Accounting I')
  })

  it('is case-insensitive', () => {
    expect(matchAnswerKeyHeader('ACCOUNTING II ANSWER KEY')).toBe('ACCOUNTING II')
  })

  it('tolerates OCR spaces inside "Answer Key"', () => {
    expect(matchAnswerKeyHeader('Introduction to Business Answe r Key')).toBe(
      'Introduction to Business'
    )
  })

  it('tolerates OCR spaces inside the topic name AND the suffix', () => {
    expect(
      matchAnswerKeyHeader('Intr oduction to Parliamentary Pr ocedure Answe r Key')
    ).toBe('Intr oduction to Parliamentary Pr ocedure')
  })

  it('rejects non-header lines', () => {
    expect(matchAnswerKeyHeader('Accounting I Sample Questions')).toBeNull()
    expect(matchAnswerKeyHeader('1) B')).toBeNull()
  })

  it('rejects a bare "Answer Key" with no topic name', () => {
    expect(matchAnswerKeyHeader('Answer Key')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// parseAnswerKeysFromLines (PDF / plain-text answer keys)
// ---------------------------------------------------------------------------

describe('parseAnswerKeysFromLines', () => {
  function keyFor(lines: string[], topic: string) {
    return parseAnswerKeysFromLines(lines).get(normaliseTopicName(topic))
  }

  it('parses a simple key', () => {
    const key = keyFor(['Economics Answer Key', '1) A 2) B 3) C'], 'Economics')
    expect(key).toEqual({ 1: 'A', 2: 'B', 3: 'C' })
  })

  it('parses multi-line and comma-separated entries', () => {
    const key = keyFor(
      ['Economics Answer Key', '1) A, 2) B', '3) D'],
      'Economics'
    )
    expect(key).toEqual({ 1: 'A', 2: 'B', 3: 'D' })
  })

  it('handles packed entries with no separator ("5) C15) A26) A")', () => {
    const key = keyFor(['Economics Answer Key', '5) C15) A26) A'], 'Economics')
    expect(key).toEqual({ 5: 'C', 15: 'A', 26: 'A' })
  })

  it('handles a missing paren ("10 B")', () => {
    const key = keyFor(['Economics Answer Key', '10 B'], 'Economics')
    expect(key).toEqual({ 10: 'B' })
  })

  it('handles an OCR-misread paren ("20Y D")', () => {
    const key = keyFor(['Economics Answer Key', '20Y D'], 'Economics')
    expect(key).toEqual({ 20: 'D' })
  })

  it('normalises spaced parens ("30 ) D")', () => {
    const key = keyFor(['Economics Answer Key', '30 ) D'], 'Economics')
    expect(key).toEqual({ 30: 'D' })
  })

  it('merges a forward-orphaned number ("6)" then "B 16) C")', () => {
    const key = keyFor(['Economics Answer Key', '6)', 'B 16) C 26) B'], 'Economics')
    expect(key).toEqual({ 6: 'B', 16: 'C', 26: 'B' })
  })

  it('recovers a backward-orphaned number ("C 20) D 30) D" then "10)")', () => {
    const key = keyFor(['Economics Answer Key', 'C 20) D 30) D', '10)'], 'Economics')
    expect(key).toEqual({ 10: 'C', 20: 'D', 30: 'D' })
  })

  it('stores keys under the fuzzy (space-collapsed) topic name too', () => {
    const keys = parseAnswerKeysFromLines([
      'Intr oduction to Business Answe r Key',
      '1) A',
    ])
    expect(keys.get(normaliseTopicNameFuzzy('Introduction to Business'))).toEqual({
      1: 'A',
    })
  })

  it('separates multiple topics', () => {
    const lines = [
      'Accounting I Answer Key',
      '1) A 2) B',
      'Economics Answer Key',
      '1) C 2) D',
    ]
    expect(keyFor(lines, 'Accounting I')).toEqual({ 1: 'A', 2: 'B' })
    expect(keyFor(lines, 'Economics')).toEqual({ 1: 'C', 2: 'D' })
  })
})

// ---------------------------------------------------------------------------
// detectFormat
// ---------------------------------------------------------------------------

describe('detectFormat', () => {
  it('detects the 2017-20 format (N) / A))', () => {
    expect(detectFormat(['1) What is a debit?', 'A) An increase'])).toBe('2017')
  })

  it('detects the 2010-13 format (N. / a.)', () => {
    expect(detectFormat(['1. What is a debit?', 'a. An increase'])).toBe('2010')
  })

  it('defaults to 2017 when ambiguous', () => {
    expect(detectFormat(['no markers here'])).toBe('2017')
  })
})

// ---------------------------------------------------------------------------
// Topic name normalisation
// ---------------------------------------------------------------------------

describe('topic name normalisation', () => {
  it('lowercases, collapses whitespace, trims', () => {
    expect(normaliseTopicName('  Accounting   I  ')).toBe('accounting i')
  })

  it('fuzzy form removes all spaces', () => {
    expect(normaliseTopicNameFuzzy('Intr oduction to Business')).toBe(
      'introductiontobusiness'
    )
  })
})

// ---------------------------------------------------------------------------
// parseFromLines — end-to-end on plain text (the PDF path)
// ---------------------------------------------------------------------------

describe('parseFromLines (2017-20 format)', () => {
  const DOC = [
    'ACCOUNTING I SAMPLE QUESTIONS',
    '1) Which financial statement reports assets and liabilities?',
    'A) Income statement',
    'B) Balance sheet',
    'C) Cash flow statement',
    'D) Statement of owner equity',
    '2) Which account normally increases with a debit?',
    'A) Revenue',
    'B) Liability',
    'C) Asset',
    'D) Capital',
    'OBJECTIVE TEST ANSWER KEYS',
    'Accounting I Answer Key',
    '1) B 2) C',
  ]

  it('parses topics, questions, choices, and answers', () => {
    const result = parseFromLines(DOC)
    expect(result.topics).toHaveLength(1)

    const topic = result.topics[0]
    expect(topic.displayName).toBe('Accounting I')
    expect(topic.questions).toHaveLength(2)

    const [q1, q2] = topic.questions
    expect(q1.questionText).toBe(
      'Which financial statement reports assets and liabilities?'
    )
    expect(q1.choices.map(c => c.letter)).toEqual(['A', 'B', 'C', 'D'])
    expect(q1.choices[1].text).toBe('Balance sheet')
    expect(q1.correctAnswer).toBe('B')
    expect(q1.issues).toEqual([])
    expect(q2.correctAnswer).toBe('C')
  })

  it('computes stats', () => {
    const { stats } = parseFromLines(DOC)
    expect(stats).toEqual({
      topics: 1,
      totalQuestions: 2,
      valid: 2,
      invalid: 0,
      missingAnswers: 0,
    })
  })

  it('skips junk lines (page numbers, copyright, URLs)', () => {
    const noisy = [
      DOC[0],
      '© FBLA-PBL Inc.',
      '42',
      'www.fbla-pbl.org',
      ...DOC.slice(1),
    ]
    const result = parseFromLines(noisy)
    expect(result.topics[0].questions).toHaveLength(2)
    expect(result.topics[0].questions[0].issues).toEqual([])
  })

  it('joins multi-line question text', () => {
    const doc = [
      'ACCOUNTING I SAMPLE QUESTIONS',
      '1) A very long question that was',
      'split across two lines by the PDF?',
      'A) one',
      'B) two',
      'C) three',
      'D) four',
      'OBJECTIVE TEST ANSWER KEYS',
      'Accounting I Answer Key',
      '1) A',
    ]
    const q = parseFromLines(doc).topics[0].questions[0]
    expect(q.questionText).toBe(
      'A very long question that was split across two lines by the PDF?'
    )
  })

  it('flags missing choices and missing answers', () => {
    const doc = [
      'ECONOMICS SAMPLE QUESTIONS',
      '1) A question missing choice D?',
      'A) one',
      'B) two',
      'C) three',
      'OBJECTIVE TEST ANSWER KEYS',
      'Economics Answer Key',
      '2) A', // no entry for question 1
    ]
    const q = parseFromLines(doc).topics[0].questions[0]
    expect(q.issues).toContain('Missing choice D')
    expect(q.issues).toContain('Has 3/4 choices')
    expect(q.issues).toContain('No answer in key')
    expect(q.correctAnswer).toBeNull()
  })

  it('matches an OCR-spaced answer key header to its topic via fuzzy lookup', () => {
    const doc = [
      'INTRODUCTION TO BUSINESS SAMPLE QUESTIONS',
      '1) What is a sole proprietorship?',
      'A) one owner',
      'B) two owners',
      'C) a corporation',
      'D) a partnership',
      'OBJECTIVE TEST ANSWER KEYS',
      'Intr oduction to Business Answe r Key',
      '1) A',
    ]
    const q = parseFromLines(doc).topics[0].questions[0]
    expect(q.correctAnswer).toBe('A')
    expect(q.issues).toEqual([])
  })
})

describe('parseFromLines (2010-13 format)', () => {
  it('parses lowercase dotted choices, with and without a space after the dot', () => {
    const doc = [
      'BUSINESS MATH SAMPLE QUESTIONS',
      '1. What is 10% of 50?',
      'a. 5',
      'b.10',
      'c. 15',
      'd. 20',
      'Business Math Answer Key',
      '1) A',
    ]
    const q = parseFromLines(doc).topics[0].questions[0]
    expect(q.choices.map(c => c.letter)).toEqual(['A', 'B', 'C', 'D'])
    expect(q.choices[1].text).toBe('10')
    expect(q.correctAnswer).toBe('A')
    expect(q.issues).toEqual([])
  })

  it('splits choices merged onto the question line', () => {
    const doc = [
      'BUSINESS COMMUNICATION SAMPLE QUESTIONS',
      '1. Barriers to communication include a. noise b. feedback c. channels d. all of the above',
      'Business Communication Answer Key',
      '1) D',
    ]
    const q = parseFromLines(doc).topics[0].questions[0]
    expect(q.questionText).toBe('Barriers to communication include')
    expect(q.choices.map(c => c.text)).toEqual([
      'noise',
      'feedback',
      'channels',
      'all of the above',
    ])
    expect(q.correctAnswer).toBe('D')
  })
})
