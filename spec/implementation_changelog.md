# Implementation Changelog

This document records **actual implementation work completed** in this codebase so that a new developer (or future you) can quickly understand what has been built, why it exists, and where the system is safe to extend.

This is **not** a changelog of the context specification. It reflects concrete backend and frontend work that has been implemented, reviewed, and hardened.

---

## [v0.1.0] — 2026-01-29
### Week 1 — Foundation, Auth, Admin, and Test Generation

### Summary
Week 1 establishes a production-safe foundation for authentication, authorization, admin content management, user test setup, and secure server-side test generation. All features in this release have been reviewed for correctness, security, and alignment with the original project specification.

---

## Feature 1 — Authentication, Core Tables, and RLS (COMPLETE)

### Backend (Supabase)

**Implemented**
- Email/password authentication using Supabase Auth
- Mandatory email confirmation before login
- Single Supabase project (no environments yet)
- Manual admin creation and promotion

**Database Objects**
- `public.users` table linked 1:1 with `auth.users`
- `role` column (`user`, `admin`) enforced at DB level
- Trigger to auto-create user profile on signup
- `topics` table (flat structure)

**Row Level Security (RLS)**
- Users can read/update only their own profile
- Admins can read/update all users
- Users cannot modify their own role
- Topics are publicly readable
- Topics are admin-write only

**Hardening / Fixes Applied**
- Removed any client-side role trust
- Prevented self-promotion via RLS
- Explicit `search_path` usage in triggers
- Eliminated redundant uniqueness constraints

---

## Feature 2 — Frontend App Scaffold & Authentication (COMPLETE)

### Frontend Foundation

**Implemented**
- React 18 + TypeScript + Vite scaffold
- Tailwind CSS and shadcn/ui setup
- Centralized Supabase client with session persistence

**Auth System**
- `AuthProvider` handling session bootstrap
- Role fetched from database (never from JWT)
- Loading state to prevent race conditions

**Routing**
- Protected routes for authenticated users
- Admin-only routes gated by resolved role
- No unauthorized content flash

**Hardening / Fixes Applied**
- Eliminated auth/role race conditions
- Prevented admin redirect flicker
- Graceful handling of role fetch failure

---

## Feature 3A — Admin Topics Management UI (COMPLETE)

### Admin Functionality

**Implemented**
- Admin-only Topics CRUD interface
- Create, rename, delete topics
- Immediate UI feedback on mutations

**Security Model**
- Authorization enforced by RLS (not frontend checks)
- Unauthorized access fails safely

**Hardening / Fixes Applied**
- Converted uncontrolled inputs to controlled inputs
- Normalized topic names (trim, case consistency)
- Prevented duplicate submissions
- Eliminated mutation race conditions
- Clear empty and loading states

---

## Feature 3B — User Test Configuration UI (COMPLETE)

### User Flow

**Implemented**
- Topic selection
- Question count selection
- Optional countdown timer

**Validation**
- Zod schema validation
- Bounded numeric inputs
- Disabled timer fields when unused

**UX / Stability Fixes**
- Cleared sticky error states
- Prevented invalid form submission
- Persisted configuration via URL parameters

---

## Feature 4 — Test Generation Backend (COMPLETE)

### Core Function

**Implemented**
- PostgreSQL function: `generate_test()`
- Called via Supabase RPC

**Function Guarantees**
- Authenticated-only execution
- Topic existence validation
- Question availability validation
- Randomized question selection
- Stable, deterministic question ordering
- Randomized answer choice display order
- Secure initialization of response state

**Security Hardening**
- Explicit authentication guard (`auth.uid()`)
- Strict input validation (counts, timers)
- Prevented silent partial test creation
- `SECURITY DEFINER` hardened with explicit `search_path`
- No correct answers exposed to the client

---

## Known Safe Boundaries (As of v0.1.0)

- Auth & role system is stable
- RLS rules are authoritative
- Test generation is server-trusted
- Frontend does not influence scoring or integrity

---

## Next Intended Work

**Feature 5 — Test Taking Interface**

Planned scope:
- Question rendering
- Answer selection & elimination rules
- Mark-for-review support
- Navigation modes
- Timer countdown and autosave

This changelog should be read before continuing development.

