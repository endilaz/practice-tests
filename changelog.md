## Feature 1: Supabase set up

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'user'
    check (role in ('user', 'admin')),
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.users (id, email, role)
  values (new.id, new.email, 'user');
  return new;
end;
$$ language plpgsql security definer;

alter function public.handle_new_user() owner to postgres;

create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

alter table public.users enable row level security;

create policy "Users can read own profile"
on public.users
for select
using (auth.uid() = id);

create policy "Users can update own profile"
on public.users
for update
using (auth.uid() = id)
with check (auth.uid() = id);

create policy "Admins can read all users"
on public.users
for select
using (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role = 'admin'
  )
);

create policy "Admins can update users"
on public.users
for update
using (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role = 'admin'
  )
)
with check (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role = 'admin'
  )
);

create table public.topics (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

alter table public.topics enable row level security;

create policy "Topics are publicly readable"
on public.topics
for select
using (true);

create policy "Admins can manage topics"
on public.topics
for all
using (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role = 'admin'
  )
)
with check (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role = 'admin'
  )
);

### test attempt generation
create or replace function public.generate_test(
  p_topic_id uuid,
  p_question_count int,
  p_use_timer boolean,
  p_minutes int
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempt_id uuid;
  v_available_count int;
begin
  -- 1. Authentication guard
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  -- 2. Input validation
  if p_question_count <= 0 or p_question_count > 100 then
    raise exception 'Invalid question count';
  end if;

  if p_use_timer and (p_minutes is null or p_minutes <= 0 or p_minutes > 180) then
    raise exception 'Invalid timer value';
  end if;

  -- 3. Topic validation
  if not exists (
    select 1 from topics where id = p_topic_id
  ) then
    raise exception 'Topic does not exist';
  end if;

  -- 4. Ensure enough questions exist
  select count(*) into v_available_count
  from questions
  where topic_id = p_topic_id;

  if v_available_count < p_question_count then
    raise exception 'Not enough questions in topic';
  end if;

  -- 5. Create test attempt
  insert into test_attempts (
    user_id,
    topic_id,
    question_count,
    use_timer,
    minutes
  )
  values (
    auth.uid(),
    p_topic_id,
    p_question_count,
    p_use_timer,
    case when p_use_timer then p_minutes else null end
  )
  returning id into v_attempt_id;

  -- 6. Insert randomized questions with stable ordering
  insert into attempt_questions (attempt_id, question_id, position)
  select
    v_attempt_id,
    q.id,
    row_number() over (order by q.rand)
  from (
    select id, random() as rand
    from questions
    where topic_id = p_topic_id
    order by rand
    limit p_question_count
  ) q;

  -- 7. Initialize responses with randomized answer order
  insert into question_responses (
    attempt_id,
    question_id,
    displayed_choices_order,
    eliminated_choices
  )
  select
    v_attempt_id,
    aq.question_id,
    (
      select array_agg(letter order by random())
      from unnest(array['A','B','C','D']) as letter
    ),
    '[]'::jsonb
  from attempt_questions aq
  where aq.attempt_id = v_attempt_id;

  return v_attempt_id;
end;
$$;


## Topic hierarchy
src/
├── app/                        # App-level wiring (NO business logic)
│   ├── App.tsx                 # Root app shell
│   ├── router.tsx              # Route definitions
│   └── providers.tsx           # Global providers (Auth, Query, etc.)
│
├── auth/                       # Authentication & authorization
│   ├── AuthProvider.tsx        # Session + role resolution
│   ├── ProtectedRoute.tsx      # Route guards (user/admin)
│   └── useAuth.ts              # Auth context hook
│
├── pages/                      # Route-level pages (composition only)
│   ├── Login.tsx
│   ├── Register.tsx
│   ├── Dashboard.tsx
│   └── Admin.tsx               # Admin landing page
│
├── topics/                     # FEATURE: Topics (Feature 3A)
│   ├── TopicsAdmin.tsx         # Admin CRUD UI
│   ├── useTopics.ts            # Data fetching + mutations
│   └── topic.schema.ts         # Zod schema + types
│
├── tests/                      # FEATURE: Tests (Features 3B–5)
│   ├── TestConfig.tsx          # User test setup UI (Feature 3B)
│   ├── useGenerateTest.ts      # RPC call to generate_test()
│   ├── TestShell.tsx           # Layout wrapper for test-taking
│   └── test.schema.ts          # Shared test-related types
│
├── lib/                        # Infrastructure & external services
│   ├── supabase.ts             # Supabase client
│   └── env.ts                  # Environment validation
│
├── ui/                         # shadcn/ui components (pure UI)
│   └── (button, input, dialog, etc.)
│
├── index.css
└── main.tsx

How These Pieces Relate (Dependency Graph)

This is the direction dependencies are allowed to flow:

lib
 ↓
auth
 ↓
features (topics, tests)
 ↓
pages
 ↓
app

🚫 Forbidden

auth importing from topics

lib importing from pages

ui knowing about Supabase or auth

This keeps the system testable, auditable, and refactor-safe.

🔗 Key Relationships Explained
🔐 Auth → Everything

AuthProvider lives at the app root

useAuth() is consumed by:

ProtectedRoute

Admin pages

Feature UIs (read-only)

Auth never knows about features.

## code
### app/router.tsx
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

### auth/AuthProvider.tsx
import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

type Role = 'user' | 'admin'

type AuthContextValue = {
  user: any | null
  role: Role | null
  loading: boolean
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<any | null>(null)
  const [role, setRole] = useState<Role | null>(null)
  const [loading, setLoading] = useState(true)

  // Session bootstrap
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null)
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null)
      }
    )

    return () => sub.subscription.unsubscribe()
  }, [])

  // Role fetch
  useEffect(() => {
    if (!user) {
      setRole(null)
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
          setRole(data.role)
        }
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

### auth/ProtectedRoute.tsx
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
    return null // replace with spinner later
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  if (requireAdmin && role !== 'admin') {
    return <Navigate to="/" replace />
  }

  return children
}

### lib/env.ts
export const env = {
  VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL!,
  VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY!
}

### lib/supabase.ts
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

### pages/Login.tsx (may be implemented incorrectly)
await supabase.auth.signInWithPassword({ email, password })

### pages/Register.tsx (may be implemented incorrectly)
await supabase.auth.signUp({
  email,
  password,
  options: {
    emailRedirectTo: window.location.origin
  }
})

### tests/test.schema.ts
import { z } from 'zod'

export const testConfigSchema = z.object({
  topicId: z.string().uuid(),
  questionCount: z.number().int().min(1).max(100),
  useTimer: z.boolean(),
  minutes: z.number().int().min(1).max(180).optional()
})

### tests/TestConfig.tsx
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useNavigate } from 'react-router-dom'
import { testConfigSchema } from './testConfigSchema'

