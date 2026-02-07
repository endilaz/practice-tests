# FBLA Practice Tests — Developer Context
## 0. AI Guidelines 
- **SEARCH FOR POTENTIAL BUGS AND SECURITY VULNERABILITIES** in all the code you write. I expect you to automatically find these flaws immediately after producing code, don't wait for a prompt to do this
1. **Quality over quantity**: Robust, maintainable code prioritized over feature volume
2. **No assumptions**: Always ask for clarification if anything is unclear
3. **Focus on maintainability**: Clear, documented, modular code structure
4. **Scalability**: Architecture supports growth without major refactoring
5. **Flexibility**: Use CSS variables and configurable constants for easy customization
- **Incremental development** - build and test each feature before moving to next
- **Ask for confirmation** before proceeding with major changes
- **Write clear, maintainable code** with comments where needed
- **Do not reproduce code files when modifying them**, simply give a diff of the relevant lines

---

## 1. What This Project Is

A React + Supabase web app where students practice for FBLA competitions by taking randomized multiple-choice tests. Admins manage topics and questions. Users configure and take tests, then see scored results. Each test is a unique randomly-generated instance — questions are drawn from a pool, ordered randomly, and answer choices are shuffled per question.

---


## 4. Database (Supabase — all migrations have been run)

### Tables

All IDs are `uuid` with `default gen_random_uuid()`. All tables have RLS enabled.

**`users`** — 1:1 with `auth.users`. Columns: `id`, `email`, `role` (text, `'user'|'admin'`), `created_at`. A `SECURITY DEFINER` trigger (`handle_new_user`) auto-creates a row on signup with `role = 'user'`. The trigger has `set search_path = public`.

**`topics`** — Columns: `id`, `name` (text, unique), `created_at`. Publicly readable. Admin-write only.

**`questions`** — Columns: `id`, `topic_id` (FK → topics), `question_text`, `question_image_url`, `explanation_text`, `explanation_image_url`, `difficulty_level` (1–5), `created_by_admin_id` (FK → users), `is_flagged`, `created_at`. Publicly readable. Admin-write only.

**`answer_choices`** — Columns: `id`, `question_id` (FK → questions, cascade delete), `choice_letter` (A/B/C/D), `choice_text`, `choice_image_url`, `is_correct`. Unique on `(question_id, choice_letter)`. Publicly readable. Admin-write only.

**`test_attempts`** — Columns: `id`, `user_id` (FK → users), `topic_id` (FK → topics), `question_count`, `use_timer` (boolean), `minutes` (nullable), `started_at`, `completed_at`, `score`, `total_possible`, `total_time_seconds`, `out_of_browser_seconds`, `created_at`. Users read/update own rows. Admins read all.

**`attempt_questions`** — Columns: `id`, `attempt_id` (FK → test_attempts, cascade), `question_id` (FK → questions), `position` (int, unique per attempt). Users read/insert own (via attempt ownership). Admins read all.

**`question_responses`** — Columns: `id`, `attempt_id`, `question_id`, `selected_choice_id` (nullable FK → answer_choices), `is_correct` (nullable), `time_spent_seconds`, `marked_for_review`, `eliminated_choices` (jsonb, default `[]`), `displayed_choices_order` (jsonb, default `[]`), `tab_switch_count`, `answered_at`. Unique on `(attempt_id, question_id)`. Users read/update own. Admins read all.

**`question_feedback`** — Columns: `id`, `user_id`, `question_id`, `attempt_id` (nullable), `difficulty_rating` (1–5), `quality_rating` (1–5), `feedback_text`, `created_at`. Users read/insert own. Admins read all.

### Key RLS Rules

- Users cannot change their own `role` (WITH CHECK enforces `role` stays at current value).
- Admins cannot demote themselves (WITH CHECK requires `role = 'admin'` on own row).
- `generate_test()` runs as `SECURITY DEFINER` with `set search_path = public`.

### Functions

**`generate_test(p_topic_id uuid, p_question_count int, p_use_timer boolean, p_minutes int) → uuid`**
- Auth guard (`auth.uid() is null` → exception).
- Validates question count (1–100), timer (1–180 min if enabled), topic existence, and that enough questions exist.
- Creates `test_attempts` row.
- Selects N random questions, inserts into `attempt_questions` with stable position ordering.
- Initializes `question_responses` rows with `displayed_choices_order` as randomized jsonb array (e.g. `["C","A","D","B"]`) and empty `eliminated_choices`.
- Returns the new `attempt_id` (uuid).
- **Does not expose correct answers to the client.**

**`submit_test()`** — Defined in the spec but **not confirmed as implemented**. Will be needed at the end of the test-taking flow. Scores the attempt and sets `completed_at`, `score`, `total_possible`, `total_time_seconds`.

### Storage

- Bucket `question-images` exists, is public, 5 MB file limit.
- Authenticated users can upload. Only admins can delete.

---

## 5. What Is Fully Implemented and Tested

| # | Feature | Status |
|---|---|---|
| 1 | Auth, core tables, RLS | ✅ Complete |
| 2 | Frontend scaffold + auth flow | ✅ Complete (but main.tsx/App.tsx/providers.tsx are empty — see Section 7) |
| 3A | Admin Topics CRUD UI | ✅ Complete |
| 3B | User Test Config form | ✅ Complete |
| 4 | `generate_test()` backend function | ✅ Complete |

