---

## 1. What This Project Is

A React + Supabase web app where students practice for FBLA competitions by taking randomized multiple-choice tests. Admins manage topics and questions. Users configure and take tests, then see scored results. Each test is a unique randomly-generated instance — questions are drawn from a pool, ordered randomly, and answer choices are shuffled per question.

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite 7 |
| Styling | Tailwind CSS v4 (via `@tailwindcss/vite` plugin) |
| Routing | React Router v7 (`createBrowserRouter`) |
| Server state | TanStack React Query v5 (installed, not yet used in any component) |
| Validation | Zod v4 |
| Backend | Supabase (Auth, PostgreSQL + RLS, Storage) |
| Path alias | `@/` → `src/` (configured in both `vite.config.ts` and `tsconfig.app.json`) |
| PDF parsing | pdf.js 3.11 (loaded from CDN at runtime — not bundled) |
| DOCX parsing | jszip (dynamic import) + browser DOMParser |

---

## 3. Project File Tree

```
practice_tests\
├── .env.local                          ← Supabase URL + anon key (do not commit)
├── .gitignore
├── index.html                          ← Vite entry point, mounts src/main.tsx
├── package.json                        ← type: module, scripts: dev/build/preview
├── package-lock.json
├── vite.config.ts                      ← React plugin, Tailwind plugin, @/ alias
├── tsconfig.json
├── tsconfig.app.json                   ← covers src/, has @/ path alias
├── tsconfig.node.json                  ← covers vite.config.ts only
└── src\
    ├── index.css                       ← Tailwind entry (@import "tailwindcss")
    ├── main.tsx                        ← React mount into #root, imports CSS, wraps providers
    ├── app\
    │   ├── App.tsx                     ← Renders <RouterProvider router={router} />
    │   ├── providers.tsx               ← Wraps with AuthProvider + QueryClientProvider
    │   └── router.tsx                  ← All routes (see Section 4)
    ├── auth\
    │   ├── AuthProvider.tsx            ← Session bootstrap + role fetch from DB
    │   ├── ProtectedRoute.tsx          ← Route guard (user + optional requireAdmin)
    │   └── useAuth.ts                  ← Re-exports useAuth from AuthProvider
    ├── lib\
    │   ├── env.ts                      ← Runtime guard for required env vars
    │   └── supabase.ts                 ← Single Supabase client instance
    ├── pages\
    │   ├── Login.tsx                   ← Login form with error handling
    │   ├── Register.tsx                ← Registration form with error handling
    │   ├── Dashboard.tsx               ← User landing: TestConfigForm + test history table
    │   ├── Admin.tsx                   ← Admin panel: tabbed Topics / Questions / Analytics
    │   └── Results.tsx                 ← Post-test results: score summary + question review
    ├── analytics\
    │   ├── QuestionAnalytics.tsx       ← Paginated question stats table + detail modal
    │   └── UserAnalytics.tsx           ← User stats table + detail modal
    ├── questions\
    │   ├── question.schema.ts          ← Zod schema for question create/edit form
    │   ├── QuestionsAdmin.tsx          ← Admin CRUD for questions (with image upload)
    │   ├── useQuestions.ts             ← Hook for question data fetching
    │   └── DocxImportStudyguides.tsx   ← FBLA study guide bulk importer (DOCX + PDF)
    ├── tests\
    │   ├── test.schema.ts              ← Zod schema for test config form
    │   ├── TestConfig.tsx              ← Test setup form (topic, count, timer)
    │   ├── TestShell.tsx               ← Full test-taking interface (see Section 7)
    │   ├── PracticeShell.tsx           ← Practice mode variant (/practice route)
    │   └── useGenerateTest.ts          ← Hook wrapping the generate_test() RPC
    ├── topics\
    │   ├── topic.schema.ts             ← Zod schema for topic form
    │   ├── TopicsAdmin.tsx             ← Admin CRUD for topics
    │   └── useTopics.ts                ← Hook for topic data fetching
    └── ui\                             ← Shared UI primitives
```

---

## 4. Routes

Defined in `src/app/router.tsx`:

