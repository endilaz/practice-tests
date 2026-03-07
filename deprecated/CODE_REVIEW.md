# Code Review & Implementation Guide

---

## 1. Critical Issues Found

These are bugs that will break the application if not fixed before continuing.

---

### 1.1 Missing Tables — `generate_test()` Will Crash

`generate_test()` references four tables that have not been created yet:

| Table referenced in function | Status |
|---|---|
| `questions` | ❌ Not created |
| `test_attempts` | ❌ Not created |
| `attempt_questions` | ❌ Not created |
| `question_responses` | ❌ Not created |

The function was written ahead of its tables. It will throw a relation-does-not-exist error the moment it is called. These tables are the single most urgent thing to add to Supabase. Exactly what to run is in Section 2.

---

### 1.2 `displayed_choices_order` Type Mismatch

In `generate_test()`, the randomized choice order is built like this:

```sql
select array_agg(letter order by random())
from unnest(array['A','B','C','D']) as letter
```

`array_agg` produces a PostgreSQL array (`TEXT[]`), which looks like `{C,A,D,B}` in the database.

The spec and the Zod schema both expect this column to be `JSONB`, which looks like `["C","A","D","B"]`.

The frontend will later read this column and try to use it as a JSON array. A native PostgreSQL array is not the same thing and will cause a type error on the client side. When you create the `question_responses` table (Section 2), define the column as `jsonb`. Then change this line in the function to:

```sql
(
  select jsonb_agg(letter order by random())
  from unnest(array['A','B','C','D']) as letter
)
```

`jsonb_agg` produces actual JSONB. Everything downstream will then work without changes.

---

### 1.3 Broken Import in `TestConfig.tsx`

Line 460:

```typescript
import { testConfigSchema } from './testConfigSchema'
```

The file is actually `tests/test.schema.ts`, and the export is named `testConfigSchema`. The path is wrong. It should be:

```typescript
import { testConfigSchema } from './test.schema'
```

This will fail at compile time.

---

### 1.4 `useAuth` Import Will Fail

`ProtectedRoute.tsx` imports from a file that does not exist:

```typescript
import { useAuth } from './useAuth'
```

But `useAuth` is defined and exported inside `AuthProvider.tsx`. The directory listing shows `useAuth.ts` as a separate file, but no code was provided for it — all the auth logic is in `AuthProvider.tsx`.

Pick one of these two fixes. Either re-export from a `useAuth.ts` barrel file:

```typescript
// auth/useAuth.ts
export { useAuth } from './AuthProvider'
```

Or change the import in `ProtectedRoute.tsx` to point to where the function actually lives:

```typescript
import { useAuth } from './AuthProvider'
```

The first option is better. It keeps `ProtectedRoute` decoupled from knowing the internal structure of the auth module, and it matches the file tree that was already planned.

---

### 1.5 Race Condition in `AuthProvider` — Loading May Stick Forever

The session bootstrap effect does this:

```typescript
supabase.auth.getSession().then(({ data }) => {
  setUser(data.session?.user ?? null)
  setLoading(false)                     // only place loading is set to false
})

const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
  setUser(session?.user ?? null)
  // loading is never touched here
})
```

`getSession` and `onAuthStateChange` are both asynchronous. Supabase does not guarantee which one resolves first. If `onAuthStateChange` fires before `getSession` resolves (which happens regularly on page load when a session already exists), it will set `user` correctly, but `loading` will remain `true` until `getSession` also resolves.

The practical consequence: on a fast connection with an active session, everything usually works. On a slow connection or under load, the app may render the loading guard (which currently returns `null`) and appear blank for an unpredictable amount of time, or indefinitely if `getSession` somehow does not resolve.

The fix is to set `loading` to `false` in both places:

```typescript
useEffect(() => {
  let initialized = false

  supabase.auth.getSession().then(({ data }) => {
    if (!initialized) {
      setUser(data.session?.user ?? null)
      setLoading(false)
      initialized = true
    }
  })

  const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
    setUser(session?.user ?? null)
    if (!initialized) {
      setLoading(false)
      initialized = true
    }
  })

  return () => sub.subscription.unsubscribe()
}, [])
```

The `initialized` flag ensures `loading` is set to `false` exactly once, by whichever callback fires first, and prevents a second redundant state update.

---

### 1.6 Admin Can Demote Themselves

The admin update policy on `users` allows an admin to update any row, including their own, with no restriction on what the `role` value can be set to. An admin could accidentally (or intentionally) set their own role to `'user'`, locking themselves out of the admin panel permanently.

