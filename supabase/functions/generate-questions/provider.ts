/*
 * provider.ts — the LLM provider seam.
 *
 * Everything model/provider-specific lives in this file. To swap providers
 * (or models), reimplement generateCandidates() with the same signature —
 * nothing in index.ts or the client changes.
 *
 * Config (Supabase secrets / env):
 *   ANTHROPIC_API_KEY  — required
 *   AI_MODEL           — optional, defaults to claude-haiku-4-5 (cheapest
 *                        Claude: $1/$5 per MTok; a 10-question batch costs
 *                        well under a cent)
 */
import Anthropic from 'npm:@anthropic-ai/sdk'

export type CandidateChoice = {
  letter: 'A' | 'B' | 'C' | 'D'
  text: string
  is_correct: boolean
}

export type Candidate = {
  question_text: string
  explanation_text: string
  choices: CandidateChoice[]
}

export type ReferenceQuestion = {
  question_text: string
  difficulty_level: number | null
  answer_choices: { choice_letter: string; choice_text: string; is_correct: boolean }[]
}

const DEFAULT_MODEL = 'claude-haiku-4-5'

// JSON schema for structured outputs — guarantees parseable candidates.
// (Structured outputs forbid min/max length constraints; index.ts and the
// client re-validate text limits with Zod.)
const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          question_text: { type: 'string' },
          explanation_text: {
            type: 'string',
            description: 'One or two sentences explaining why the correct answer is correct.',
          },
          choices: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                letter: { type: 'string', enum: ['A', 'B', 'C', 'D'] },
                text: { type: 'string' },
                is_correct: { type: 'boolean' },
              },
              required: ['letter', 'text', 'is_correct'],
              additionalProperties: false,
            },
          },
        },
        required: ['question_text', 'explanation_text', 'choices'],
        additionalProperties: false,
      },
    },
  },
  required: ['questions'],
  additionalProperties: false,
} as const

function buildPrompt(topicName: string, references: ReferenceQuestion[], count: number): string {
  const examples = references
    .map((q, i) => {
      const choices = q.answer_choices
        .slice()
        .sort((a, b) => a.choice_letter.localeCompare(b.choice_letter))
        .map(c => `${c.choice_letter}) ${c.choice_text}${c.is_correct ? ' [correct]' : ''}`)
        .join('\n')
      return `Example ${i + 1}:\n${q.question_text}\n${choices}`
    })
    .join('\n\n')

  return [
    `Topic: ${topicName}`,
    '',
    'Here are existing questions from this topic to use as a reference for subject matter, difficulty, and style:',
    '',
    examples,
    '',
    `Write ${count} NEW multiple-choice questions for this topic.`,
    'Requirements:',
    '- Each question must cover material from this topic but must NOT duplicate or paraphrase any reference question.',
    '- Exactly 4 choices labeled A, B, C, D, with exactly one marked is_correct.',
    '- Wrong choices should be plausible distractors, not obviously wrong.',
    '- Match the difficulty and tone of the reference questions.',
    '- Keep question text under 2000 characters and each choice under 500 characters.',
    '- Include a brief explanation_text for why the correct answer is correct.',
  ].join('\n')
}

export async function generateCandidates(args: {
  topicName: string
  referenceQuestions: ReferenceQuestion[]
  count: number
}): Promise<Candidate[]> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured')

  const client = new Anthropic({ apiKey })
  const model = Deno.env.get('AI_MODEL') || DEFAULT_MODEL

  const response = await client.messages.create({
    model,
    max_tokens: 8000,
    system:
      'You write high-quality FBLA practice-test multiple-choice questions. ' +
      'You always produce factually accurate questions with exactly one correct answer.',
    messages: [
      {
        role: 'user',
        content: buildPrompt(args.topicName, args.referenceQuestions, args.count),
      },
    ],
    output_config: { format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
  })

  if (response.stop_reason === 'refusal') {
    throw new Error('The model declined to generate questions for this topic.')
  }
  if (response.stop_reason === 'max_tokens') {
    throw new Error('Generation was cut off — try a smaller count.')
  }

  const textBlock = response.content.find(b => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('The model returned no usable output.')
  }

  const parsed = JSON.parse(textBlock.text) as { questions: Candidate[] }
  return parsed.questions
}