| Path | Component | Guard |
|---|---|---|
| `/login` | `Login` | Public |
| `/register` | `Register` | Public |
| `/` | `Dashboard` | Auth required |
| `/test/:id` | `TestShell` | Auth required |
| `/practice` | `PracticeShell` | Auth required |
| `/results/:id` | `Results` | Auth required |
| `/admin` | `Admin` | Auth + admin role required |

The `:id` in `/test/:id` and `/results/:id` is the `attempt_id` UUID returned by `generate_test()`. `TestConfig` calls `useGenerateTest`, then navigates to `/test/:id`.

---

## 5. Database

### Tables

All IDs are `uuid` with `default gen_random_uuid()`. All tables have RLS enabled.

**`users`** — 1:1 with `auth.users`. Columns: `id`, `email`, `role` (text, `'user'|'admin'`), `created_at`. A `SECURITY DEFINER` trigger (`handle_new_user`) auto-creates a row on signup with `role = 'user'`. Trigger has `set search_path = public`.

**`topics`** — Columns: `id`, `name` (text, unique), `created_at`. Publicly readable. Admin-write only.

**`questions`** — Columns: `id`, `topic_id` (FK → topics), `question_text`, `question_image_url`, `explanation_text`, `explanation_image_url`, `difficulty_level` (1–5), `created_by_admin_id` (FK → users), `is_flagged`, `created_at`. Publicly readable. Admin-write only.

**`answer_choices`** — Columns: `id`, `question_id` (FK → questions, cascade delete), `choice_letter` (A/B/C/D), `choice_text`, `choice_image_url`, `is_correct`. Unique on `(question_id, choice_letter)`. Publicly readable. Admin-write only.

**`test_attempts`** — Columns: `id`, `user_id` (FK → users), `topic_id` (FK → topics), `question_count`, `use_timer` (boolean), `minutes` (nullable), `started_at`, `completed_at`, `score`, `total_possible`, `total_time_seconds`, `out_of_browser_seconds`, `created_at`. Users read/update own rows. Admins read all.

**`attempt_questions`** — Columns: `id`, `attempt_id` (FK → test_attempts, cascade), `question_id` (FK → questions), `position` (int, unique per attempt). Users read/insert own. Admins read all.

**`question_responses`** — Columns: `id`, `attempt_id`, `question_id`, `selected_choice_id` (nullable FK → answer_choices), `is_correct` (nullable), `time_spent_seconds`, `marked_for_review`, `eliminated_choices` (jsonb, default `[]`), `displayed_choices_order` (jsonb, default `[]`), `tab_switch_count`, `answered_at`. Unique on `(attempt_id, question_id)`. Users read/update own. Admins read all.

**`question_feedback`** — Columns: `id`, `user_id`, `question_id`, `attempt_id` (nullable), `difficulty_rating` (1–5), `quality_rating` (1–5), `feedback_text`, `created_at`. Users read/insert own. Admins read all.

### Key RLS Rules

- Users cannot change their own `role`.
- Admins cannot demote themselves.
- `generate_test()` and `submit_test()` run as `SECURITY DEFINER` with `set search_path = public`.

### Database Functions

**`generate_test(p_topic_id uuid, p_question_count int, p_use_timer boolean, p_minutes int) → uuid`**
- Auth-guarded. Validates count (1–100), timer (1–180 min), topic existence, sufficient pool size.
- Creates `test_attempts` row, selects N random questions into `attempt_questions` with stable positions, initializes `question_responses` rows with randomized `displayed_choices_order`.
- Returns `attempt_id`. **Never exposes correct answers.**

**`submit_test(p_attempt_id uuid) → {score, total}`**
- Scores the attempt server-side by reading `question_responses.is_correct`.
- Sets `completed_at`, `score`, `total_possible`, `total_time_seconds` on `test_attempts`.
- Returns `{score, total}` — used by `TestShell` for the immediate post-submit screen.

