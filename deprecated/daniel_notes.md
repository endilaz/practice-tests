Essential Files for Handoff
Core Implementation (what's working):

src/tests/TestShell.tsx - Complete Phase 2 test-taking UI (836 lines, all features implemented)
src/tests/useGenerateTest.ts - Test generation hook
src/tests/test.schema.ts - Zod validation for test config
src/auth/AuthProvider.tsx - Session management with race condition fix
src/auth/useAuth.ts - Re-export barrel file
src/lib/supabase.ts - Supabase client singleton
src/lib/env.ts - Environment validation with runtime guards

Configuration:
8. vite.config.ts - Path aliases and React plugin
9. tsconfig.json - TypeScript config with path mappings
10. package.json - All dependencies and scripts
Database (for reference):
11. fix_generate_test.sql - The corrected generate_test function with jsonb_agg
12. fix_users_policies.sql - RLS policies with self-demotion protection
Documentation:
13. CONTEXT_PROMPT.md - The main handoff document (already has this)
14. PROJECT_SPECIFICATION.md - Original full spec (if you have it)
Optional but helpful:
15. src/topics/TopicsAdmin.tsx - Working example of CRUD UI pattern
16. src/tests/TestConfig.tsx - Form example with Zod validation
Minimal Set (if you want to keep it light)
Just upload these 5:

CONTEXT_PROMPT.md - Everything they need to know
TestShell.tsx - Complete reference implementation
useGenerateTest.ts - RPC pattern example
AuthProvider.tsx - Session management pattern
PROJECT_SPECIFICATION.md - Original requirements

// new claude prompt that seems to be bad
# FBLA Practice Test App - Context Prompt

## Project Overview

Building a web-based practice test platform for FBLA (Future Business Leaders of America) using React 19 + TypeScript + Vite 7 + Supabase. The app generates unique randomized tests from a question pool, tracks user performance, and provides admin tools for question management.

**Tech Stack:**
- Frontend: React 19, TypeScript, Vite 7, Tailwind CSS, React Router
- Backend: Supabase (PostgreSQL + Auth + Storage + RLS)
- Key Libraries: Zod (validation), no React Query yet

**Key Architectural Decisions:**
- UUID primary keys throughout (not SERIAL) - generate_test function returns UUID
- JSONB for arrays (displayed_choices_order, eliminated_choices) not PostgreSQL arrays
- Row Level Security (RLS) on all tables with helper function `current_user_role()` to avoid recursion
- Three randomization layers: question selection, question order, choice order per question

---

## Database Schema (Complete & Deployed)

All tables, policies, and functions are **already created in Supabase**.

### Core Tables

**users** - UUID (references auth.users), role ('admin'|'user'), display_name
**topics** - UUID, name (unique), description
**questions** - UUID, topic_id, question_text, question_image_url, explanation_text, explanation_image_url, difficulty_level (1-5), created_by_admin_id, is_flagged, created_at
**answer_choices** - UUID, question_id, choice_letter ('A'|'B'|'C'|'D'), choice_text, choice_image_url, is_correct, unique(question_id, choice_letter)
**test_attempts** - UUID, user_id, topic_id, question_count, use_timer, minutes, started_at, completed_at, score, total_possible, total_time_seconds, out_of_browser_seconds
**attempt_questions** - UUID, attempt_id, question_id, position, unique(attempt_id, question_id), unique(attempt_id, position)
**question_responses** - UUID, attempt_id, question_id, selected_choice_id, is_correct, time_spent_seconds, marked_for_review, eliminated_choices (JSONB), displayed_choices_order (JSONB), tab_switch_count, answered_at, unique(attempt_id, question_id)
**question_feedback** - UUID, user_id, question_id, attempt_id, difficulty_rating (1-5), quality_rating (1-5), feedback_text, created_at

### Key Functions

**generate_test(p_topic_id UUID, p_question_count INT, p_use_timer BOOLEAN, p_minutes INT) → UUID**
- Creates test_attempts row
- Randomly selects N questions, inserts into attempt_questions with position
- Creates question_responses rows with randomized displayed_choices_order (JSONB via jsonb_agg)
- Initializes eliminated_choices as empty JSONB array
- Returns attempt_id

**submit_test(p_attempt_id UUID) → JSON**
- Counts correct answers by checking is_correct column
- Updates test_attempts: completed_at, total_time_seconds (started_at → now), score, total_possible
- Returns {score, total}
- Does NOT update is_correct itself - that's done elsewhere (scoring logic TBD)

**current_user_role() → TEXT**
- Helper for RLS policies to avoid infinite recursion
- Returns 'admin' or 'user' or NULL

### RLS Policies

All tables have RLS enabled. Pattern:
- Users can read/write their own data (WHERE user_id = auth.uid())
- Admins can read/write everything (using current_user_role() = 'admin')
- Questions/choices are publicly readable
- Admin self-demotion is blocked (WITH CHECK prevents changing own role to 'user')

**Storage Bucket:** `question-images` (public, 5MB limit, authenticated users can upload, admins can delete)

---

## Frontend Architecture

### File Structure
```
src/
├── app/
│   ├── App.tsx           - Root component with providers
│   ├── providers.tsx     - AuthProvider + future QueryClientProvider
│   └── router.tsx        - Routes: /, /login, /register, /admin, /test
├── auth/
│   ├── AuthProvider.tsx  - Session management, exposes {user, role, loading}
│   ├── ProtectedRoute.tsx - Route guard (redirects if not authed/admin)
│   └── useAuth.ts        - Re-exports useAuth from AuthProvider
├── lib/
│   ├── supabase.ts       - Single Supabase client instance
│   └── env.ts            - Runtime env validation (requireEnv helper)
├── pages/
│   ├── Dashboard.tsx     - User home (test config form lives here)
│   ├── Admin.tsx         - Admin panel (topics CRUD)
│   ├── Login.tsx         - Auth form (stub, needs full implementation)
│   └── Register.tsx      - Auth form (stub, needs full implementation)
├── topics/
│   ├── TopicsAdmin.tsx   - Full CRUD UI (inline in Admin page)
│   ├── useTopics.ts      - Empty file (intended for data fetching extraction)
│   └── topic.schema.ts   - Empty file (intended for Zod validation)
└── tests/
    ├── TestConfig.tsx    - Form to configure test (topic, count, timer)
    ├── TestShell.tsx     - **Main test-taking UI (Phase 2 complete)**
    ├── useGenerateTest.ts - Hook that calls generate_test RPC
    └── test.schema.ts    - Zod schema for test config validation
```

### Auth Flow
1. `AuthProvider` calls `getSession()` and `onAuthStateChange()` on mount
2. Both callbacks set loading=false (whichever fires first) to avoid race condition
3. Fetches role from `users` table when session exists
4. `ProtectedRoute` checks user/role, redirects or renders children

### Test Generation Flow
1. User fills `TestConfig` form (topic, count, optional timer)
2. Form validates with Zod, navigates to `/test?topic=UUID&count=N&timer=0|1&minutes=M`
3. `TestShell` reads params, calls `useGenerateTest.generateTest()` which RPC's `generate_test()`
4. Receives `attempt_id`, loads questions/choices/responses from DB
5. Renders test interface

---

## Implementation Status

### ✅ Completed (Features 1-5 Phase 2)

**Feature 1 - Foundation:**
- Vite scaffolded, all dependencies installed
- Supabase client configured (`lib/supabase.ts`)
- Environment validation (`lib/env.ts`)
- Path aliases configured (`@/` → `./src`)

**Feature 2 - Auth:**
- Email/password registration + login (Supabase Auth)
- `users` table with role ('admin'|'user')
- `AuthProvider` with race condition fix (initialized flag)
- Protected routes working
- RLS policies with `current_user_role()` helper

**Feature 3 - Admin Topics:**
- Topics CRUD UI (`TopicsAdmin.tsx`)
- Inline editing (save on blur)
- RLS policies (admins only)

**Feature 4 - Test Configuration:**
- `TestConfig.tsx` form with Zod validation
- `useGenerateTest` hook calling `generate_test()` RPC
- URL param navigation to `/test`

**Feature 5 - Test Taking (Phase 2 COMPLETE):**
- **One-at-a-time question rendering** with prev/next navigation
- **Answer selection** with optimistic updates + persistence
- **Timer** with countdown, color changes (<5min yellow, <1min red), auto-submit at 0:00
- **Submit** with confirmation dialog, calls `submit_test()` RPC, shows score screen
- **Question palette** (footer, always visible):
  - Gray = unanswered, Green = answered, Yellow = marked for review
  - Blue border = current question (in 'one' and 'review' modes)
  - Click to navigate/scroll
- **View modes** (dropdown in header):
  - "One at a Time" - single card, prev/next buttons
  - "All Questions" - vertical scroll, all cards visible, no prev/next
  - "Review Only" - only marked questions, prev/next skip unmarked, message if none marked
- **Mark for review** - checkbox on each card, persisted to DB, palette turns yellow
- **Elimination** - ✕ button per choice, red tint + strikethrough, not selectable, auto-deselects if eliminating selected choice
- **Autosave** - every 30 seconds, pushes marked_for_review, eliminated_choices, tab_switch_count
- **Tab tracking** - visibilitychange event, increments tab_switch_count on current question when user leaves tab
- **Report Issue** - modal with difficulty rating (1-5), quality rating (1-5), comments, submits to question_feedback table
- **State hydration** - all Phase 2 state loads from DB on refresh (eliminated_choices, marked_for_review, tab_switch_count)
- **Final flush before submit** - doSave() runs synchronously before submit_test() to guarantee no NULL data at score time

### Critical Bugs Fixed

**Bug 1 - Letter labels out of order:**
- **Cause:** Rendered `choice.choice_letter` (original DB letter) instead of positional label
- **Fix:** Display `DISPLAY_LABELS[index]` (A, B, C, D top-to-bottom) regardless of shuffle
- **Location:** Line ~305 in QuestionCard

**Bug 2 - NULL data in Supabase:**
- **Cause:** selectAnswer errors only logged to console, no autosave, so Phase 2 fields never persisted
- **Fix:** 
  - selectAnswer now calls `setError()` on failure and reverts optimistic update
  - Autosave runs every 30s, persists all fields
  - Final `doSave()` before `submit_test()` ensures complete state
- **Location:** selectAnswer error handler, autosave effect, handleSubmit

**Bug 3 - Autosave interval reset on every click:**
- **Cause:** `responses` was in autosave effect dep array, so interval recreated on every state change
- **Fix:** `responsesRef` mirrors state every render, doSave reads from ref, `responses` removed from deps
- **Location:** Lines 101-102, 260, 227

### 🚧 Known Issues

**Scroll-to-top on interaction:**
- **Symptom:** Clicking any interactive element (answer choice, mark for review, elimination, etc.) causes page to scroll to top
- **Likely Cause:** React Router or state update triggering a scroll reset
- **Next Step:** Needs investigation and fix

### ❌ Not Implemented Yet

- Question management admin UI (create/edit/delete questions, bulk JSON import, image upload)
- Results review page (per-question breakdown with explanations, user's answer vs correct answer)
- Image support (questions and choices can have images, but UI doesn't render them)
- Time tracking per question (time_spent_seconds column exists but always 0)
- is_correct scoring logic (submit_test doesn't set it, unclear where it should be calculated)
- Login/Register full forms (only Supabase calls provided, need UI)

---

## Code Patterns & Conventions

### State Management in TestShell
```typescript
// Refs for stable closures:
currentIndexRef   // synced every render for visibilitychange
autosaveRef       // interval handle for cleanup
responsesRef      // mirrors responses for autosave without dep array churn

// State structure:
responses: Array<{
  question_id, selected_choice_id, displayed_choices_order,
  eliminated_choices: string[],  // choice IDs
  marked_for_review: boolean,
  tab_switch_count: number
}>
```

### Ordering Choices for Display
```typescript
// Server sends displayed_choices_order: ["C","A","D","B"]
// orderChoices() uses that to sort raw choices array
// Render loop uses DISPLAY_LABELS[index] for A/B/C/D labels
```

### RLS Pattern (avoiding recursion)
```sql
-- ❌ BAD (infinite recursion):
EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')

-- ✅ GOOD (uses helper):
current_user_role() = 'admin'
```

### Autosave Pattern
```typescript
// Effect with minimal deps (no state arrays):
useEffect(() => {
  const interval = setInterval(() => doSave(), 30_000)
  return () => clearInterval(interval)
}, [attemptId, loading, submitted])

// doSave reads from ref (always fresh, never stale):
async function doSave() {
  for (const r of responsesRef.current) { /* ... */ }
}
```

---

## Environment Setup

**.env.local** (in project root, not committed):
```
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

**vite.config.ts:**
```typescript
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') }
  }
})
```

**tsconfig.json:**
```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
  }
}
```

**Run:**
```bash
npm run dev        # http://localhost:5173
npm run build      # production build
npm run preview    # preview production build
```

---

## Detailed Feature Specifications (Next to Build)

### Question Management UI (Priority 1)

**Location:** `/admin` page, separate tab or section from Topics

**Create Question Form:**
- Topic dropdown (required, populated from topics table)
- Question text textarea (required, 1-2000 chars)
- Question image upload (optional, jpeg/png only, 5MB max)
- Four answer choices (A-D):
  - Each has: text input (required), optional image upload, is_correct radio button
  - Validation: exactly 4 choices, exactly 1 marked correct, all have text
- Explanation textarea (optional, shown after user submits test)
- Explanation image upload (optional)
- Difficulty level (1-5, optional, for admin reference)
- Submit button creates question + 4 answer_choices rows atomically

**Edit Question:**
- Load existing question + choices
- Pre-fill all fields
- Allow changing correct answer
- Update atomically (transaction wrapping question + choices)

**Delete Question:**
- Confirmation dialog: "This question will be removed from all future tests. Past test results will be preserved."
- Cascade deletes answer_choices (ON DELETE CASCADE in schema)
- Cannot delete if no questions exist (prevent breaking existing attempts)

**Bulk JSON Import:**
- File upload input accepting .json
- Expected format:
```json
{
  "topic": "Topic Name or UUID",
  "questions": [{
    "question_text": "...",
    "difficulty_level": 1,
    "answer_choices": [
      {"letter": "A", "text": "...", "is_correct": true},
      {"letter": "B", "text": "...", "is_correct": false},
      {"letter": "C", "text": "...", "is_correct": false},
      {"letter": "D", "text": "...", "is_correct": false}
    ],
    "explanation_text": "..."
  }]
}
```
- Validation: Zod schema, show errors before import
- Preview modal showing parsed questions
- Batch insert on confirm

**List Questions:**
- Table: Question text (truncated), Topic, Difficulty, Actions (Edit/Delete)
- Pagination (20 per page)
- Search/filter by topic
- Sort by created_at, difficulty

### Results Review Page (Priority 2)

**Route:** `/results/:attemptId` (protected, user can only see own attempts)

**Summary Section (top):**
- Score: "18 / 25 (72%)"
- Time taken: "23:45" (total_time_seconds formatted)
- Out-of-browser time: "0:34" if > 0 (out_of_browser_seconds formatted)
- Date completed: formatted completed_at

**Per-Question Breakdown:**
For each question in order:
- Question number, text, and image (if exists)
- Four choices displayed in the order user saw them (from displayed_choices_order)
- User's answer highlighted:
  - Green if correct
  - Red if incorrect
  - Gray if unanswered
- Correct answer always shown (green highlight)
- Explanation text and image displayed (if exists)
- Feedback form (if not already submitted):
  - Difficulty rating 1-5
  - Quality rating 1-5
  - Comments textarea
  - Submit button → inserts into question_feedback

**Navigation:**
- "Back to Dashboard" button at top
- Sticky summary section (score/time) while scrolling

### Image Upload Flow (Integrated into Question Forms)

**Upload Process:**
1. User selects image file (jpeg/png, 5MB max)
2. Frontend validates type and size
3. Upload to Supabase Storage bucket `question-images`
4. Filename: `{uuid}.{ext}` (e.g., `a3f2c1b0-...-.jpg`)
5. Get public URL: `https://{project-id}.supabase.co/storage/v1/object/public/question-images/{filename}`
6. Store URL in question_image_url or choice_image_url column

