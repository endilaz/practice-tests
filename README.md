
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