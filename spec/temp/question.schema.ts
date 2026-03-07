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