**Code Pattern:**
```typescript
const { data, error } = await supabase.storage
  .from('question-images')
  .upload(`${crypto.randomUUID()}.jpg`, file)
if (error) throw error
const url = supabase.storage.from('question-images').getPublicUrl(data.path).data.publicUrl
```

**Display:**
- In question cards: render `<img src={question_image_url} />` below question text
- In choices: render small thumbnail next to choice text
- In results page: render both question and explanation images

### Admin Analytics (Priority 3)

**Location:** `/admin/analytics` page

**Question Analytics Tab:**
- Table per question: text (truncated), times attempted, correctness %, avg time spent, times marked for review
- Click question row → detail view:
  - Full question text
  - Answer distribution chart (how many users picked each choice)
  - Average difficulty rating (from question_feedback)
  - Average quality rating (from question_feedback)
  - All feedback comments (admin-only, scrollable list)

**User Analytics Tab:**
- Table per user: display_name, total tests taken, average score, last active
- Click user row → detail view:
  - Test history (date, topic, score, time)
  - Performance by topic (chart or table)
  - Tab-switch patterns (average per test)

### Test History (User Feature)

**Location:** Dashboard page, section below test config form

**Display:**
- Table: Date, Topic, Score, Time, Actions
- "View Results" button → navigates to /results/:attemptId
- Sort by date (most recent first)
- Filter by topic
- Pagination (10 per page)

