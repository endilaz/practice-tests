# TODO

Updated 2026-07-07. Previous item (PracticeShell line 318 — randomized letter
in the incorrect-answer message) is fixed, along with finite-mode count,
completion screen, and the blocking shortage error. See README Section 12.

## Needs dashboard access
- [ ] Run `supabase/manual/fix_feedback_admin_rls.sql` (diagnostic first),
      then verify the admin feedback modal shows entries with author emails.
- [ ] `npx supabase login` → `link` → `db pull` to capture the schema into
      `supabase/migrations/` (instructions in `supabase/README.md`).
- [ ] Enable pg_cron and apply `supabase/manual/guest_cleanup.sql`.

## Environment
- [ ] Move the repo out of OneDrive (e.g. `C:\dev\practice_tests`).

## Code quality (opportunistic)
- [ ] Burn down the 24 ESLint warnings (react-hooks/set-state-in-effect,
      immutability, exhaustive-deps) when touching those files.
- [ ] Consider code-splitting the admin bundle (Vite warns >500 kB chunk).
