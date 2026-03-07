# FBLA Practice Tests - File Structure Specification

│   index.css
│   main.tsx
│
├───analytics
│       QuestionAnalytics.tsx
│       UserAnalytics.tsx
│
├───app
│       App.tsx
│       providers.tsx
│       router.tsx
│
├───auth
│       AuthProvider.tsx
│       ProtectedRoute.tsx
│       useAuth.ts
│
├───lib
│       env.ts
│       supabase.ts
│
├───pages
│       Admin.tsx
│       Dashboard.tsx
│       Login.tsx
│       Register.tsx
│       Results.tsx
│
├───questions
│       question.schema.ts
│       QuestionsAdmin.tsx
│       useQuestions.ts
│
├───tests
│       PracticeShell.tsx
│       test.schema.ts
│       TestConfig.tsx
│       TestShell.tsx
│       useGenerateTest.ts
│
├───topics
│       topic.schema.ts
│       TopicsAdmin.tsx
│       useTopics.ts
│
└───ui

## Root Files

### `index.css`
**Purpose:** Tailwind CSS import entry point  
**Functionality:** Imports Tailwind CSS base styles, components, and utilities  
**Implementation:** Single line: `@import "tailwindcss"`  
**Dependencies:** Tailwind CSS v4 (via `@tailwindcss/vite` plugin)  
**Note:** Imported by `main.tsx`

### `main.tsx`
**Purpose:** React application entry point  
**Functionality:**
- Creates React root and mounts to `#root` DOM element
- Wraps app in `StrictMode` for development warnings
- Wraps app in `Providers` for global context (Auth + React Query)
- Renders root `App` component
- Imports global CSS

**Implementation:**
```typescript
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Providers>
      <App />
    </Providers>
  </StrictMode>
)
```

**Dependencies:**
- React 19
- `@/app/providers` (Auth + Query Client)
- `@/app/App` (Router wrapper)
- `@/index.css` (Tailwind)

---

## `analytics/` - Admin Analytics Components

### `QuestionAnalytics.tsx`
**Purpose:** Admin view of per-question performance statistics  
**Functionality:**
- Displays table of all questions with stats: attempts, correctness %, avg time, marked count, ratings
- Click "Details" on any question → modal with:
  - Answer distribution chart (bar graph showing selections per choice)
  - All user feedback (ratings + text comments)
- Color-coded correctness % (green ≥70%, yellow ≥50%, red <50%)
- Fetches data from: `questions`, `question_responses`, `question_feedback`, `answer_choices`

**Key Implementation Details:**
- Loads all questions, then calculates stats via separate queries per question
- Answer distribution: COUNT by `selected_choice_id`
- Feedback aggregation: AVG of difficulty/quality ratings
- Modal uses fixed overlay with scroll

**Dependencies:**
- Supabase client
- React state for table + modal
- No external chart library (custom bar rendering with divs)

**Security:** Admin-only (protected route), RLS enforces read-all access

---

### `UserAnalytics.tsx`
**Purpose:** Admin view of per-user performance statistics  
**Functionality:**
- Displays table of users with: email, total tests, avg score %, last active date
- Click "Details" on any user → modal with:
  - Performance by topic (visual progress bars)
  - Recent test history (last 20 tests)
- Filters out users with no completed tests
- Color-coded avg scores (green ≥70%, yellow ≥50%, red <50%)

**Key Implementation Details:**
- Fetches all users, then aggregates test_attempts per user
- Performance by topic: Groups attempts by topic_id, calculates avg
- Only shows completed attempts (`completed_at IS NOT NULL`)

**Dependencies:**
- Supabase client
- React state for table + modal

**Security:** Admin-only, RLS enforces admin can read all user data

---

## `app/` - Application Bootstrap

### `App.tsx`
**Purpose:** Root application component  
**Functionality:** Renders React Router's `RouterProvider` with app routes  
**Implementation:** Simple wrapper around `<RouterProvider router={router} />`  
**Dependencies:**
- React Router v7
- `@/app/router` (route definitions)