This is low urgency — it requires an admin to act against their own interest — but it is worth closing. Drop the existing policy and replace it:

```sql
drop policy "Admins can update users" on public.users;

create policy "Admins can update users"
on public.users
for update
using (
  exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.role = 'admin'
  )
)
with check (
  exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.role = 'admin'
  )
  and (
    id != auth.uid()
    or role = 'admin'
  )
);
```

The added condition means: you can update any row, but if the row is your own, the new `role` value must still be `'admin'`.

---

## 2. What Still Needs to Be Done in Supabase

Run these statements in the Supabase SQL Editor in the order shown. Each block is a single paste.

---

### 2.1 Create `questions` Table

```sql
create table public.questions (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.topics(id) on delete restrict,
  question_text text not null,
  question_image_url text,
  explanation_text text,
  explanation_image_url text,
  difficulty_level integer check (difficulty_level between 1 and 5),
  created_by_admin_id uuid not null references public.users(id) on delete restrict,
  is_flagged boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.questions enable row level security;

create policy "Questions are publicly readable"
on public.questions
for select
using (true);

create policy "Admins can manage questions"
on public.questions
for all
using (
  exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.role = 'admin'
  )
)
with check (
  exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.role = 'admin'
  )
);
```

---

### 2.2 Create `answer_choices` Table

```sql
create table public.answer_choices (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions(id) on delete cascade,
  choice_letter char(1) not null check (choice_letter in ('A', 'B', 'C', 'D')),
  choice_text text not null,
  choice_image_url text,
  is_correct boolean not null default false,
  unique (question_id, choice_letter)
);

alter table public.answer_choices enable row level security;

create policy "Answer choices are publicly readable"
on public.answer_choices
for select
using (true);

create policy "Admins can manage answer choices"
on public.answer_choices
for all
using (
  exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.role = 'admin'
  )
)
with check (
  exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.role = 'admin'
  )
);
```

---

### 2.3 Create `test_attempts` Table

Note the column names match what `generate_test()` already uses (`question_count`, `use_timer`, `minutes`), not the names in the original spec. The function was written first, so the table must match it.

```sql
create table public.test_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  topic_id uuid not null references public.topics(id) on delete restrict,
  question_count integer not null check (question_count > 0),
  use_timer boolean not null default false,
  minutes integer check (minutes > 0),
  started_at timestamptz,
  completed_at timestamptz,
  score integer,
  total_possible integer,
  total_time_seconds integer,
  out_of_browser_seconds integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.test_attempts enable row level security;

create policy "Users can read own attempts"
on public.test_attempts
for select
using (user_id = auth.uid());

create policy "Admins can read all attempts"
on public.test_attempts
for select
using (
  exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.role = 'admin'
  )
);

create policy "Users can insert own attempts"
on public.test_attempts
for insert
with check (user_id = auth.uid());

create policy "Users can update own attempts"
on public.test_attempts
for update
using (user_id = auth.uid());
```

---

### 2.4 Create `attempt_questions` Table

```sql
create table public.attempt_questions (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.test_attempts(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete restrict,
  position integer not null check (position > 0),
  unique (attempt_id, question_id),
  unique (attempt_id, position)
);

alter table public.attempt_questions enable row level security;

create policy "Users can read own attempt questions"
on public.attempt_questions
for select
using (
  exists (
    select 1 from public.test_attempts ta
    where ta.id = attempt_id and ta.user_id = auth.uid()
  )
);

create policy "Admins can read all attempt questions"
on public.attempt_questions
for select
using (
  exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.role = 'admin'
  )
);

create policy "Users can insert own attempt questions"
on public.attempt_questions
for insert
with check (
  exists (
    select 1 from public.test_attempts ta
    where ta.id = attempt_id and ta.user_id = auth.uid()
  )
);
```

---

### 2.5 Create `question_responses` Table

```sql
create table public.question_responses (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.test_attempts(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete restrict,
  selected_choice_id uuid references public.answer_choices(id) on delete restrict,
  is_correct boolean,
  time_spent_seconds integer not null default 0,
  marked_for_review boolean not null default false,
  eliminated_choices jsonb not null default '[]'::jsonb,
  displayed_choices_order jsonb not null default '[]'::jsonb,
  tab_switch_count integer not null default 0,
  answered_at timestamptz,
  unique (attempt_id, question_id)
);

alter table public.question_responses enable row level security;

create policy "Users can read own responses"
on public.question_responses
for select
using (
  exists (
    select 1 from public.test_attempts ta
    where ta.id = attempt_id and ta.user_id = auth.uid()
  )
);

create policy "Admins can read all responses"
on public.question_responses
for select
using (
  exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.role = 'admin'
  )
);

create policy "Users can insert own responses"
on public.question_responses
for insert
with check (
  exists (
    select 1 from public.test_attempts ta
    where ta.id = attempt_id and ta.user_id = auth.uid()
  )
);

create policy "Users can update own responses"
on public.question_responses
for update
using (
  exists (
    select 1 from public.test_attempts ta
    where ta.id = attempt_id and ta.user_id = auth.uid()
  )
);
```