type Topic = {
  id: string
  name: string
}

export function TestConfigForm() {
  const [topics, setTopics] = useState<Topic[]>([])
  const [topicId, setTopicId] = useState('')
  const [questionCount, setQuestionCount] = useState(25)
  const [useTimer, setUseTimer] = useState(false)
  const [minutes, setMinutes] = useState(30)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

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
    setError(null)

    const parsed = testConfigSchema.safeParse({
      topicId,
      questionCount,
      useTimer,
      minutes: useTimer ? minutes : undefined
    })

    if (!parsed.success) {
      setError('Invalid test configuration.')
      return
    }

    const params = new URLSearchParams({
      topic: topicId,
      count: String(questionCount),
      timer: useTimer ? '1' : '0',
      minutes: useTimer ? String(minutes) : '0'
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
            setQuestionCount(Number(e.target.value) || 1)
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
          onChange={e => setMinutes(Number(e.target.value) || 1)}
          disabled={!useTimer}
          className="border px-2 py-1 w-full disabled:bg-gray-100"
        />
      </div>

      <button
        onClick={submit}
        className="bg-blue-600 text-white px-4 py-2 w-full"
      >
        Start Test
      </button>
    </div>
  )
}

### topics/TopicsAdmin.tsx
import { useEffect, useState } from 'react'
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
      setNewTopic('')
    }

    setMutating(false)
  }

  async function renameTopic(id: string, name: string) {
    const trimmed = name.trim()
    if (!trimmed || mutating) return

    setMutating(true)
    setError(null)

    const { error } = await supabase
      .from('topics')
      .update({ name: trimmed })
      .eq('id', id)

    if (error) {
      setError(error.message)
    } else {
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
