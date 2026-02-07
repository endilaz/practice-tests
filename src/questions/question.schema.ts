import { z } from 'zod'

const choiceSchema = z.object({
  letter: z.enum(['A', 'B', 'C', 'D']),
  text: z.string().trim().min(1, 'Choice text is required').max(500, 'Choice text too long'),
  is_correct: z.boolean(),
})

export const questionSchema = z.object({
  topic_id: z.string().uuid('Please select a valid topic'),
  question_text: z
    .string()
    .trim()
    .min(1, 'Question text is required')
    .max(2000, 'Question text cannot exceed 2000 characters'),
  explanation_text: z.string().trim().max(2000, 'Explanation too long').optional(),
  difficulty_level: z
    .number()
    .int()
    .min(1)
    .max(5)
    .nullable()
    .optional(),
  choices: z.array(choiceSchema).length(4, 'Must have exactly 4 choices'),
}).refine(
  (data) => {
    // Exactly one choice must be correct
    const correctCount = data.choices.filter(c => c.is_correct).length
    return correctCount === 1
  },
  { message: 'Exactly one choice must be marked as correct', path: ['choices'] }
).refine(
  (data) => {
    // All choices must have non-empty text after trim
    return data.choices.every(c => c.text.trim().length > 0)
  },
  { message: 'All choices must have text', path: ['choices'] }
)

export type QuestionFormData = z.infer<typeof questionSchema>

// Bulk import schemas
const bulkImportChoiceSchema = z.object({
  letter: z.enum(['A', 'B', 'C', 'D']),
  text: z.string().trim().min(1, 'Choice text is required').max(500, 'Choice text too long'),
  is_correct: z.boolean(),
})

const bulkImportQuestionSchema = z.object({
  question_text: z
    .string()
    .trim()
    .min(1, 'Question text is required')
    .max(2000, 'Question text cannot exceed 2000 characters'),
  explanation_text: z.string().trim().max(2000, 'Explanation too long').optional(),
  difficulty_level: z
    .number()
    .int()
    .min(1)
    .max(5)
    .nullable()
    .optional(),
  answer_choices: z.array(bulkImportChoiceSchema).length(4, 'Must have exactly 4 choices'),
}).refine(
  (data) => {
    const correctCount = data.answer_choices.filter(c => c.is_correct).length
    return correctCount === 1
  },
  { message: 'Exactly one choice must be marked as correct' }
).refine(
  (data) => {
    return data.answer_choices.every(c => c.text.trim().length > 0)
  },
  { message: 'All choices must have text' }
).refine(
  (data) => {
    // All 4 letters must be present exactly once
    const letters = data.answer_choices.map(c => c.letter).sort()
    const expected = ['A', 'B', 'C', 'D']
    return JSON.stringify(letters) === JSON.stringify(expected)
  },
  { message: 'Must have choices A, B, C, and D exactly once each' }
)

export const bulkImportSchema = z.object({
  topic: z.string().trim().min(1, 'Topic name is required').max(100, 'Topic name too long'),
  questions: z.array(bulkImportQuestionSchema).min(1, 'Must have at least one question').max(500, 'Cannot import more than 500 questions at once'),
})

export type BulkImportData = z.infer<typeof bulkImportSchema>