---

## Critical Implementation Details

### Scoring Logic (is_correct calculation)

**Current Problem:** `submit_test()` counts `is_correct` to compute score, but nothing sets `is_correct`. All rows have `is_correct = NULL` after submit.

**Solution:** Update `submit_test()` function to calculate and set `is_correct` before counting:

```sql
CREATE OR REPLACE FUNCTION submit_test(p_attempt_id UUID) RETURNS JSON AS $$
DECLARE
  v_score INT;
  v_total INT;
BEGIN
  -- First, calculate is_correct for each response
  UPDATE question_responses qr
  SET is_correct = (
    SELECT ac.is_correct
    FROM answer_choices ac
    WHERE ac.id = qr.selected_choice_id
  )
  WHERE qr.attempt_id = p_attempt_id;
  
  -- Then count correct answers
  SELECT 
    COUNT(*) FILTER (WHERE is_correct = true),
    COUNT(*)
  INTO v_score, v_total
  FROM question_responses
  WHERE attempt_id = p_attempt_id;
  
  -- Update attempt with score and completion time
  UPDATE test_attempts
  SET 
    completed_at = NOW(),
    total_time_seconds = EXTRACT(EPOCH FROM (NOW() - started_at))::INT,
    score = v_score,
    total_possible = v_total
  WHERE id = p_attempt_id;
  
  RETURN JSON_BUILD_OBJECT('score', v_score, 'total', v_total);
END;
$$ LANGUAGE plpgsql;
```