---

### 2.6 Create `question_feedback` Table

```sql
create table public.question_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  attempt_id uuid references public.test_attempts(id) on delete set null,
  difficulty_rating integer check (difficulty_rating between 1 and 5),
  quality_rating integer check (quality_rating between 1 and 5),
  feedback_text text,
  created_at timestamptz not null default now()
);

alter table public.question_feedback enable row level security;

create policy "Users can read own feedback"
on public.question_feedback
for select
using (user_id = auth.uid());

create policy "Admins can read all feedback"
on public.question_feedback
for select
using (
  exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.role = 'admin'
  )
);

create policy "Users can insert own feedback"
on public.question_feedback
for insert
with check (user_id = auth.uid());
```

---

### 2.7 Fix `generate_test()` — Replace the Entire Function

After the tables above exist, drop and recreate `generate_test()` with the `jsonb_agg` fix:

```sql
drop function if exists public.generate_test(uuid, int, boolean, int);

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
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if p_question_count <= 0 or p_question_count > 100 then
    raise exception 'Invalid question count';
  end if;

  if p_use_timer and (p_minutes is null or p_minutes <= 0 or p_minutes > 180) then
    raise exception 'Invalid timer value';
  end if;

  if not exists (select 1 from topics where id = p_topic_id) then
    raise exception 'Topic does not exist';
  end if;

  select count(*) into v_available_count
  from questions
  where topic_id = p_topic_id;

  if v_available_count < p_question_count then
    raise exception 'Not enough questions in topic';
  end if;

  insert into test_attempts (
    user_id, topic_id, question_count, use_timer, minutes
  )
  values (
    auth.uid(),
    p_topic_id,
    p_question_count,
    p_use_timer,
    case when p_use_timer then p_minutes else null end
  )
  returning id into v_attempt_id;

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
      select jsonb_agg(letter order by random())
      from unnest(array['A','B','C','D']) as letter
    ),
    '[]'::jsonb
  from attempt_questions aq
  where aq.attempt_id = v_attempt_id;

  return v_attempt_id;
end;
$$;
```

---

### 2.8 Create the Storage Bucket

Go to **Supabase Dashboard → Storage → Buckets**, click **New Bucket**, and create one with:

- **Name:** `question-images`
- **Public:** Yes (checked)
- **File size limit:** 5 MB

Then run this in the SQL editor:

```sql
create policy "Authenticated users can upload question images"
on storage.objects
for insert
to authenticated
with check (bucket_id = 'question-images');

create policy "Admins can delete question images"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'question-images'
  and exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.role = 'admin'
  )
);
```

---

## 3. How the Files Work Together

```
main.tsx
  └── renders <App />

App.tsx
  └── wraps everything in providers (AuthProvider, QueryClientProvider)
  └── hands the route tree to <RouterProvider router={router} />

router.tsx
  ├── /login       → Login.tsx        (public)
  ├── /register    → Register.tsx     (public)
  ├── /            → Dashboard.tsx    (protected, any authenticated user)
  └── /admin       → Admin.tsx        (protected, admin only)

  Protection is handled by <ProtectedRoute>:
    └── reads useAuth()
    └── if no user       → redirect to /login
    └── if requireAdmin and role !== 'admin' → redirect to /
    └── otherwise        → render children
```

**Auth layer:**
```
AuthProvider.tsx    ← owns the session. Calls getSession() on mount, listens
                      to onAuthStateChange. When user changes, fetches role
                      from public.users. Exposes { user, role, loading }.

ProtectedRoute.tsx  ← consumes useAuth(). Acts as a gate. Returns null while
                      loading, redirects if unauthorized, renders children
                      if everything checks out.

useAuth.ts          ← should re-export useAuth() from AuthProvider so other
                      files import from a stable path.
```

