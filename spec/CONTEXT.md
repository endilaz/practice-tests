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
├── tsconfig.json                       ← references app + node configs
├── tsconfig.app.json                   ← covers src/, has @/ path alias
├── tsconfig.node.json                  ← covers vite.config.ts only
├── node_modules\
└── src\
    ├── index.css                       ← Tailwind entry (contents unknown — verify has @import "tailwindcss")
    ├── main.tsx                        ← EMPTY. Needs React mount. (see Section 7)
    ├── app\
    │   ├── App.tsx                     ← EMPTY. Needs to render RouterProvider. (see Section 7)
    │   ├── providers.tsx               ← EMPTY. Needs to wrap with AuthProvider + QueryClientProvider. (see Section 7)
    │   └── router.tsx                  ← IMPLEMENTED. See Section 6.
    ├── auth\
    │   ├── AuthProvider.tsx            ← IMPLEMENTED. Session bootstrap + role fetch. See Section 6.
    │   ├── ProtectedRoute.tsx          ← IMPLEMENTED. Route guard. See Section 6.
    │   └── useAuth.ts                  ← IMPLEMENTED. Re-exports useAuth from AuthProvider.
    ├── lib\
    │   ├── env.ts                      ← IMPLEMENTED. Runtime guard for env vars.
    │   └── supabase.ts                 ← IMPLEMENTED. Single Supabase client instance.
    ├── pages\
    │   ├── Login.tsx                   ← STUB. Contains only the signInWithPassword call, not a component.
    │   ├── Register.tsx                ← STUB. Contains only the signUp call, not a component.
    │   ├── Dashboard.tsx               ← EMPTY.
    │   └── Admin.tsx                   ← EMPTY.
    ├── tests\
    │   ├── test.schema.ts              ← IMPLEMENTED. Zod schema for test config form.
    │   ├── TestConfig.tsx              ← IMPLEMENTED. Test setup form (topic, count, timer). See Section 6.
    │   ├── TestShell.tsx               ← EMPTY. Future home of the test-taking interface (Feature 5).
    │   └── useGenerateTest.ts          ← EMPTY. Future hook to call generate_test() RPC.
    └── topics\
        ├── topic.schema.ts             ← EMPTY.
        ├── TopicsAdmin.tsx             ← IMPLEMENTED. Admin CRUD for topics. See Section 6.
        └── useTopics.ts                ← EMPTY.
```

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

## 6. Implemented Code — Full Source

### `src/app/router.tsx`
```typescript
import { createBrowserRouter } from 'react-router-dom'
import { ProtectedRoute } from '@/auth/ProtectedRoute'
import Login from '@/pages/Login'
import Register from '@/pages/Register'
import Dashboard from '@/pages/Dashboard'
import Admin from '@/pages/Admin'

