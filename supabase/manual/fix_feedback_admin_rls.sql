-- fix_feedback_admin_rls.sql
--
-- Context: the admin "Question Feedback" modal came back empty even though
-- feedback rows existed. The frontend query embeds the author's email via
-- users(email). Two DB-side causes can produce an empty/incomplete result:
--
--   1. question_feedback has no "admins can read all rows" SELECT policy,
--      so an admin only sees their own feedback (or nothing).
--   2. users has no "admins can read all rows" SELECT policy. The frontend
--      now uses a LEFT join so this no longer hides feedback rows, but
--      without it every author shows as "Unknown".
--
-- STEP 1 — run this diagnostic first and check what already exists:

select schemaname, tablename, policyname, cmd, qual
from pg_policies
where tablename in ('question_feedback', 'users')
order by tablename, policyname;

-- STEP 2 — if there is no admin SELECT policy on a table, create it.
-- (Skip any statement whose equivalent already exists under another name.)

-- Helper predicate used below: "the current user is an admin".
-- If you already have an is_admin() function, use that instead.

create policy "Admins can read all feedback"
  on public.question_feedback
  for select
  to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.role = 'admin'
    )
  );

create policy "Admins can read all users"
  on public.users
  for select
  to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.role = 'admin'
    )
  );

-- NOTE on the "Admins can read all users" policy: a subquery on public.users
-- inside a users policy can recurse. If Postgres reports infinite recursion,
-- use a SECURITY DEFINER helper instead:
--
--   create or replace function public.is_admin() returns boolean
--   language sql security definer set search_path = public stable as
--   $$ select exists (select 1 from users where id = auth.uid() and role = 'admin') $$;
--
--   create policy "Admins can read all users" on public.users
--     for select to authenticated using (public.is_admin());
--
-- STEP 3 — verify in the app: Admin > Questions > feedback icon on a question
-- that has feedback. Entries should list with author emails.