**Feature: Topics (admin)**
```
TopicsAdmin.tsx     ← the full CRUD UI. Manages its own local state (topics
                      list, input values, loading/error/mutating flags).
                      Calls Supabase directly for select/insert/update/delete.

useTopics.ts        ← in the file tree but no code provided. Intended to
                      extract data-fetching logic out of TopicsAdmin.

topic.schema.ts     ← in the file tree but no code provided. Intended to
                      hold Zod validation for topic names.
```

**Feature: Tests (user)**
```
TestConfig.tsx      ← the test setup form. Loads topics, collects user input
                      (topic, question count, timer), validates with Zod,
                      then navigates to /test with params in the URL.

useGenerateTest.ts  ← in the file tree but no code provided. Intended to
                      call generate_test() via RPC.

test.schema.ts      ← Zod schema for the test config form. Validates topicId
                      (UUID string), questionCount (1-100), useTimer (bool),
                      minutes (1-180, optional).

TestShell.tsx       ← in the file tree but no code provided. Intended to be
                      the layout wrapper for the test-taking page. This is
                      where Feature 5 will live.
```

**Infrastructure:**
```
lib/supabase.ts     ← creates the single Supabase client. All feature files
                      import from here. Session persistence and auto token
                      refresh are enabled.

lib/env.ts          ← reads VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
                      from the Vite environment. These must exist in
                      .env.local or the app will crash at startup.
```

**Dependency flow (imports only go downward):**
```
lib          (supabase client, env)
 ↓
auth         (AuthProvider, ProtectedRoute, useAuth)
 ↓
features     (topics/, tests/)
 ↓
pages        (Login, Register, Dashboard, Admin)
 ↓
app          (router, providers, App)
```

**What happens when a user generates a test:**
```
1. User fills out TestConfig form
2. Zod validates the input
3. User clicks "Start Test"
4. TestConfig navigates to /test?topic=<uuid>&count=25&timer=1&minutes=30
5. Nothing is at /test yet — this is where Feature 5 goes
6. That future page will read URL params, call generate_test() via RPC,
   receive an attempt UUID, then load and render the test
```

---

## 4. Dependencies and How to Run

### 4.1 Required Packages

If you scaffolded with Vite but have not installed everything yet:

```bash
npm install react react-dom react-router-dom @supabase/supabase-js zod
npm install -D typescript @types/react @types/react-dom @vitejs/plugin-react vite
npm install -D tailwindcss @tailwindcss/vite
```

If you are using shadcn/ui (the `ui/` directory is in the tree):

```bash
npx shadcn init
npx shadcn add button input select dialog
```

React Query is in the architecture but not yet used in any provided code. Install it now so it is available for Feature 5:

```bash
npm install @tanstack/react-query
```

### 4.2 Environment Variables

Create `.env.local` in the project root (same directory as `package.json`). Do not commit this file.

```
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

Both values are on **Supabase Dashboard → Settings → API**. The URL is "Project URL". The key is in the "anon / public" row under "API Keys".

### 4.3 Path Aliases

The code uses `@/` as an import prefix. This must be configured in two places or every `@/` import will fail.

**vite.config.ts:**

```typescript
import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  }
})
```

**tsconfig.json** — add these two fields inside `compilerOptions`:

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

### 4.4 Running the App

```bash
npm run dev
```

Vite starts at `http://localhost:5173` by default. Hot reload is on automatically.

To build for production:

```bash
npm run build
```

To preview the production build locally:

```bash
npm run preview
```

---

## 5. Minor Issues Worth Noting

**`env.ts` does not validate.** The `!` operator silences TypeScript but does nothing at runtime. If `.env.local` is missing or misspelled, the error will be obscure. Replace with an explicit guard:

```typescript
function requireEnv(name: string): string {
  const value = import.meta.env[name]
  if (!value) throw new Error(`Missing environment variable: ${name}`)
  return value
}

export const env = {
  VITE_SUPABASE_URL: requireEnv('VITE_SUPABASE_URL'),
  VITE_SUPABASE_ANON_KEY: requireEnv('VITE_SUPABASE_ANON_KEY')
}
```

**`TopicsAdmin.tsx` saves on blur.** The rename fires when the input loses focus, not when the user explicitly confirms. If a user edits a name and clicks away without meaning to save, it saves anyway. An explicit Save button or Enter-key confirmation would give more control.

**`Login.tsx` and `Register.tsx` are stubs.** Only the Supabase calls were provided, not full components. They need form state, validation, error handling, and loading states before they are usable.

**Four files in the tree have no code.** `useTopics.ts`, `topic.schema.ts`, `useGenerateTest.ts`, and `TestShell.tsx` are either empty or not yet written. Nothing currently imports from them, so their absence does not cause errors today. They will need to be implemented as part of upcoming features.
