/*
 * insertQuestion.ts
 * Single insert path for a validated question + its 4 answer choices, shared
 * by the manual create form (QuestionsAdmin) and the AI generate modal.
 * Extracted verbatim from QuestionsAdmin.createQuestion, plus the
 * is_ai_generated flag.
 */
import { supabase } from '@/lib/supabase'
import type { QuestionFormData } from './question.schema'

export async function insertQuestion(
  data: QuestionFormData,
  adminId: string,
  opts?: { isAiGenerated?: boolean },
): Promise<void> {
  const { data: question, error: qError } = await supabase
    .from('questions')
    .insert({
      topic_id: data.topic_id,
      question_text: data.question_text.trim(),
      explanation_text: data.explanation_text?.trim() || null,
      difficulty_level: data.difficulty_level,
      created_by_admin_id: adminId,
      is_ai_generated: opts?.isAiGenerated ?? false,
    })
    .select()
    .single()

  if (qError) throw qError

  const choicesData = data.choices.map(c => ({
    question_id: question.id,
    choice_letter: c.letter,
    choice_text: c.text.trim(),
    is_correct: c.is_correct,
  }))

  const { error: cError } = await supabase.from('answer_choices').insert(choicesData)

  if (cError) {
    // Rollback: delete the question we just created
    await supabase.from('questions').delete().eq('id', question.id)
    throw new Error('Failed to create answer choices. Please try again.')
  }
}
