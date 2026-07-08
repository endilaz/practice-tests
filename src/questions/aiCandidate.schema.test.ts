import { describe, expect, it } from 'vitest'
import { aiCandidateSchema, aiGenerateResponseSchema } from './aiCandidate.schema'

function validCandidate() {
  return {
    question_text: 'What is the accounting equation?',
    explanation_text: 'Assets equal liabilities plus equity.',
    choices: [
      { letter: 'A', text: 'Assets = Liabilities + Equity', is_correct: true },
      { letter: 'B', text: 'Assets = Liabilities - Equity', is_correct: false },
      { letter: 'C', text: 'Assets = Revenue + Expenses', is_correct: false },
      { letter: 'D', text: 'Assets = Equity - Liabilities', is_correct: false },
    ],
  }
}

describe('aiCandidateSchema', () => {
  it('accepts a valid candidate', () => {
    const result = aiCandidateSchema.safeParse(validCandidate())
    expect(result.success).toBe(true)
  })

  it('defaults a missing explanation to an empty string', () => {
    const { explanation_text: _omitted, ...rest } = validCandidate()
    const result = aiCandidateSchema.safeParse(rest)
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.explanation_text).toBe('')
  })

  it('rejects a candidate with fewer than 4 choices', () => {
    const candidate = validCandidate()
    candidate.choices = candidate.choices.slice(0, 3)
    expect(aiCandidateSchema.safeParse(candidate).success).toBe(false)
  })

  it('rejects duplicate choice letters', () => {
    const candidate = validCandidate()
    candidate.choices[3].letter = 'A'
    expect(aiCandidateSchema.safeParse(candidate).success).toBe(false)
  })

  it('rejects zero correct answers', () => {
    const candidate = validCandidate()
    candidate.choices[0].is_correct = false
    expect(aiCandidateSchema.safeParse(candidate).success).toBe(false)
  })

  it('rejects two correct answers', () => {
    const candidate = validCandidate()
    candidate.choices[1].is_correct = true
    expect(aiCandidateSchema.safeParse(candidate).success).toBe(false)
  })

  it('rejects empty question text', () => {
    const candidate = validCandidate()
    candidate.question_text = '   '
    expect(aiCandidateSchema.safeParse(candidate).success).toBe(false)
  })

  it('rejects overlong choice text', () => {
    const candidate = validCandidate()
    candidate.choices[0].text = 'x'.repeat(501)
    expect(aiCandidateSchema.safeParse(candidate).success).toBe(false)
  })
})

describe('aiGenerateResponseSchema', () => {
  it('accepts a response with at least one candidate', () => {
    const result = aiGenerateResponseSchema.safeParse({ candidates: [validCandidate()] })
    expect(result.success).toBe(true)
  })

  it('rejects an empty candidate list', () => {
    expect(aiGenerateResponseSchema.safeParse({ candidates: [] }).success).toBe(false)
  })

  it('rejects a response missing the candidates key', () => {
    expect(aiGenerateResponseSchema.safeParse({}).success).toBe(false)
  })
})
