# FBLA Practice Test Platform — Updated Context Restoration Prompt

**Last Updated:** After completion of Features 1–4

---

## Project Overview

The FBLA Practice Test Platform is a web application where students take randomized practice tests and administrators manage question banks. The system emphasizes test integrity, scalability, and maintainability.

---

## Technology Stack

- **Frontend:** React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui
- **Backend:** Supabase (PostgreSQL, Auth, Storage, Row Level Security)
- **Routing:** React Router v6
- **State Management:** React Context + TanStack Query
- **Validation:** Zod + react-hook-form
- **Hosting:** Vercel/Netlify (frontend), Supabase (backend)

---

## Core Architecture Principles

1. Dynamic test generation (no static tests)
2. Server-side integrity enforcement
3. RLS-first security model
4. No trust in client-side role or scoring logic
5. Incremental, feature-isolated development

---

## Database Schema (Implemented & Planned)

### Implemented

- **users** — Profile and role storage (`user`, `admin`)
- **topics** — Flat list of subject areas
- **test_attempts** — Test metadata (topic, timer, timestamps)
- **attempt_questions** — Questions included in each attempt
- **question_responses** — Per-question user interaction state

### Planned / Next

- **questions**
- **answer_choices**
- **question_feedback**

---

## Authentication & Authorization (IMPLEMENTED)

- Open user signup
- Email/password authentication
- Email confirmation required
- Manual admin promotion

### RLS Rules

- Users may read/update only their own profile
- Admins may read/update all users
- Topics are publicly readable
- Topics are admin-write only
- All test data is user-scoped

---

## Frontend Foundation (IMPLEMENTED)

- AuthProvider for session and role resolution
- Protected routing for user and admin pages
- Stable layout shell prepared for test UI

---

## Admin Features (IMPLEMENTED)

### Topic Management

- Create, rename, delete topics
- Fully RLS-backed
- Controlled inputs and race-condition-safe UI

---

## User Features (IMPLEMENTED)

### Test Configuration

- Topic selection
- Question count selection
- Optional countdown timer
- Zod-validated inputs
- Configuration persisted via URL parameters

---

## Test Generation (IMPLEMENTED)

### `generate_test()` PostgreSQL Function

- Authenticated-only execution
- Strict input validation
- Guaranteed question availability
- Randomized question selection and order
- Randomized answer choice display order
- Secure initialization of test state

Correct answers are never exposed to the frontend during test-taking.

---

## Implementation Status

- **Week 1:** Complete and locked
- **Features 1–4:** Implemented, reviewed, and corrected

---

## Next Feature

**Feature 5 — Test Taking Interface**

- Question rendering
- Answer selection & elimination rules
- Mark for review
- View modes (All / One-at-a-Time / Review Only)
- Timer and autosave

---

## Development Rules

- Implement one feature at a time
- Review and harden before proceeding
- Ask for clarification only when necessary
- Prioritize correctness and security over speed

---

This document can be used to restore full, up-to-date project context in a new LLM session.

