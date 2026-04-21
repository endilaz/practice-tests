// test.schema.ts
// Zod validation schema for the test configuration form.
// MAX_QUESTIONS is exported so TestConfig.tsx and any future consumers
// stay in sync with the schema limit from a single source of truth.

import { z } from 'zod'

export const MAX_QUESTIONS = 500

export const testConfigSchema = z.object({
  topicId: z.string().uuid(),
  questionCount: z.number().int().min(1).max(MAX_QUESTIONS),
  useTimer: z.boolean(),
  minutes: z.number().int().min(1).max(180).optional(),
})