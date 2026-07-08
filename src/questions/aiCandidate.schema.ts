/*
 * aiCandidate.schema.ts
 * Validates candidate questions returned by the generate-questions Edge
 * Function before they are shown in the review UI. Mirrors the shape rules of
 * questionSchema (4 choices, letters A–D once each, exactly one correct) —
 * approved candidates are re-validated through questionSchema on insert.
 */
import { z } from 'zod'

const candidateChoiceSchema = z.object({
  letter: z.enum(['A', 'B', 'C', 'D']),
  text: z.string().trim().min(1, 'Choice text is required').max(500, 'Choice text too long'),
  is_correct: z.boolean(),
})

export const aiCandidateSchema = z.object({
  question_text: z
    .string()
    .trim()
    .min(1, 'Question text is required')
    .max(2000, 'Question text cannot exceed 2000 characters'),
  explanation_text: z.string().trim().max(2000, 'Explanation too long').optional().default(''),
  choices: z.array(candidateChoiceSchema).length(4, 'Must have exactly 4 choices'),
}).refine(
  (data) => data.choices.filter(c => c.is_correct).length === 1,
  { message: 'Exactly one choice must be marked as correct', path: ['choices'] }
).refine(
  (data) => {
    const letters = data.choices.map(c => c.letter).sort()
    return JSON.stringify(letters) === JSON.stringify(['A', 'B', 'C', 'D'])
  },
  { message: 'Must have choices A, B, C, and D exactly once each', path: ['choices'] }
)

export type AiCandidate = z.infer<typeof aiCandidateSchema>

export const aiGenerateResponseSchema = z.object({
  candidates: z.array(aiCandidateSchema).min(1, 'No candidates returned'),
})
