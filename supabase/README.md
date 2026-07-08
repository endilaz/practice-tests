# Supabase — schema source control

The database (tables, RLS policies, `generate_test()` / `submit_test()`
functions, triggers) currently lives **only** in the Supabase dashboard.
This directory is where it should be captured so the schema is versioned,
reviewable, and reproducible.

## One-time setup: pull the current schema

```bash
# 1. Install the CLI (or: scoop install supabase / npm i -D supabase)
npm install -D supabase

# 2. Log in (opens browser; needs your Supabase account)
npx supabase login

# 3. Link this repo to the project (find the ref in the dashboard URL:
#    https://supabase.com/dashboard/project/<project-ref>)
npx supabase link --project-ref <project-ref>

# 4. Snapshot the remote schema into supabase/migrations/
npx supabase db pull
```

Commit everything `db pull` generates. From then on, make schema changes as
new files in `supabase/migrations/` and apply them with
`npx supabase db push` (or paste into the SQL editor), instead of editing
live in the dashboard.

## `manual/` — pending one-off scripts

SQL written before migrations were set up. Each file explains what it does
and why. **Review in the dashboard SQL editor before running**, then either
delete the file or fold it into a proper migration once applied:

- `fix_feedback_admin_rls.sql` — diagnostic + fix for the admin feedback
  modal showing no results (RLS on `question_feedback` / `users`).
- `guest_cleanup.sql` — scheduled purge of old anonymous (guest) accounts
  and their test data.
- `add_ai_generated.sql` — adds `questions.is_ai_generated` so AI-generated
  questions can be badged in the UI. Required before using the AI generator.

## `functions/` — Edge Functions

### `generate-questions`

Admin-only endpoint that generates candidate multiple-choice questions for a
topic with an LLM, using the topic's existing questions as few-shot
reference. It only returns candidates — the admin reviews/edits/approves them
in the app, and approved questions are inserted client-side with
`is_ai_generated = true`.

Setup (one time):

```bash
# API key for the LLM provider (default provider: Anthropic)
npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...

# Optional: override the model (defaults to claude-haiku-4-5, the cheapest)
npx supabase secrets set AI_MODEL=claude-haiku-4-5

# Deploy
npx supabase functions deploy generate-questions
```

To swap providers or models later, edit only
`functions/generate-questions/provider.ts` — it exposes a single
`generateCandidates()` function that the rest of the code depends on.
