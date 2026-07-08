/*
 * generate-questions — Supabase Edge Function (Deno).
 *
 * POST { topic_id: string, count: number }  →  { candidates: Candidate[] }
 *
 * Admin-only: the caller's JWT is verified and their role checked against the
 * users table (same role-from-DB convention as the app). The function only
 * READS reference questions and returns candidates — it never inserts;
 * insertion happens client-side when the admin approves each candidate.
 *
 * Deploy:  npx supabase functions deploy generate-questions
 * Secrets: npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
 *          npx supabase secrets set AI_MODEL=claude-haiku-4-5   (optional)
 */
import { createClient } from 'npm:@supabase/supabase-js@2'
import { generateCandidates, type Candidate, type ReferenceQuestion } from './provider.ts'

const MAX_COUNT = 10
const MAX_REFERENCES = 20

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// Structural re-check of what the model produced, independent of the
// provider's schema enforcement. The client validates again with Zod.
function isValidCandidate(c: Candidate): boolean {
  if (!c.question_text?.trim() || c.question_text.length > 2000) return false
  if (c.explanation_text && c.explanation_text.length > 2000) return false
  if (!Array.isArray(c.choices) || c.choices.length !== 4) return false
  const letters = c.choices.map(ch => ch.letter).sort().join('')
  if (letters !== 'ABCD') return false
  if (c.choices.filter(ch => ch.is_correct).length !== 1) return false
  return c.choices.every(ch => ch.text?.trim() && ch.text.length <= 500)
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return json(405, { error: 'Method not allowed' })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json(401, { error: 'Missing authorization header' })

    // Client scoped to the caller's JWT — all reads run under their RLS.
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )

    const { data: { user }, error: userErr } = await supabase.auth.getUser()
    if (userErr || !user) return json(401, { error: 'Invalid or expired session' })

    const { data: roleRow, error: roleErr } = await supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single()
    if (roleErr || roleRow?.role !== 'admin') {
      return json(403, { error: 'Admin access required' })
    }

    const body = await req.json().catch(() => null)
    const topicId = body?.topic_id
    const count = Math.min(Math.max(Number(body?.count) || 0, 1), MAX_COUNT)
    if (typeof topicId !== 'string' || !topicId) {
      return json(400, { error: 'topic_id is required' })
    }

    const { data: topic, error: topicErr } = await supabase
      .from('topics')
      .select('name')
      .eq('id', topicId)
      .single()
    if (topicErr || !topic) return json(404, { error: 'Topic not found' })

    const { data: references, error: refErr } = await supabase
      .from('questions')
      .select('question_text, difficulty_level, answer_choices(choice_letter, choice_text, is_correct)')
      .eq('topic_id', topicId)
      .order('created_at', { ascending: false })
      .limit(MAX_REFERENCES)
    if (refErr) return json(500, { error: 'Failed to load reference questions' })
    if (!references || references.length === 0) {
      return json(400, {
        error: 'This topic has no existing questions to use as reference. Add a few questions first.',
      })
    }

    const candidates = await generateCandidates({
      topicName: topic.name,
      referenceQuestions: references as unknown as ReferenceQuestion[],
      count,
    })

    const valid = candidates.filter(isValidCandidate)
    if (valid.length === 0) {
      return json(502, { error: 'The model returned no valid questions. Try again.' })
    }

    return json(200, { candidates: valid })
  } catch (err) {
    console.error('generate-questions error:', err)
    const message = err instanceof Error ? err.message : 'Unexpected error'
    return json(500, { error: message })
  }
})
