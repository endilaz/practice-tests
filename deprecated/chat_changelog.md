# Changelog

All notable changes to the FBLA Practice Test Platform project are documented here.

---

## Week 1 — Foundation & Core Infrastructure

### Feature 1 — Supabase Auth, Core Tables, and RLS

**Added**
- Supabase email/password authentication with mandatory email confirmation
- `public.users` table linked 1:1 with `auth.users`
- Role system (`user`, `admin`) enforced at the database level
- Automatic user profile creation trigger on signup
- `topics` table with flat structure

**Security / Integrity**
- Full Row Level Security (RLS) on `users` and `topics`
- Users can only read/update their own profile
- Admin-only role updates
- Topics are publicly readable but admin-write only
- Protection against role escalation and unauthorized writes

**Fixes / Refinements**
- Corrected RLS update policy to prevent self-promotion
- Removed redundant email uniqueness constraint in `public.users`
- Added explicit `search_path` and stable function ownership for triggers

---

### Feature 2 — Frontend App Scaffold & Authentication

**Added**
- React 18 + TypeScript + Vite frontend scaffold
- Tailwind CSS and shadcn/ui setup
- Supabase client with session persistence
- AuthProvider for session and role resolution
- Login and registration pages
- Protected routing for user and admin access

**Security / Integrity**
- No client-side role trust
- Role fetched exclusively from database
- Admin routes gated both client-side and by RLS

**Fixes / Refinements**
- Eliminated race conditions between session and role loading
- Prevented admin redirect flicker
- Added error handling for role fetch failures

---

### Feature 3A — Admin Topics Management UI

**Added**
- Admin-only Topics CRUD interface
- Create, rename, and delete topics
- Inline editing with immediate feedback

**Security / Integrity**
- Fully RLS-backed authorization
- Unauthorized access handled gracefully

**Fixes / Refinements**
- Converted uncontrolled inputs to controlled inputs
- Normalized topic names on create/update
- Prevented duplicate submissions and race conditions
- Added mutation locks and clear empty states

---

### Feature 3B — User Test Configuration UI

**Added**
- User-facing test setup form
- Topic selection
- Question count selection
- Optional countdown timer

**Fixes / Refinements**
- Introduced Zod schema validation
- Normalized and bounded numeric inputs
- Disabled timer inputs when not in use
- Cleared sticky error states
- Persisted configuration via URL parameters

---

### Feature 4 — Test Generation Backend

**Added**
- Secure `generate_test()` PostgreSQL function
- Server-side test attempt creation
- Randomized question selection per topic
- Stable question ordering
- Randomized answer choice display order
- Response initialization without answer leakage

**Security / Integrity**
- Authentication enforcement inside function
- Strict input validation (counts, timers, topic existence)
- Guaranteed question availability checks
- `SECURITY DEFINER` hardened with explicit `search_path`

**Fixes / Refinements**
- Prevented unauthenticated or malformed test generation
- Eliminated silent partial test creation
- Ensured timer consistency

---

## Status

- Week 1 objectives fully complete and locked
- Core backend and frontend foundations are production-safe
- Ready to proceed to Feature 5: Test Taking Interface