---

### `providers.tsx`
**Purpose:** Global context providers wrapper  
**Functionality:**
- Wraps children with `QueryClientProvider` (React Query)
- Wraps children with `AuthProvider` (Supabase auth session management)
- Creates single `QueryClient` instance

**Implementation:**
```typescript
<QueryClientProvider client={queryClient}>
  <AuthProvider>
    {children}
  </AuthProvider>
</QueryClientProvider>
```

**Dependencies:**
- TanStack React Query v5
- `@/auth/AuthProvider`

**Note:** React Query is installed but not actively used yet (direct Supabase calls in components)

---

### `router.tsx`
**Purpose:** Application route definitions  
**Functionality:** Defines all app routes using React Router's `createBrowserRouter`

**Routes:**
- `/login` → Login page (public)
- `/register` → Register page (public)
- `/` → Dashboard (protected)
- `/test/:id` → TestShell (protected) - take a test
- `/practice` → PracticeShell (protected) - practice mode
- `/results/:id` → Results page (protected) - view test results
- `/admin` → Admin panel (protected, admin-only)

**Implementation:**
- Uses `ProtectedRoute` wrapper for authenticated routes
- Uses `requireAdmin` prop for admin-only routes

**Dependencies:**
- React Router v7
- `@/auth/ProtectedRoute`
- All page/shell components

---

## `auth/` - Authentication System

### `AuthProvider.tsx`
**Purpose:** Global authentication context provider  
**Functionality:**
- Manages Supabase auth session state
- Fetches user role from `public.users` table
- Provides `useAuth` hook to access: `user`, `role`, `loading`

**Key Implementation Details:**
- On mount: calls `getSession()` to bootstrap
- Subscribes to `onAuthStateChange` for real-time session updates
- When user changes: queries `users` table for role
- Race condition handling: `settled` flag prevents double-sets
- Role is fetched separately (not from JWT) for security

**State:**
- `user: User | null` - Supabase auth user object
- `role: 'user' | 'admin' | null` - From database
- `loading: boolean` - Auth state resolving

**Dependencies:**
- Supabase client
- React Context API

**Security:** Role comes from database (RLS enforced), never trust JWT alone

---

### `ProtectedRoute.tsx`
**Purpose:** Route guard component  
**Functionality:**
- Redirects unauthenticated users to `/login`
- Redirects non-admins to `/` when `requireAdmin={true}`
- Shows nothing during auth loading (prevents flash)

**Props:**
- `children: JSX.Element` - Component to render if authorized
- `requireAdmin?: boolean` - If true, requires admin role

**Implementation:**
```typescript
if (loading) return null
if (!user) return <Navigate to="/login" replace />
if (requireAdmin && role !== 'admin') return <Navigate to="/" replace />
return children
```

**Dependencies:**
- React Router's `Navigate`
- `useAuth` hook

---

### `useAuth.ts`
**Purpose:** Re-export of `useAuth` from AuthProvider  
**Functionality:** Simple re-export for cleaner imports  
**Implementation:** `export { useAuth } from './AuthProvider'`  
**Usage:** `const { user, role, loading } = useAuth()`

---

## `lib/` - Utilities & Configuration

### `env.ts`
**Purpose:** Environment variable validation and access  
**Functionality:**
- Runtime validation that required env vars exist
- Throws descriptive error if missing
- Exports typed `env` object

**Implementation:**
```typescript
function requireEnv(name: string): string {
  const value = import.meta.env[name]
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

export const env = {
  VITE_SUPABASE_URL: requireEnv('VITE_SUPABASE_URL'),
  VITE_SUPABASE_ANON_KEY: requireEnv('VITE_SUPABASE_ANON_KEY'),
}
```

**Dependencies:** Vite's `import.meta.env`  
**Note:** Fails fast at runtime if .env.local is misconfigured

---

### `supabase.ts`
**Purpose:** Supabase client singleton  
**Functionality:** Creates and exports single Supabase client instance