**`get_question_analytics(p_search, p_topic, p_sort, p_limit, p_offset) → QuestionStat[]`**
- Powers `QuestionAnalytics`. Returns paginated, filtered, sorted stats.
- Fields: `question_id`, `question_text`, `topic_name`, `times_attempted`, `times_correct`, `correctness_pct`, `avg_time_spent`, `times_marked`, `avg_difficulty`, `avg_quality`.

**`get_question_analytics_count(p_search, p_topic) → bigint`**
- Companion to above — returns total matching row count for pagination.

### Storage

Bucket `question-images`: public, 5 MB limit. Authenticated users can upload. Only admins can delete.

---

## 6. Feature Status

| # | Feature | Status |
|---|---|---|
| 1 | Auth, core tables, RLS | ✅ Complete |
| 2 | Frontend scaffold, routing, auth flow | ✅ Complete |
| 3A | Admin — Topics CRUD | ✅ Complete |
| 3B | Admin — Questions CRUD + image upload | ✅ Complete |
| 3C | Admin — FBLA study guide bulk importer | ✅ Complete |
| 4 | `generate_test()` + `useGenerateTest` hook | ✅ Complete |
| 5 | Test-taking interface (`TestShell`) | ✅ Complete |
| 6 | Results page | ✅ Complete |
| 7 | Dashboard with test history | ✅ Complete |
| 8 | Question analytics | ✅ Complete |
| 9 | User analytics | ✅ Complete |

---

## 7. Key Components — Behavioral Notes

### `TestShell` (`src/tests/TestShell.tsx`)

Full test-taking UI. Receives `attempt_id` from the URL param (`/test/:id`).

**Data loading:** Loads `test_attempts` (timer config + `started_at`), `attempt_questions` (ordered by `position`), `answer_choices` (bulk fetch for all question IDs in one query), and `question_responses` in sequence. Sets `started_at` on first load if not already set (safe on refresh).

**View modes:** `'one'` (default — one question at a time with prev/next), `'all'` (scrollable list, palette buttons scroll to question), `'review'` (only marked questions; snaps to first marked on mode switch; shows message if none marked).

**Answer selection:** Optimistic UI update → DB write → rollback on error. Eliminated choices cannot be selected. Eliminating a selected choice deselects it first and immediately writes `selected_choice_id: null` to DB.

**Persistence strategy:**
- `selectAnswer` / `clearAnswer` write to DB immediately on each interaction (fast path).
- `doSave()` bulk-flushes all response rows — called by 30-second autosave interval and as a final flush before submit.
- `responsesRef` and `currentIndexRef` mirror state into refs so interval callbacks and event listeners always read current values without stale closures.

**Submit flow:** User confirms → stop autosave interval and timer → `doSave()` → write total tab-switch count to `test_attempts.out_of_browser_seconds` → call `submit_test()` RPC → show score screen → user navigates to `/results/:id`.

**Tab tracking:** `visibilitychange` event increments `tab_switch_count` on the currently active question. Stored per-response; total written to attempt on submit.

**Timer:** Countdown from `minutes * 60`. White → yellow under 5 min → red under 1 min. Auto-submits at 0.

**Report issue modal:** Collects optional difficulty rating (1–5), quality rating (1–5), and free text. Inserts into `question_feedback`. Requires at least one field filled.

**Palette:** Always-visible footer. Yellow = marked for review (priority over green), green = answered, gray = unanswered. Navy border = current question (single/review modes only). In review mode, unmarked buttons are dimmed and non-navigable.

**Theme:** Navy `#1a2e5a` defined as `const NAVY` at the top of the file. Applied via inline `style` props where Tailwind cannot express dynamic values.

### `Results` (`src/pages/Results.tsx`)

Loads attempt metadata (with ownership check — `user_id === user.id` as a frontend guard on top of RLS), `attempt_questions` for position ordering, `question_responses`, questions, and choices. Redirects to `/test/:id` if `completed_at` is null. Displays choices in `displayed_choices_order` (the shuffled order the user saw). Correct answer = green border; user's wrong answer = red border; unanswered = gray badge.

### `Dashboard` (`src/pages/Dashboard.tsx`)