export const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
  { path: '/register', element: <Register /> },
  {
    path: '/',
    element: (
      <ProtectedRoute>
        <Dashboard />
      </ProtectedRoute>
    )
  },
  {
    path: '/admin',
    element: (
      <ProtectedRoute requireAdmin>
        <Admin />
      </ProtectedRoute>
    )
  }
])
```

### `src/auth/AuthProvider.tsx`
```typescript
import { createContext, useContext, useEffect, useState } from 'react'
import { type User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

type Role = 'user' | 'admin'

type AuthContextValue = {
  user: User | null
  role: Role | null
  loading: boolean
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [role, setRole] = useState<Role | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let settled = false

    supabase.auth.getSession().then(({ data }) => {
      if (!settled) {
        settled = true
        setUser(data.session?.user ?? null)
      }
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!settled) {
        settled = true
        setUser(session?.user ?? null)
      } else {
        setUser(session?.user ?? null)
      }
    })

    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!user) {
      setRole(null)
      setLoading(false)
      return
    }

    supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single()
      .then(({ data, error }) => {
        if (error) {
          console.error('Failed to fetch role:', error)
          setRole(null)
        } else {
          setRole(data.role as Role)
        }
        setLoading(false)
      })
  }, [user])

  return (
    <AuthContext.Provider value={{ user, role, loading }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return ctx
}
```

### `src/auth/ProtectedRoute.tsx`
```typescript
import { Navigate } from 'react-router-dom'
import { useAuth } from './useAuth'

export function ProtectedRoute({
  children,
  requireAdmin = false
}: {
  children: JSX.Element
  requireAdmin?: boolean
}) {
  const { user, role, loading } = useAuth()

  if (loading || (requireAdmin && role === null)) {
    return null
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  if (requireAdmin && role !== 'admin') {
    return <Navigate to="/" replace />
  }

  return children
}
```

### `src/auth/useAuth.ts`
```typescript
export { useAuth } from './AuthProvider'
```

### `src/lib/env.ts`
```typescript
function requireEnv(name: string): string {
  const value = import.meta.env[name]
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}\n` +
      `Add it to .env.local in your project root.`
    )
  }
  return value
}

export const env = {
  VITE_SUPABASE_URL: requireEnv('VITE_SUPABASE_URL'),
  VITE_SUPABASE_ANON_KEY: requireEnv('VITE_SUPABASE_ANON_KEY'),
}
```

### `src/lib/supabase.ts`
```typescript
import { createClient } from '@supabase/supabase-js'
import { env } from './env'

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

### `src/topics/TopicsAdmin.tsx`
```typescript
import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'

type Topic = {
  id: string
  name: string
}

export function TopicsAdmin() {
  const [topics, setTopics] = useState<Topic[]>([])
  const [newTopic, setNewTopic] = useState('')
  const [loading, setLoading] = useState(true)
  const [mutating, setMutating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const committedNames = useRef<Record<string, string>>({})

  useEffect(() => {
    loadTopics()
  }, [])

  async function loadTopics() {
    setLoading(true)
    setError(null)

    const { data, error } = await supabase
      .from('topics')
      .select('id, name')
      .order('name')

    if (error) {
      setError(
        error.code === '42501'
          ? 'You are not authorized to manage topics.'
          : error.message
      )
    } else {
      setTopics(data)
      const committed: Record<string, string> = {}
      for (const t of data) {
        committed[t.id] = t.name
      }
      committedNames.current = committed
    }

    setLoading(false)
  }

  async function createTopic() {
    const name = newTopic.trim()
    if (!name || mutating) return

    setMutating(true)
    setError(null)

    const { data, error } = await supabase
      .from('topics')
      .insert({ name })
      .select()
      .single()

    if (error) {
      setError(error.message)
    } else {
      setTopics(prev => [...prev, data])
      committedNames.current[data.id] = data.name
      setNewTopic('')
    }

    setMutating(false)
  }

  async function renameTopic(id: string, name: string) {
    const trimmed = name.trim()

    if (!trimmed) {
      setTopics(prev =>
        prev.map(t => (t.id === id ? { ...t, name: committedNames.current[id] } : t))
      )
      return
    }

    if (trimmed === committedNames.current[id]) return
    if (mutating) return

    setMutating(true)
    setError(null)

    const { error } = await supabase
      .from('topics')
      .update({ name: trimmed })
      .eq('id', id)

    if (error) {
      setTopics(prev =>
        prev.map(t => (t.id === id ? { ...t, name: committedNames.current[id] } : t))
      )
      setError(error.message)
    } else {
      committedNames.current[id] = trimmed
      setTopics(prev =>
        prev.map(t => (t.id === id ? { ...t, name: trimmed } : t))
      )
    }

    setMutating(false)
  }

  async function deleteTopic(id: string) {
    if (!confirm('Delete this topic?') || mutating) return

    setMutating(true)
    setError(null)

    const { error } = await supabase
      .from('topics')
      .delete()
      .eq('id', id)

    if (error) {
      setError(error.message)
    } else {
      setTopics(prev => prev.filter(t => t.id !== id))
      delete committedNames.current[id]
    }

    setMutating(false)
  }

  if (loading) return <p>Loading topics...</p>

  return (
    <div>
      {error && <p className="text-red-600 mb-4">{error}</p>}

      <div className="flex gap-2 mb-4">
        <input
          className="border px-2 py-1 flex-1"
          value={newTopic}
          onChange={e => setNewTopic(e.target.value)}
          placeholder="New topic name"
          disabled={mutating}
        />
        <button
          onClick={createTopic}
          disabled={mutating}
          className="bg-blue-600 text-white px-4 py-1 disabled:opacity-50"
        >
          Add
        </button>
      </div>

      {topics.length === 0 ? (
        <p className="text-gray-600">No topics created yet.</p>
      ) : (
        <ul className="space-y-2">
          {topics.map(topic => (
            <li
              key={topic.id}
              className="flex items-center justify-between border p-2"
            >
              <input
                className="flex-1 mr-2 border px-2 py-1"
                value={topic.name}
                onChange={e =>
                  setTopics(prev =>
                    prev.map(t =>
                      t.id === topic.id
                        ? { ...t, name: e.target.value }
                        : t
                    )
                  )
                }
                onBlur={e => renameTopic(topic.id, e.target.value)}
                disabled={mutating}
              />
              <button
                onClick={() => deleteTopic(topic.id)}
                disabled={mutating}
                className="text-red-600 disabled:opacity-50"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

### `src/tests/TestConfig.tsx`
```typescript
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useNavigate } from 'react-router-dom'
import { testConfigSchema } from './test.schema'

type Topic = {
  id: string
  name: string
}

export function TestConfigForm() {
  const [topics, setTopics] = useState<Topic[]>([])
  const [topicId, setTopicId] = useState('')
  const [questionCount, setQuestionCount] = useState('25')
  const [useTimer, setUseTimer] = useState(false)
  const [minutes, setMinutes] = useState('30')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  const navigate = useNavigate()

  useEffect(() => {
    loadTopics()
  }, [])

  async function loadTopics() {
    const { data, error } = await supabase
      .from('topics')
      .select('id, name')
      .order('name')

    if (error) {
      setError(error.message)
    } else {
      setTopics(data)
    }
    setLoading(false)
  }

  function submit() {
    if (submitting) return
    setError(null)

    const parsed = testConfigSchema.safeParse({
      topicId,
      questionCount: Number(questionCount),
      useTimer,
      minutes: useTimer ? Number(minutes) : undefined,
    })

    if (!parsed.success) {
      const first = parsed.error.issues[0]
      setError(first?.message ?? 'Invalid test configuration.')
      return
    }

    setSubmitting(true)

    const params = new URLSearchParams({
      topic: parsed.data.topicId,
      count: String(parsed.data.questionCount),
      timer: parsed.data.useTimer ? '1' : '0',
      minutes: parsed.data.useTimer ? String(parsed.data.minutes) : '0',
    })

    navigate(`/test?${params.toString()}`)
  }

  if (loading) return <p>Loading topics...</p>

  return (
    <div className="space-y-4">
      {error && <p className="text-red-600">{error}</p>}

      <div>
        <label className="block font-medium mb-1">Topic</label>
        <select
          className="border px-2 py-1 w-full"
          value={topicId}
          onChange={e => {
            setTopicId(e.target.value)
            setError(null)
          }}
        >
          <option value="">Select a topic</option>
          {topics.map(t => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block font-medium mb-1">
          Number of Questions
        </label>
        <input
          type="number"
          min={1}
          max={100}
          value={questionCount}
          onChange={e => {
            setQuestionCount(e.target.value)
            setError(null)
          }}
          className="border px-2 py-1 w-full"
        />
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={useTimer}
          onChange={e => {
            setUseTimer(e.target.checked)
            setError(null)
          }}
        />
        <label>Enable countdown timer</label>
      </div>

      <div>
        <label className="block font-medium mb-1">
          Time (minutes)
        </label>
        <input
          type="number"
          min={1}
          max={180}
          value={minutes}
          onChange={e => setMinutes(e.target.value)}
          disabled={!useTimer}
          className="border px-2 py-1 w-full disabled:bg-gray-100"
        />
      </div>

      <button
        onClick={submit}
        disabled={submitting}
        className="bg-blue-600 text-white px-4 py-2 w-full disabled:opacity-50"
      >
        {submitting ? 'Starting...' : 'Start Test'}
      </button>
    </div>
  )
}
```

### `src/tests/test.schema.ts`
```typescript
import { z } from 'zod'

export const testConfigSchema = z.object({
  topicId: z.string().uuid(),
  questionCount: z.number().int().min(1).max(100),
  useTimer: z.boolean(),
  minutes: z.number().int().min(1).max(180).optional()
})
```

---

## 7. What Needs to Be Done Next (Immediate)

### 7A. Wire up the app entry point (blank page fix)

These three files are empty and must be written before anything renders:

**`src/main.tsx`** — Mount React into `#root`, import CSS, wrap with providers.
**`src/app/providers.tsx`** — Wrap children with `AuthProvider` and `QueryClientProvider`.
**`src/app/App.tsx`** — Render `<RouterProvider router={router} />`.

### 7B. Write Login and Register pages

`Login.tsx` and `Register.tsx` are stubs (bare Supabase calls, not components). They need to become full React components with forms, state, validation, error display, and loading states. The router already expects them as default exports.

### 7C. Write Dashboard and Admin pages

Both are empty. `Dashboard.tsx` is where authenticated users land — it should render `TestConfigForm`. `Admin.tsx` is the admin panel — it should render `TopicsAdmin`. Neither needs to be complex right now, just enough to surface the existing feature components.

### 7D. Feature 5 — Test Taking Interface (next major feature)

Once the app renders and Login/Register/Dashboard/Admin work, the next feature is the test-taking page. The spec defines this in detail (view modes, question palette, elimination, mark-for-review, timer, autosave). It lives in `TestShell.tsx` and will need `useGenerateTest.ts` to call the RPC. The router will need a `/test` route added.

---

## 8. Spec Reference: Test Taking Interface (Feature 5)

When Feature 5 is being built, these are the key requirements from the spec:

**Layout:** Header (topic name, timer, view mode dropdown, submit button) → question card area → always-visible question palette at bottom.

**View modes:** "All Questions" (scrollable), "One at a Time" (prev/next nav), "Review Only" (only marked questions).

**Question card:** Shows progress ("Q5 of 25"), question text + optional image, four answer choices in the server-determined display order (`displayed_choices_order`), mark-for-review checkbox, report issue button.

**Answer choice states:** Default (white/gray border), hover (light blue), selected (blue bg/white text), eliminated (red-gray, strikethrough, not selectable). Eliminating a currently-selected choice unselects it first.

**Question palette:** Always visible. Grid of numbered buttons. Gray = unanswered, green = answered, yellow = marked for review, blue border = current. Clickable for navigation.

**Timer:** Countdown only. Color changes: yellow under 5 min, red under 1 min. If timer reaches 0, test auto-submits.

**Autosave:** Every 30 seconds, push current response state to the server.

**Tab tracking:** Count how many times the user switches away from the tab (`visibilitychange` event), stored per-question in `tab_switch_count`.

**State shape:**
```typescript
interface TestState {
  attemptId: string
  questions: Question[]
  viewMode: 'all' | 'one' | 'review'
  currentIndex: number
  responses: Map<number, Response>
  markedForReview: Set<number>
  eliminatedChoices: Map<number, string[]>  // questionId → choice letters
  timeElapsed: number
  outOfBrowserSeconds: number
  tabSwitches: Map<number, number>
}
```

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