**Configuration:**
- Auth: persistent sessions, auto-refresh tokens, detect session in URL
- Uses environment variables from `env.ts`

**Implementation:**
```typescript
export const supabase = createClient(
  env.VITE_SUPABASE_URL,
  env.VITE_SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  }
)
```

**Dependencies:**
- `@supabase/supabase-js`
- `@/lib/env`

**Note:** Single instance shared across entire app

---

## `pages/` - Route Pages

### `Admin.tsx`
**Purpose:** Admin panel with tabbed interface  
**Functionality:**
- Three main tabs: Topics, Questions, Analytics
- Analytics has two sub-tabs: Question Analytics, User Analytics
- Tab state managed locally

**Components Rendered:**
- Topics tab → `TopicsAdmin`
- Questions tab → `QuestionsAdmin`
- Analytics → Question Analytics → `QuestionAnalytics`
- Analytics → User Analytics → `UserAnalytics`

**Dependencies:**
- All admin feature components
- Tailwind for tab styling

**Security:** Protected by `/admin` route with `requireAdmin`

---

### `Dashboard.tsx`
**Purpose:** User home page after login  
**Functionality:**
- Header with app title + admin link (if admin) + logout button
- Test configuration form (`TestConfigForm`)
- Test history table (adjustable limit: 5/10/20/50/100)
- Shows last N completed tests with scores, dates, topics
- "View Results" button per test

**Key Implementation Details:**
- Fetches test_attempts filtered by user_id and completed_at
- Color-coded score percentages (green/yellow/red)
- Time formatting: MM:SS
- Date formatting: "Mon DD, YYYY"
- History limit controlled by dropdown (default 10)
- Re-fetches when limit changes

**Dependencies:**
- Supabase client
- `@/tests/TestConfig`
- `useAuth` hook
- React Router's `Link` and `useNavigate`

**State:**
- `attempts: TestAttempt[]`
- `loading: boolean`
- `error: string | null`
- `historyLimit: number` (5/10/20/50/100)

---

### `Login.tsx`
**Purpose:** User login page  
**Functionality:**
- Email/password form with validation
- Submit calls `supabase.auth.signInWithPassword()`
- Error handling (wrong password, network errors)
- Loading state during submission
- Link to `/register`
- Enter key submits form

**Key Implementation Details:**
- Wraps inputs in `<form onSubmit={handleSubmit}>`
- Trims email/password before submission
- Error clears on input change
- Navigates to `/` on success (AuthProvider detects session)

**Dependencies:**
- Supabase client
- React Router's `Link`, `useNavigate`

**Security:** Inputs trimmed, HTML5 `required` attribute, Supabase handles password hashing

---

### `Register.tsx`
**Purpose:** User registration page  
**Functionality:**
- Email/password/confirm password form
- Validates password match and minimum length (6 chars)
- Submit calls `supabase.auth.signUp()`
- Shows success screen with email confirmation message
- Link to `/login`
- Enter key submits form

**Key Implementation Details:**
- Wraps inputs in `<form onSubmit={handleSubmit}>`
- Trims all inputs before submission
- Password validation: length ≥6, match confirmation
- Sets `emailRedirectTo: window.location.origin`
- Success state renders different UI (check email message)
- `handle_new_user` trigger creates `users` table row automatically

**Dependencies:**
- Supabase client
- React Router's `Link`

**Security:** Password length validation, confirmation match, Supabase handles verification email

---

### `Results.tsx`
**Purpose:** Detailed test results page  
**Functionality:**
- Summary card: score (X/Y, %), time taken, completion date, topic
- Per-question breakdown:
  - Question text with position number
  - All 4 choices in user's display order
  - User's answer highlighted (green=correct, red=wrong, gray=unanswered)
  - Correct answer always shown (green border)
  - Explanation text if exists
  - Result badge (✓ Correct / ✗ Incorrect / — Unanswered)
- "Back to Dashboard" button