Two sections: `TestConfigForm` (starts a new test via `useGenerateTest` → navigates to `/test/:id`) and a paginated test history table (completed attempts only, configurable limit 5/10/20/50/100). Admin users see a link to `/admin` in the header.

### `Admin` (`src/pages/Admin.tsx`)

Three tabs: **Topics** (`TopicsAdmin`), **Questions** (`QuestionsAdmin`), **Analytics** (sub-tabbed: **Question Analytics** / **User Analytics**).

### `QuestionAnalytics` (`src/analytics/QuestionAnalytics.tsx`)

Calls `get_question_analytics` and `get_question_analytics_count` RPCs in parallel. Features: text search (300ms debounced), topic filter dropdown, sort by attempts/correctness/time/marked (asc/desc), pagination (50 per page). Detail modal shows answer distribution (bar chart per choice, proportional to `times_attempted`) and user feedback entries with ratings.

### `UserAnalytics` (`src/analytics/UserAnalytics.tsx`)

Fetches all users then per-user completed attempt stats (N+1 query pattern — acceptable for small admin user counts). Only users with at least one completed test are shown. Detail modal shows performance by topic (progress bars color-coded green/yellow/red by score) and last 20 completed tests.

### `DocxImportStudyguides` (`src/questions/DocxImportStudyguides.tsx`)

See Section 8.

### `useGenerateTest` (`src/tests/useGenerateTest.ts`)

Thin hook: `{ generateTest, loading, error }`. Calls `supabase.rpc('generate_test', {...})`. Returns `attempt_id` UUID on success, `null` on error.

---

## 8. FBLA Study Guide Importer

### Supported formats
- **DOCX:** 2017–20 format (questions `1)`, choices `A)`); 2010–13 format (questions `1.`, choices `a.` with optional space after dot). Answer keys in 3-column Word tables.
- **PDF:** Same guides in PDF form including the 400-page combined document. Text extracted via pdf.js from CDN. Answer keys are plain text paragraphs.

### Answer key parsing — robustness techniques
- **OCR spaces anywhere in topic name or suffix** (`"Intr oduction to Parliamentary Pr ocedure Answe r Key"`): `matchAnswerKeyHeader()` collapses all whitespace to match, then walks backwards through the original line to recover the topic name with original spacing.
- **Missing or misread parentheses** (`10 B`, `20Y D`): entry regex uses `[)Ylj]?` as separator.
- **Packed entries with no separator** (`5) C15) A26) A`): lookahead `(?=[\s,\d]|$)` treats a digit as a valid boundary after an answer letter.
- **Orphaned question numbers — forward** (`6)\nB 16) C`): merged with the start of the next line.
- **Orphaned question numbers — backward** (`C 20) D 30) D\n10)`): `10)` inserted in sorted position on the previous line; answer letter `C` recovered from context (the character preceding the next-higher entry).
- **Topic name matching**: answer keys stored under both normal-normalised and fully space-collapsed (fuzzy) forms on both the key side and the lookup side.

### In-memory question editor
After parsing, each topic card has an expandable editor. Edits are in-memory only (lost on reset). `liveQuestions(normName)` is used everywhere — stats, `canImport`, `handleImport`, import button count — so edits immediately affect import eligibility. Per question: edit question text (textarea), edit any choice text (input), set correct answer (letter badge click or dropdown), add missing choices (all 4 slots always rendered — missing ones show dashed red input that creates the choice on first keystroke), delete question.

### Import logic
Finds or creates topic by name → inserts each valid question → inserts its answer choices. On choice insert failure, rolls back the orphaned question row. Topics with unanswered questions are blocked from import unless the user explicitly overrides to skip those questions.

---

## 9. Key Patterns and Conventions

**Mutation guard:** Every async-write button uses a `mutating` or `submitting` boolean. Set `true` before the call, `false` in the finally path. Prevents duplicate submissions. Established in `TopicsAdmin`, `TestConfig`, `TestShell`.

**Error clearing on input:** `setError(null)` in every `onChange` handler.

**Role from DB, never JWT:** `AuthProvider` fetches role via `supabase.from('users').select('role')`. Never read from JWT or `user_metadata`. Do not change this pattern.