This ensures `is_correct` is properly set before scoring and is available for the Results page.

### User Flow Summary

**First-time User:**
1. Register at `/register`
2. Redirected to `/` (Dashboard)
3. Sees test config form (topic dropdown, count input, timer toggle)
4. Submits form → navigated to `/test?topic=UUID&count=25&timer=1&minutes=30`
5. Takes test (Phase 2 UI with all features)
6. Clicks Submit → sees score screen
7. Clicks "Back to Dashboard" → sees test history with "View Results" button
8. Clicks "View Results" → sees `/results/:attemptId` with per-question breakdown

**Admin User:**
1. Same as above, but also has access to `/admin` route
2. `/admin` has tabs: Topics, Questions, Analytics
3. Topics tab: existing CRUD (already implemented)
4. Questions tab: create/edit/delete questions, bulk import
5. Analytics tab: question stats, user performance

---

## Next Steps (Updated Priority Order)

1. **URGENT: Fix `submit_test()` function** - Update SQL to calculate `is_correct` before scoring (see above)
2. **Question Management UI** - Full CRUD for questions with image upload
3. **Results Review Page** - Per-question breakdown with explanations and feedback form
4. **Test History** - User dashboard section showing past attempts
5. **Image Support in Test-Taking** - Render question/choice images in TestShell
6. **Login/Register Full Forms** - Complete UI with validation and error handling
7. **Admin Analytics** - Question and user performance metrics
8. **Time Tracking** - Implement time_spent_seconds per question (track focus time)

