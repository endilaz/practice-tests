-- Mark AI-generated questions so they can be badged in the UI.
-- Run in the Supabase dashboard SQL editor (or fold into a migration once
-- supabase/migrations/ exists — see supabase/README.md).
--
-- Existing rows default to false. No RLS or RPC changes are needed:
--   * questions is already publicly readable, so the flag is visible to the
--     test/practice/results screens automatically.
--   * generate_test() draws question ids only, so AI questions enter the
--     random pool like any other question.
--   * Inserts still go through the admin-write policy; the Edge Function
--     never writes to the database.

alter table public.questions
  add column if not exists is_ai_generated boolean not null default false;