**Key Implementation Details:**
- Route param: `/results/:attemptId`
- Fetches data: test_attempts, attempt_questions (for position), question_responses, questions, answer_choices
- Joins through `attempt_questions.position` to preserve test order
- Uses `displayed_choices_order` from question_responses for correct choice ordering
- Validates user owns attempt (`user_id === attempt.user_id`)
- Redirects to `/test/:id` if attempt not completed

**Data Loading Strategy:**
1. Fetch test_attempts (score, time, user_id, topic)
2. Fetch attempt_questions (position ordering)
3. Fetch question_responses (selected_choice_id, is_correct, displayed_choices_order)
4. Merge by question_id
5. Fetch questions (text, explanation)
6. Fetch answer_choices (all 4 per question)
7. Sort by position for display

**Dependencies:**
- Supabase client
- `useAuth` hook
- React Router's `useParams`, `useNavigate`

**Security:**
- RLS enforces user can only fetch own attempts
- Double-checks `user_id` in code
- Auth loading check prevents flash

**Edge Cases Handled:**
- Attempt doesn't exist → error
- User doesn't own → error + redirect
- Not completed → redirect to continue test
- Deleted topic → shows "Unknown Topic"
- Null explanation → not rendered
- Division by zero → safe percentage calc

---

## `questions/` - Question Management

### `question.schema.ts`
**Purpose:** Zod validation schema for question form  
**Status:** PLACEHOLDER (empty file)  
**Expected Functionality:**
- Define `QuestionFormData` type
- Validate question_text (1-2000 chars)
- Validate 4 answer choices (all required)
- Validate exactly 1 correct answer
- Validate difficulty_level (1-5, optional)

**Dependencies:** Zod v4

---

### `QuestionsAdmin.tsx`
**Purpose:** Admin CRUD interface for questions  
**Status:** IMPLEMENTED (need to upload to see full spec)  
**Expected Functionality:**
- List all questions with topic, creation date
- Create new question form with:
  - Topic dropdown
  - Question text
  - 4 answer choices (A-D)
  - Select correct answer
  - Explanation text (optional)
  - Difficulty level (1-5, optional)
- Edit existing questions
- Delete questions
- Validation: Exactly 4 choices, exactly 1 correct

**Dependencies:**
- Supabase client
- `useAuth` hook
- Question schema (when implemented)

**Security:** Admin-only, RLS enforces insert/update/delete permissions

---

### `useQuestions.ts`
**Purpose:** React Query hook for questions data  
**Status:** PLACEHOLDER (empty file)  
**Expected Functionality:**
- `useQuestions()` - Fetch all questions with caching
- `useQuestion(id)` - Fetch single question
- `useCreateQuestion()` - Mutation for creating
- `useUpdateQuestion()` - Mutation for updating
- `useDeleteQuestion()` - Mutation for deleting

**Dependencies:** React Query, Supabase client

**Note:** Not currently used (direct Supabase calls in components)

---

## `tests/` - Test Taking System

### `PracticeShell.tsx`
**Purpose:** Practice mode test-taking interface  
**Functionality:**
- Infinite or finite practice mode (no timer, no scoring)
- Select answer → Submit → See feedback → Next
- Immediate feedback after submit:
  - Shows if correct/wrong
  - Highlights correct answer in green
  - Shows explanation if exists
- Infinite mode: cycles through question pool forever
- No database writes (ephemeral)

**Key Implementation Details:**
- Route: `/practice?mode=practice&topic={id}&count={n}`
- Count=0 → infinite mode
- Loads all questions from topic into pool
- Shuffles pool, cycles with modulo: `questionIndex % pool.length`
- Randomizes choice order per question
- State: `isSubmitted` separate from `selectedChoice`
- No Previous button, no palette (linear progression)

**State:**
- `questionPool: QuestionWithChoices[]` - All available questions
- `currentQuestion: QuestionWithChoices | null` - Current question
- `questionIndex: number` - Progress counter (0→∞)
- `selectedChoice: string | null` - Selected choice ID
- `isSubmitted: boolean` - Has user submitted answer?
- `isInfinite: boolean` - Infinite mode flag