**Optimistic updates with rollback:** Established in `TestShell.selectAnswer` and `clearAnswer`. Apply to any future mutation where per-click latency would be noticeable.

**Refs for stale-closure-sensitive callbacks:** `responsesRef` / `currentIndexRef` in `TestShell`. Use this pattern whenever a `setInterval` or event listener callback needs to read current state without being torn down on every render.

**Direct Supabase calls:** Components call `supabase.from(...)` or `supabase.rpc(...)` directly. React Query installed but not in use. Do not introduce it without a concrete reason.

**`@/` imports only:** Never use relative paths that escape the current directory.

**Tailwind only for styling:** No inline styles except where Tailwind cannot express dynamic values (e.g. the `NAVY` constant in `TestShell`).

**RLS is authoritative:** Frontend never assumes a role or skips a check the database doesn't also enforce. Security-sensitive checks (e.g. ownership in `Results`) are a courtesy double-check, not a substitute for RLS.

**`generate_test()` never exposes answers:** The client never receives `is_correct` values until after `submit_test()` completes.

---

## 10. Testing Checklist

**Authentication:**
- [ ] Register / login with valid and invalid credentials
- [ ] Session persists across browser refresh
- [ ] Logout works
- [ ] Protected routes redirect unauthenticated users to `/login`
- [ ] `/admin` redirects non-admin users to `/`

**Topics / Questions:**
- [ ] Admin can create, rename, delete topics; duplicate name rejected by DB
- [ ] Admin can create/edit/delete questions with image upload
- [ ] Deleting topic with questions fails (DB constraint)

**Study Guide Importer:**
- [ ] DOCX import — 2017–20 and 2010–13 formats
- [ ] PDF import — single topic and full combined document
- [ ] OCR-spaced topic names match answer keys
- [ ] Packed answer key lines parsed correctly
- [ ] Editor: fix answers, edit choices, add missing choices, delete questions
- [ ] Import blocked for unanswered questions without override

**Test Flow:**
- [ ] `TestConfig` generates test and navigates to `/test/:id`
- [ ] Questions in correct position order; choices in `displayed_choices_order`
- [ ] Select, clear, eliminate answers; elimination deselects if needed
- [ ] Mark for review; review-only mode filters correctly
- [ ] All three view modes work correctly; mode switch preserves position
- [ ] Timer counts down; yellow at 5 min, red at 1 min, auto-submits at 0
- [ ] Autosave fires every 30 seconds
- [ ] Tab switches increment `tab_switch_count` on the correct question
- [ ] Submit: confirmation → RPC → score screen → navigate to `/results/:id`
- [ ] Report issue modal submits to `question_feedback`

**Results:**
- [ ] Choices displayed in original `displayed_choices_order`
- [ ] Correct answer = green; user's wrong answer = red; unanswered = gray
- [ ] Explanation shown when present
- [ ] Accessing another user's results returns an error

**Dashboard:**
- [ ] Only completed attempts shown
- [ ] History limit selector (5/10/20/50/100) works
- [ ] "View Results" links to correct attempt

**Analytics:**
- [ ] Question search, topic filter, sort, and pagination all work
- [ ] Detail modal: answer distribution bars and feedback
- [ ] User list shows only users with completed tests
- [ ] User detail: performance by topic and test history

### Browser / Device Testing
Chrome, Firefox, Safari, Edge (latest) · iOS Safari, Android Chrome · Desktop, tablet, phone

---

## 11. Future Enhancements

### 11.1 AI Features
- Auto-generate explanations via OpenAI API
- Difficulty prediction from attempt data
- Duplicate/near-duplicate question detection

### 11.2 Enhanced Analytics
- Per-question time-spent distributions
- Performance-over-time charts per user/topic
- Spaced repetition scheduling

### 11.3 Study Features
- Practice mode with immediate per-question feedback (`/practice` route + `PracticeShell` already exist)
- Flashcard mode

### 11.4 Admin Tooling
- JSON bulk import (alternative to study guide importer)
- CLI tool for bulk operations outside the browser