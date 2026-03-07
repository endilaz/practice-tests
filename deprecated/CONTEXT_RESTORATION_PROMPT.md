# FBLA Practice Test Platform - Context Restoration Prompt

**Instructions:** Copy and paste this entire prompt to restore full project context with any LLM.

---

## Project Overview

I'm building an FBLA Practice Test Platform - a web application where students can take randomized practice tests and administrators can manage question banks. The complete technical specification is in `PROJECT_SPECIFICATION.md`.

## Key Architectural Decisions

### Technology Stack
- **Frontend**: React 18 + TypeScript + Vite + Tailwind CSS + shadcn/ui
- **Backend**: Supabase (PostgreSQL + Authentication + Storage + Row Level Security)
- **Hosting**: Vercel/Netlify (frontend), Supabase (backend)
- **State Management**: React Context + React Query (TanStack Query)
- **Validation**: Zod schemas with react-hook-form
- **Routing**: React Router v6

### Core Concept: Dynamic Test Generation
- Tests are NOT pre-made fixed collections of questions
- Instead: Users select a topic + number of questions → system randomly generates a unique test
- Each test attempt is a new random selection from the topic's question pool
- Benefits: Prevents cheating, enables unlimited practice, no memorization

## Database Schema (8 Core Tables)

1. **users** - Profiles and roles (admin/user)
2. **topics** - Subject areas (Accounting, Business Law, etc.) - FLAT structure, no hierarchy
3. **questions** - Individual test questions with text, images, explanations
4. **answer_choices** - Exactly 4 choices (A, B, C, D) per question, one correct
5. **test_attempts** - Generated test instances (stores: topic, # questions, timer, scores, timestamps)
6. **attempt_questions** - Junction table (which questions in which test, randomized order)
7. **question_responses** - User answers and interactions (selected choice, eliminated choices, time spent, tab switches)
8. **question_feedback** - User ratings (difficulty 1-5, quality 1-5) and feedback text (admin-only)

### Key Database Functions
- `generate_test()` - Creates attempt, randomly selects questions, randomizes order, initializes responses
- `submit_test()` - Calculates score, sets completion timestamp

### Critical Database Details
- **JSONB fields in question_responses:**
  - `eliminated_choices`: Array of choice IDs user eliminated
  - `displayed_choices_order`: Array of letters showing order choices were presented (e.g., ["C", "A", "D", "B"])
- **Row Level Security (RLS):** Users can only see their own data; admins can see all data
- **Foreign key constraints:** Questions use ON DELETE RESTRICT (prevent deletion if used in tests)

## UI Design (Based on Provided Mockup)

### Color Scheme
- **Background**: Blue (use CSS variable for theming flexibility)
- **Question cards**: White with subtle shadow
- **Text**: Black on white cards, white on blue background
- **All colors configurable** - use standard placeholders, exact shades decided later

### Test Taking Interface Layout

```
┌─────────────────────────────────────────────────────────────┐
│ Header (Blue background, white text)                        │
│ [Topic: Accounting]     [Timer: 24:35] [View ▼]  [Submit]  │
├─────────────────────────────────────────────────────────────┤
│ Content Area (Blue background)                              │
│                                                              │
│  ┌────────────────────────────────────────────────────┐    │
│  │ Q5 - Question 5 of 25              [Report Issue]  │    │
│  │                                                     │    │
│  │ What is the accounting equation?                   │    │
│  │ [Question image if present]                        │    │
│  │                                                     │    │
│  │ ┌──────────────────────────────────────────────┐  │    │
│  │ │ A. Assets = Liabilities + Equity             │  │    │
│  │ └──────────────────────────────────────────────┘  │    │
│  │ (... B, C, D choices ...)                         │    │
│  │                                                     │    │
│  │ [☐ Mark for Review]                                │    │
│  └────────────────────────────────────────────────────┘    │
│                                                              │
│  [◄ Previous]                              [Next ►]         │
│  (Only in "One at a Time" and "Review Only" modes)         │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│ Question Palette (Always visible)                           │
│ [1] [2] [3] [4] [5] ... [25]                               │
└─────────────────────────────────────────────────────────────┘
```

### View Modes (Header Dropdown)

**Three modes accessible via dropdown in header:**

1. **All Questions** (default)
   - All questions displayed vertically on one scrollable page
   - No Previous/Next buttons (use scroll)
   - Question palette allows jumping to any question

2. **One at a Time**
   - Single question displayed
   - Previous/Next buttons for navigation
   - Question palette allows jumping

3. **Review Only**
   - Shows ONLY questions marked for review
   - If no questions marked: Display message "No questions marked for review"
   - Previous/Next navigate only through marked questions
   - Question palette shows only marked questions

**Important:** Switching views preserves current position/question

### Header Components (Spread Layout)

```
[Topic Name]        [Timer] [View Dropdown]        [Submit Test]
```

- **Topic Name** (left): Non-interactive text
- **Timer** (center-left): Countdown MM:SS, changes color (<5min yellow, <1min red)
- **View Dropdown** (center-right): Select between three view modes
- **Submit Test** (right): Prominent primary button
- **Reserved space** between elements for future additions

### Question Card Details

**Progress indicator:** "Q5 - Question 5 of 25" (in card, NOT in header)

**Answer Choices:**
- Full-width clickable rows
- Letter (A, B, C, D) AND text together in same row
- Entire row is clickable

**Visual States (exact colors TBD, use placeholders):**
- **Default**: White background, light gray border
- **Hover**: Light blue tint
- **Selected**: Blue background, white text
- **Eliminated**: Light red/gray background, strikethrough text, faded opacity

**CRITICAL INTERACTION RULE:** 
- **Elimination prevents selection**
- If user eliminates a selected answer, it unselects first, then eliminates
- Eliminated choices cannot be clicked to select (only to un-eliminate)

### Two Separate Features (Not the Same)

1. **Mark for Review** 
   - Checkbox at bottom of question card
   - Purpose: Flag question to revisit later
   - Shows question in "Review Only" view mode
   - Marked questions appear yellow in palette

2. **Report Issue**
   - Button in question card header (top-right)
   - Purpose: Report problems with question (typo, wrong answer, unclear, etc.)
   - Opens modal with:
     - "What's the issue?" textarea
     - Difficulty rating (1-5 stars, optional)
     - Quality rating (1-5 stars, optional)
   - Saves to `question_feedback` table
   - Can report during test or after completion

### Question Palette

**Always visible at bottom (all view modes)**

- Grid of numbered buttons (1, 2, 3... 25)
- **Color Coding:**
  - Gray: Unanswered
  - Green: Answered (has selected choice)
  - Yellow: Marked for review
  - Blue border: Current question
  - Can combine: Yellow + Green if answered AND marked

**Behavior:**
- Click number to navigate to that question
- In "All Questions" mode: Scrolls to question
- In "One at a Time" mode: Changes current question
- In "Review Only" mode: Only shows marked question numbers

### Navigation Buttons (Previous/Next)

- **Visible in:** "One at a Time" and "Review Only" modes
- **Hidden in:** "All Questions" mode (user scrolls instead)
- **In Review Only mode:** Navigate only through marked questions

## Key Features

### Admin Features
- **Topic Management**: CRUD operations (create, read, update, delete topics)
- **Question Management**: 
  - Create via web form (topic, question text, 4 choices, correct answer, explanation, difficulty 1-5, images)
  - Bulk import from JSON file with validation and preview
  - Edit existing questions
  - Delete questions (restricted if used in tests)
- **Analytics**:
  - Question performance (% correct, avg time, answer distribution, user ratings)
  - User performance (tests taken, avg score, performance by topic, tab-switch patterns)
  - Feedback review (view user-submitted feedback text)

### User Features
- **Test Configuration**: Select topic, # of questions, optional countdown timer
- **Test Taking**: 
  - Answer selection (single choice)
  - Eliminate choices (strikethrough, prevents selection)
  - Mark for review (checkbox)
  - Report issue (feedback modal)
  - View mode switching
  - Auto-save every 30 seconds
  - Tab-switch tracking (counts but doesn't penalize)
- **Results**: 
  - Score summary (X/Y, percentage, time taken, out-of-browser time)
  - Question-by-question review with correct answers and explanations
  - Rate questions (difficulty 1-5, quality 1-5)
- **Dashboard**: Test history, performance stats by topic, charts

## Authentication & Authorization

- **Supabase Auth**: Email/password authentication, JWT tokens
- **Two roles**: 'admin' and 'user' (stored in public.users table)
- **Row Level Security (RLS)**: Database-level authorization
  - Users can only access their own test_attempts and question_responses
  - Admins can access all data
  - All users can read topics, questions, answer_choices
  - Only admins can insert/update/delete questions

## Security Rules

- **Input validation**: Zod schemas on frontend, PostgreSQL CHECK constraints on backend
- **File uploads**: Only jpg/png, max 5MB, upload to Supabase Storage
- **XSS prevention**: React escapes by default, use DOMPurify for rich text
- **SQL injection**: Prevented by Supabase parameterized queries
- **Test integrity**: 
  - Correct answers never sent to frontend during test
  - Server-side scoring (don't trust client)
  - Server-side timer validation

## Implementation Timeline

- **Week 1**: Foundation (auth, navigation, database setup) - 20-25 hours
- **Week 2**: Admin question management - 25-30 hours
- **Week 3**: Test generation & taking interface - 30-35 hours
- **Week 4**: Results & user features - 25-30 hours
- **Week 5**: Admin analytics & polish - 25-30 hours
- **Week 6**: Testing & deployment - 15-20 hours

**Total: 140-170 hours over 6 weeks**

## Key Project Principles

1. **Quality over quantity**: Robust, maintainable code prioritized over feature volume
2. **No assumptions**: Always ask for clarification if anything is unclear
3. **Focus on maintainability**: Clear, documented, modular code structure
4. **Scalability**: Architecture supports growth without major refactoring
5. **Flexibility**: Use CSS variables and configurable constants for easy customization

## What's NOT in MVP (Future Enhancements)

- PDF parsing and import (planned for post-MVP)
- Command-line import tool (planned for post-MVP)
- AI-generated explanations (planned for post-MVP)
- Hierarchical topic structure (currently flat)
- User comparison features / leaderboards
- Advanced difficulty adaptation
- Study mode / flashcard mode
- Spaced repetition

## Current Status

We have completed the comprehensive technical specification. Ready to begin Week 1 implementation (project setup, Supabase configuration, authentication).

## Development Guidelines

- **Never make assumptions** - always ask for clarification
- **Incremental development** - build and test each feature before moving to next
- **Ask for confirmation** before proceeding with major changes
- **Search for potential bugs** before committing code
- **Write clear, maintainable code** with comments where needed

---