**Dependencies:**
- Supabase client
- React Router's `useSearchParams`, `useNavigate`

**Security:** Protected route, RLS enforces read access, no writes

**Edge Cases:**
- Topic has 0 questions → error message
- Fewer questions than requested → warning shown
- Refresh mid-practice → loses progress (acceptable)

---

### `test.schema.ts`
**Purpose:** Zod validation schema for test configuration  
**Functionality:**
- Validates test config form inputs
- Schema: `topicId` (UUID), `questionCount` (1-100), `useTimer` (boolean), `minutes` (1-180, optional)

**Implementation:**
```typescript
export const testConfigSchema = z.object({
  topicId: z.string().uuid(),
  questionCount: z.number().int().min(1).max(100),
  useTimer: z.boolean(),
  minutes: z.number().int().min(1).max(180).optional()
})
```

**Dependencies:** Zod v4  
**Usage:** `TestConfig.tsx` calls `testConfigSchema.safeParse()`

---

### `TestConfig.tsx`
**Purpose:** Test configuration form component  
**Functionality:**
- Dropdown: Select topic
- Dropdown: Select question count (10/25/50/100/Infinite)
- Checkbox: Enable timer (disabled in practice mode)
- Input: Timer minutes (1-180)
- Checkbox: Practice Mode
- Submit:
  - Practice mode → navigate to `/practice?...`
  - Test mode → call `generate_test()` RPC → navigate to `/test/{attemptId}`

**Key Implementation Details:**
- Infinite (count=0) only allowed in practice mode
- Practice mode auto-disables timer
- Validates with `testConfigSchema`
- Errors clear on input change
- Loading state during RPC call
- Button text changes: "Start Test" vs "Start Practice"

**State:**
- `topics: Topic[]`
- `topicId: string`
- `questionCount: string` (dropdown value)
- `useTimer: boolean`
- `minutes: string`
- `practiceMode: boolean`
- `error: string | null`
- `submitting: boolean`

**Dependencies:**
- Supabase client
- React Router's `useNavigate`
- `test.schema.ts`

**Security:** RLS enforces `generate_test()` requires auth, validates question count

---

### `TestShell.tsx`
**Purpose:** Main test-taking interface (graded mode)  
**Functionality:**
- Timer (countdown if enabled)
- Question navigation (all questions, one at a time, review only)
- Answer selection
- Choice elimination
- Mark for review
- Question palette (always visible)
- Autosave every 30 seconds
- Tab tracking (counts visibility changes)
- Submit test → score screen → navigate to results

**Key Implementation Details:**
- Route: `/test/:attemptId`
- Loads test from `test_attempts`, `attempt_questions`, `question_responses`
- Uses `displayed_choices_order` from server for choice ordering
- Timer state persists on re-render via refs
- Autosave pushes state to `question_responses` table
- Submit calls `submit_test()` RPC
- Phase 2 features: palette, elimination, mark for review

**State Management:**
- Refs for stable closures: `currentIndexRef`, `autosaveRef`, `responsesRef`
- `responsesRef` mirrors state every render for fresh values in callbacks

**View Modes:**
- All Questions: Scrollable list of all questions
- One at a Time: Single question with prev/next
- Review Only: Only marked questions

**Choice States:**
- Default: White/gray border
- Hover: Light blue
- Selected: Blue bg/white text
- Eliminated: Red-gray, strikethrough, not selectable

**Dependencies:**
- Supabase client
- React Router's `useParams`, `useNavigate`
- `useAuth` hook

**Security:**
- RLS enforces user owns attempt
- Server never sends correct answers until submit
- Tab tracking for integrity monitoring

---

### `useGenerateTest.ts`
**Purpose:** React hook for calling generate_test RPC  
**Status:** PLACEHOLDER (empty file)  
**Expected Functionality:**
- Wraps `supabase.rpc('generate_test', params)`
- Returns mutation with loading/error states
- Could use React Query for better state management

