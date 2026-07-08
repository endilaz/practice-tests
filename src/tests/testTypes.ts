/*
 * testTypes.ts
 * Shared types, constants, and pure helpers for the test-taking UI
 * (TestShell, QuestionCard, useTestAttempt).
 */

export type Question = {
  id: string
  question_text: string
  position: number
  is_ai_generated: boolean
}

export type AnswerChoice = {
  id: string
  question_id: string
  choice_letter: string // original DB letter — used only for matching display order, never shown as-is
  choice_text: string
}

export type ResponseRow = {
  question_id: string
  selected_choice_id: string | null
  displayed_choices_order: string[]
  eliminated_choices: string[]
  marked_for_review: boolean
  tab_switch_count: number
}

export type ViewMode = 'one' | 'all' | 'review'

// Positional labels rendered to the user. Always A B C D top-to-bottom
// regardless of the DB's internal choice_letter values.
export const DISPLAY_LABELS = ['A', 'B', 'C', 'D']

// Navy theme color — defined once so it's easy to update
export const NAVY = '#1a2e5a'

// Given a question's responses row and the raw choices from the DB,
// return choices sorted into the server-determined display order.
export function orderChoices(
  row: ResponseRow | undefined,
  raw: AnswerChoice[]
): AnswerChoice[] {
  if (!row?.displayed_choices_order?.length) return raw
  return row.displayed_choices_order
    .map(letter => raw.find(c => c.choice_letter === letter))
    .filter((c): c is AnswerChoice => c !== undefined)
}