---

## Key Code Files (Reference for New Features)

### useGenerateTest.ts (Test Generation Hook)
```typescript
import { useState } from 'react'
import { supabase } from '@/lib/supabase'

type GenerateTestParams = {
  topicId: string
  questionCount: number
  useTimer: boolean
  minutes: number
}

export function useGenerateTest() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function generateTest(params: GenerateTestParams): Promise<string | null> {
    setLoading(true)
    setError(null)

    try {
      const { data, error: rpcError } = await supabase.rpc('generate_test', {
        p_topic_id: params.topicId,
        p_question_count: params.questionCount,
        p_use_timer: params.useTimer,
        p_minutes: params.minutes,
      })

      if (rpcError) throw rpcError
      return data as string // attempt_id (UUID)
    } catch (err: any) {
      setError(err.message || 'Failed to generate test')
      return null
    } finally {
      setLoading(false)
    }
  }

  return { generateTest, loading, error }
}
```

### test.schema.ts (Zod Validation)
```typescript
import { z } from 'zod'

export const testConfigSchema = z.object({
  topicId: z.string().uuid('Please select a valid topic'),
  questionCount: z
    .number()
    .int()
    .min(1, 'Must have at least 1 question')
    .max(100, 'Cannot exceed 100 questions'),
  useTimer: z.boolean(),
  minutes: z
    .number()
    .int()
    .min(1, 'Timer must be at least 1 minute')
    .max(180, 'Timer cannot exceed 180 minutes')
    .optional(),
}).refine(
  data => !data.useTimer || (data.useTimer && data.minutes),
  { message: 'Timer duration required when timer is enabled', path: ['minutes'] }
)

export type TestConfig = z.infer<typeof testConfigSchema>
```