**Dependencies:** Supabase client, React Query (if implemented)

**Note:** Currently not used (direct RPC call in TestConfig)

---

## `topics/` - Topic Management

### `topic.schema.ts`
**Purpose:** Zod validation schema for topics  
**Status:** PLACEHOLDER (empty file)  
**Expected Functionality:**
- Validate topic name (required, unique, 1-100 chars)
- Validate description (optional, 1-500 chars)

**Dependencies:** Zod v4

---

### `TopicsAdmin.tsx`
**Purpose:** Admin CRUD interface for topics  
**Functionality:**
- List all topics (sorted alphabetically)
- Create new topic (name input + Add button)
- Rename topic (inline editing in table)
- Delete topic (with confirmation)
- Optimistic UI updates with rollback on error

**Key Implementation Details:**
- Maintains `committedNames` ref for rollback on edit failure
- Inline editing: onChange updates local state, onBlur commits to DB
- Rollback: Reverts to `committedNames[id]` if update fails
- Delete: Requires confirmation via `confirm()`
- Mutating flag prevents duplicate submissions

**State:**
- `topics: Topic[]`
- `newTopic: string` (create form input)
- `loading: boolean` (initial load)
- `mutating: boolean` (during create/update/delete)
- `error: string | null`
- `committedNames: Ref<Record<id, name>>` (for rollback)

**Dependencies:**
- Supabase client
- React useRef for committedNames

**Security:** Admin-only, RLS enforces insert/update/delete permissions

**Error Handling:**
- 42501 error code → "Not authorized" message
- Network errors → generic error message
- Rollback on failed updates

---

### `useTopics.ts`
**Purpose:** React Query hook for topics data  
**Status:** PLACEHOLDER (empty file)  
**Expected Functionality:**
- `useTopics()` - Fetch all topics with caching
- `useCreateTopic()` - Mutation for creating
- `useUpdateTopic()` - Mutation for updating
- `useDeleteTopic()` - Mutation for deleting

**Dependencies:** React Query, Supabase client

**Note:** Not currently used (direct Supabase calls in TopicsAdmin)

---

## `ui/` - Shared UI Components

**Status:** EMPTY FOLDER  
**Purpose:** Reusable UI components (buttons, inputs, modals, etc.)  
**Expected Contents:**
- shadcn/ui components (if added)
- Custom shared components
- Design system primitives

**Note:** Currently no shared components (inline styles in pages)

---

## Summary

**Fully Implemented:**
- ✅ Authentication system (AuthProvider, ProtectedRoute)
- ✅ Routing (all routes defined)
- ✅ Admin: Topics CRUD, Questions CRUD, Analytics
- ✅ User: Dashboard, Test Config, Test Taking, Practice Mode, Results
- ✅ Database integration (Supabase client, RLS)

**Placeholder/Empty:**
- ⚠️ `question.schema.ts` - Not needed yet (form uses inline validation)
- ⚠️ `topic.schema.ts` - Not needed yet (form uses inline validation)
- ⚠️ `useQuestions.ts` - React Query hook (not used)
- ⚠️ `useTopics.ts` - React Query hook (not used)
- ⚠️ `useGenerateTest.ts` - React Query hook (not used)
- ⚠️ `ui/` folder - No shared components yet

**Key Patterns:**
- Direct Supabase calls (no abstraction layer)
- `@/` imports for all cross-directory imports
- Tailwind-only styling (no CSS modules)
- RLS for all security (server-side enforcement)
- Role from database (not JWT)
- Optimistic UI with rollback pattern
- Loading/error/success states in all components
- Trim inputs before submission
- Error clearing on input change

**Tech Stack:**
- React 19, TypeScript, Vite 7
- Tailwind CSS v4
- React Router v7
- TanStack React Query v5 (installed, minimal usage)
- Zod v4 (validation)
- Supabase (Auth, PostgreSQL, Storage)
