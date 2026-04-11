import { z } from 'zod'

export const testConfigSchema = z.object({
  topicId: z.string().uuid(),
  questionCount: z.number().int().min(1).max(100),
  useTimer: z.boolean(),
  minutes: z.number().int().min(1).max(180).optional()
})