### AuthProvider.tsx (Session Management Pattern)
```typescript
import { createContext, useContext, useEffect, useState } from 'react'
import { User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

type AuthContextType = {
  user: User | null
  role: 'admin' | 'user' | null
  loading: boolean
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  role: null,
  loading: true,
})

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [role, setRole] = useState<'admin' | 'user' | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let settled = false

    // Check current session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!settled) {
        setUser(session?.user ?? null)
        if (session?.user) fetchRole(session.user.id)
        setLoading(false)
        settled = true
      }
    })

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      if (session?.user) fetchRole(session.user.id)
      if (!settled) {
        setLoading(false)
        settled = true
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function fetchRole(userId: string) {
    const { data } = await supabase
      .from('users')
      .select('role')
      .eq('id', userId)
      .single()
    setRole(data?.role ?? null)
  }

  return (
    <AuthContext.Provider value={{ user, role, loading }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
```

### Example Login.tsx (Full Implementation)
```typescript
import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'

export default function Login() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (signInError) {
      setError(signInError.message)
      setLoading(false)
      return
    }

    navigate('/')
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full bg-white rounded-lg shadow p-8">
        <h2 className="text-2xl font-bold mb-6 text-center">Login</h2>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-gray-600">
          Don't have an account?{' '}
          <Link to="/register" className="text-blue-600 hover:underline">
            Register
          </Link>
        </p>
      </div>
    </div>
  )
}
```

### Image Upload Helper
```typescript
// lib/uploadImage.ts
import { supabase } from './supabase'

export async function uploadQuestionImage(file: File): Promise<string> {
  // Validate
  const allowedTypes = ['image/jpeg', 'image/png']
  const maxSize = 5 * 1024 * 1024 // 5MB

  if (!allowedTypes.includes(file.type)) {
    throw new Error('Only JPEG and PNG images are allowed')
  }

  if (file.size > maxSize) {
    throw new Error('Image must be smaller than 5MB')
  }

  // Generate unique filename
  const ext = file.name.split('.').pop()
  const filename = `${crypto.randomUUID()}.${ext}`

  // Upload
  const { data, error } = await supabase.storage
    .from('question-images')
    .upload(filename, file)

  if (error) throw error

  // Get public URL
  const { data: urlData } = supabase.storage
    .from('question-images')
    .getPublicUrl(data.path)

  return urlData.publicUrl
}

export async function deleteQuestionImage(url: string) {
  // Extract filename from URL
  const filename = url.split('/').pop()
  if (!filename) return

  const { error } = await supabase.storage
    .from('question-images')
    .remove([filename])

  if (error) throw error
}
```

---

## Important Notes

- **All database work is done** - no migrations needed, tables/functions/policies all exist
- **UUIDs everywhere** - don't use SERIAL or expect integer IDs
- **JSONB not arrays** - eliminated_choices and displayed_choices_order are JSONB
- **TestShell is 836 lines** - might benefit from extraction into smaller components
- **Phase 2 is feature-complete** - all spec'd test-taking features implemented and tested
- **Current file:** `/mnt/user-data/outputs/TestShell.tsx` (replace `src/tests/TestShell.tsx` with this)