---

---

## 9. Development Rules

- **SEARCH FOR POTENTIAL BUGS AND SECURITY VULNERABILITIES** in all the code you write. I expect you to automatically find these flaws immediately after producing code, don't wait for a prompt to do this
1. **Quality over quantity**: Robust, maintainable code prioritized over feature volume
2. **No assumptions**: Always ask for clarification if anything is unclear
3. **Focus on maintainability**: Clear, documented, modular code structure
4. **Scalability**: Architecture supports growth without major refactoring
5. **Flexibility**: Use CSS variables and configurable constants for easy customization
- **Incremental development** - build and test each feature before moving to next
- **Ask for confirmation** before proceeding with major changes
- **Write clear, maintainable code** with comments where needed
1. **Never trust the frontend for security.** RLS is authoritative. The frontend must never assume a role or skip a check that the database doesn't also enforce.
2. **Role comes from the database, never from the JWT.** `AuthProvider` fetches role via a query to `public.users`. This is already implemented — do not change this pattern.
3. **`generate_test()` does not expose correct answers.** The client never receives `is_correct` or `selected_choice_id` mappings until the test is submitted and scored server-side.
4. **Empty files are not bugs — they are placeholders.** Several files exist with no content. This is intentional scaffolding. Do not delete them; fill them in when their feature is needed.
5. **Mutations use a `mutating`/`submitting` flag.** This pattern is established in `TopicsAdmin` and `TestConfig`. All future mutation-triggering buttons should follow it to prevent duplicate submissions.
6. **Errors clear on input change.** Established pattern: `setError(null)` in every `onChange`. Follow it.
7. **Supabase calls are direct** (no abstraction layer yet). Components call `supabase.from(...)` or `supabase.rpc(...)` directly. React Query is installed for future use but not yet in any component. Don't introduce it until there's a concrete reason.
8. **`@/` imports only.** All cross-directory imports use the `@/` alias. Never use relative paths that escape the current directory (e.g. `../../lib/supabase` → `@/lib/supabase`).
9. **Tailwind only for styling.** No inline styles, no CSS modules, no styled-components. Utility classes only.
10. **Don't write what isn't needed yet.** If a feature isn't the current task, don't stub it or anticipate its shape. The empty placeholder files already do that job.


## 10. Implementation Phases

### Week 1: Foundation (20-25 hours)
- Project setup, Supabase configuration
- Database migrations
- Authentication (login, register)
- Basic routing and layouts

### Week 2: Admin Topics & Questions (25-30 hours)
- Topic CRUD
- Question form with image upload
- Questions list with pagination
- JSON bulk import

### Week 3: Test Generation & Taking (30-35 hours)
- Test configuration page
- generate_test function
- Test-taking interface
- Timer, elimination, marking
- Auto-save, tab tracking

### Week 4: Results & User Features (25-30 hours)
- Results page with score
- Question review
- Feedback collection
- User dashboard
- Test history

### Week 5: Admin Analytics & Polish (25-30 hours)
- Question analytics
- User performance analytics
- Feedback review
- UI polish, responsive design
- Accessibility

### Week 6: Testing & Deployment (15-20 hours)
- Manual testing (all flows)
- Cross-browser testing
- Bug fixes
- Production deployment
- Documentation

---

## 11. Testing Requirements

### 11.1 Testing Checklist

**Authentication:**
- [ ] Register with valid/invalid credentials
- [ ] Login with correct/incorrect password
- [ ] Session persistence
- [ ] Logout
- [ ] Protected routes work

**Topics:**
- [ ] Admin can CRUD topics
- [ ] Cannot create duplicate names
- [ ] Cannot delete topic with questions

**Questions:**
- [ ] Create with all fields
- [ ] Upload images
- [ ] Validate 4 choices, 1 correct
- [ ] Bulk import from JSON

**Test Taking:**
- [ ] Generate test
- [ ] Timer starts/counts correctly
- [ ] Select answers
- [ ] Eliminate choices
- [ ] Mark for review
- [ ] Navigate between questions
- [ ] Auto-save works
- [ ] Submit shows confirmation

**Results:**
- [ ] Score calculated correctly
- [ ] Explanations shown
- [ ] Can rate questions

**Analytics:**
- [ ] Question stats accurate
- [ ] User performance correct
- [ ] Charts render

### 11.2 Browser/Device Testing

- Chrome, Firefox, Safari, Edge (latest)
- iOS Safari, Android Chrome
- Desktop, tablet, phone sizes

---

---

## 13. Future Enhancements

### 13.1 PDF Parsing
- Use pdf-parse or GPT-4 Vision
- Extract questions automatically
- Admin review before import

### 13.2 CLI Tool
- Node.js CLI for bulk operations
- Integrate with PDF parser
- Automated pipeline

### 13.3 AI Features
- Auto-generate explanations (OpenAI API)
- Difficulty prediction
- Question similarity detection

### 13.4 Enhanced Analytics
- Learning curve analysis
- Predictive modeling
- Question quality scoring

### 13.5 Study Features
- Flashcard mode
- Spaced repetition
- Practice mode (untimed)

---