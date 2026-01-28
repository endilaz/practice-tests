
## 2. System Architecture

### 2.1 High-Level Architecture

```
Client (Browser) → Supabase JS Client → Supabase Platform
                                         ├─ Auth Service
                                         ├─ PostgreSQL + RLS
                                         └─ Storage
```

**Data Flow:**
1. User authenticates → Supabase Auth returns JWT
2. Frontend queries database → JWT validated, RLS applied
3. Data returned only if user authorized
4. File uploads → Supabase Storage with access policies

### 2.2 Technology Stack Rationale

| Technology | Purpose | Why |
|-----------|---------|-----|
| React 18 | Frontend framework | Industry standard, hooks, large ecosystem |
| TypeScript | Type safety | Catches errors early, better maintainability |
| Vite | Build tool | Fast dev server, optimal builds |
| Tailwind CSS | Styling | Utility-first, rapid development |
| shadcn/ui | Components | Customizable, accessible, copy-paste |
| React Query | Server state | Caching, auto-refetch, optimistic updates |
| Zod | Validation | TypeScript-first schemas |
| Supabase | Backend | Auth, database, storage in one platform |

### 2.3 Project Structure

```
src/
├── components/
│   ├── ui/                    # shadcn/ui components
│   ├── layout/                # Layouts, navigation
│   └── features/              # Feature components
│       ├── auth/
│       ├── test-taking/
│       ├── questions/
│       ├── analytics/
│       └── results/
├── pages/                     # Route components
├── hooks/                     # Custom hooks
├── lib/                       # Utils, Supabase client
├── types/                     # TypeScript types
└── contexts/                  # React contexts
```

---

## 3. Database Design

### 3.1 Schema Overview

**8 Core Tables:**
1. **users** - User profiles and roles
2. **topics** - Subject areas (Accounting, Business Law, etc.)
3. **questions** - Individual test questions
4. **answer_choices** - Four choices (A-D) per question
5. **test_attempts** - Generated test instances
6. **attempt_questions** - Which questions in which test
7. **question_responses** - User answers and interactions
8. **question_feedback** - User ratings and feedback

### 3.2 Key Table Definitions

#### users
```sql
CREATE TABLE public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### topics
```sql
CREATE TABLE public.topics (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### questions
```sql
CREATE TABLE public.questions (
  id SERIAL PRIMARY KEY,
  topic_id INTEGER NOT NULL REFERENCES topics(id),
  question_text TEXT NOT NULL,
  question_image_url TEXT,
  explanation_text TEXT,
  explanation_image_url TEXT,
  difficulty_level INTEGER CHECK (difficulty_level BETWEEN 1 AND 5),
  calculated_difficulty NUMERIC(5,2),
  created_by_admin_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  is_flagged BOOLEAN DEFAULT FALSE
);
```

#### answer_choices
```sql
CREATE TABLE public.answer_choices (
  id SERIAL PRIMARY KEY,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  choice_text TEXT NOT NULL,
  choice_image_url TEXT,
  is_correct BOOLEAN NOT NULL,
  choice_letter CHAR(1) CHECK (choice_letter IN ('A','B','C','D')),
  UNIQUE(question_id, choice_letter)
);
```

#### test_attempts
```sql
CREATE TABLE public.test_attempts (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  topic_id INTEGER NOT NULL REFERENCES topics(id),
  num_questions_requested INTEGER NOT NULL,
  timer_seconds INTEGER,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  score INTEGER,
  total_possible INTEGER,
  total_time_seconds INTEGER,
  out_of_browser_seconds INTEGER DEFAULT 0
);
```

#### question_responses
```sql
CREATE TABLE public.question_responses (
  id SERIAL PRIMARY KEY,
  attempt_id INTEGER NOT NULL REFERENCES test_attempts(id),
  question_id INTEGER NOT NULL REFERENCES questions(id),
  selected_choice_id INTEGER REFERENCES answer_choices(id),
  is_correct BOOLEAN,
  time_spent_seconds INTEGER DEFAULT 0,
  marked_for_review BOOLEAN DEFAULT FALSE,
  eliminated_choices JSONB DEFAULT '[]',
  displayed_choices_order JSONB DEFAULT '[]',
  tab_switch_count INTEGER DEFAULT 0,
  UNIQUE(attempt_id, question_id)
);
```

### 3.3 Key Database Functions

#### generate_test
```sql
CREATE FUNCTION generate_test(
  p_user_id UUID,
  p_topic_id INT,
  p_num_questions INT,
  p_timer_seconds INT
) RETURNS INTEGER AS $$
DECLARE
  v_attempt_id INT;
BEGIN
  -- Create attempt
  INSERT INTO test_attempts (user_id, topic_id, num_questions_requested, timer_seconds)
  VALUES (p_user_id, p_topic_id, p_num_questions, p_timer_seconds)
  RETURNING id INTO v_attempt_id;
  
  -- Select and insert random questions
  INSERT INTO attempt_questions (attempt_id, question_id, displayed_order)
  SELECT v_attempt_id, id, ROW_NUMBER() OVER (ORDER BY RANDOM())
  FROM questions
  WHERE topic_id = p_topic_id
  ORDER BY RANDOM()
  LIMIT p_num_questions;
  
  -- Initialize responses with randomized choice order
  INSERT INTO question_responses (attempt_id, question_id, displayed_choices_order)
  SELECT v_attempt_id, question_id,
    (SELECT JSON_AGG(choice_letter ORDER BY RANDOM())
     FROM answer_choices WHERE question_id = aq.question_id)
  FROM attempt_questions aq
  WHERE attempt_id = v_attempt_id;
  
  RETURN v_attempt_id;
END;
$$ LANGUAGE plpgsql;
```

#### submit_test
```sql
CREATE FUNCTION submit_test(p_attempt_id INT) RETURNS JSON AS $$
DECLARE
  v_score INT;
  v_total INT;
BEGIN
  SELECT COUNT(*) FILTER (WHERE is_correct), COUNT(*)
  INTO v_score, v_total
  FROM question_responses
  WHERE attempt_id = p_attempt_id;
  
  UPDATE test_attempts
  SET completed_at = NOW(),
      total_time_seconds = EXTRACT(EPOCH FROM (NOW() - started_at))::INT,
      score = v_score,
      total_possible = v_total
  WHERE id = p_attempt_id;
  
  RETURN JSON_BUILD_OBJECT('score', v_score, 'total', v_total);
END;
$$ LANGUAGE plpgsql;
```

---

## 4. Test Generation Model

### 4.1 How It Works

Unlike fixed tests, this platform generates unique test instances:

1. User selects: Topic + Number of Questions + Timer
2. System randomly selects N questions from topic pool
3. Questions presented in random order
4. Answer choices shown in random order per question
5. Each attempt is a unique test instance

### 4.2 Randomization Layers

- **Layer 1:** Random question selection from pool
- **Layer 2:** Random question order (1, 2, 3...)
- **Layer 3:** Random answer choice order (A, B, C, D shuffled)

### 4.3 Benefits

- Prevents answer sharing
- Unlimited practice
- No memorization
- Easy question pool management

---

## 5. Authentication & Authorization

### 5.1 Authentication Flow

**Registration:**
```typescript
const { data, error } = await supabase.auth.signUp({
  email, password,
  options: { data: { display_name: name } }
});

// Create profile
await supabase.from('users').insert({
  id: data.user.id,
  display_name: name,
  role: 'user'
});
```

**Login:**
```typescript
const { data, error } = await supabase.auth.signInWithPassword({
  email, password
});
```

**Session Management:**
- Access token: 1 hour
- Refresh token: 7 days
- Auto-refresh handled by Supabase

### 5.2 Row Level Security

**Example Policies:**
```sql
-- Users see only their own attempts
CREATE POLICY test_attempts_select_own ON test_attempts
  FOR SELECT USING (user_id = auth.uid());

-- Admins see all attempts
CREATE POLICY test_attempts_select_admin ON test_attempts
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );
```

### 5.3 Protected Routes

```typescript
function ProtectedRoute({ allowedRoles }) {
  const { user, role } = useAuth();
  
  if (!user) return <Navigate to="/login" />;
  if (allowedRoles && !allowedRoles.includes(role)) 
    return <Navigate to="/unauthorized" />;
  
  return <Outlet />;
}
```

---

## 6. Feature Specifications

### 6.1 Topic Management (Admin)

**List Topics:** Table with name, question count, actions
**Create Topic:** Modal with name (required), description (optional)
**Edit Topic:** Same modal, pre-filled
**Delete Topic:** Only if no questions exist

### 6.2 Question Management (Admin)

**Create Question Form:**
- Topic dropdown
- Question text (required, 1-2000 chars)
- Question image upload (optional)
- Four answer choices (A-D, all required)
- Select correct answer
- Explanation text (optional)
- Difficulty level (1-5, optional)

**Validation:**
- Exactly 4 choices
- Exactly 1 correct answer
- All choices have text

**Bulk Import:**
- Upload JSON file
- Validate structure
- Preview questions
- Confirm and batch insert

### 6.3 Test Configuration

**User Selects:**
- Topic (required)
- Number of questions (required, max available)
- Timer (optional, countdown)

**Submit:** Calls `generate_test()`, navigates to test start page

### 6.4 Test Taking Interface

**Components:**
- Header: Topic, progress, timer, submit button
- Question: Number, text, image (if any)
- Choices: Full-width buttons (A-D) with states:
  - Default, hover, selected, eliminated
- Controls: Mark for review, report issue, prev/next
- Palette: Grid of question numbers, color-coded

**Features:**
- Answer selection
- Choice elimination (strikethrough)
- Mark for review (flag)
- Navigation (prev/next, palette)
- Tab tracking (count switches)
- Auto-save (every 30 sec)

**State Management:**
```typescript
interface TestState {
  attemptId: number;
  questions: Question[];
  currentIndex: number;
  responses: Map<questionId, Response>;
  timeElapsed: number;
  outOfBrowserSeconds: number;
}
```

### 6.5 Results Page

**Summary:**
- Score (X/Y, percentage)
- Time taken
- Out-of-browser time
- Stats (correct/incorrect/unanswered)

**Question Review:**
For each question:
- Question text and image
- User's answer (marked correct/incorrect)
- Correct answer shown
- Explanation displayed
- Feedback form (difficulty, quality ratings)

### 6.6 Admin Analytics

**Question Analytics:**
- Total attempts
- Correctness percentage
- Average time spent
- Times marked for review
- Answer distribution chart
- User ratings
- Feedback text (admin-only)

**User Analytics:**
- Total tests taken
- Average score
- Performance by topic
- Test history
- Tab-switch patterns

---

## 7. API Design (Supabase Client)

### 7.1 Common Patterns

**Select:**
```typescript
const { data } = await supabase
  .from('table')
  .select('*, related_table(*)');
```

**Insert:**
```typescript
const { data } = await supabase
  .from('table')
  .insert(values)
  .select()
  .single();
```

**Update:**
```typescript
await supabase
  .from('table')
  .update(values)
  .eq('id', id);
```

**Delete:**
```typescript
await supabase
  .from('table')
  .delete()
  .eq('id', id);
```

**RPC:**
```typescript
const { data } = await supabase
  .rpc('function_name', { param: value });
```

---

## 8. Frontend Implementation

### 8.1 Key Setup

**Install Dependencies:**
```bash
npm create vite@latest -- --template react-ts
npm install @supabase/supabase-js react-router-dom
npm install @tanstack/react-query react-hook-form zod
npm install tailwindcss postcss autoprefixer
```

**Supabase Client:**
```typescript
// src/lib/supabase.ts
import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);
```

### 8.2 Custom Hooks

**useAuth:**
```typescript
export function useAuth() {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) fetchRole(session.user.id);
    });

    supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) fetchRole(session.user.id);
    });
  }, []);

  const fetchRole = async (userId) => {
    const { data } = await supabase
      .from('users')
      .select('role')
      .eq('id', userId)
      .single();
    setRole(data?.role);
  };

  return { user, role };
}
```

**useTimer:**
```typescript
export function useTimer(initialSeconds, countdown = true) {
  const [seconds, setSeconds] = useState(initialSeconds);
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    if (!isRunning) return;
    const interval = setInterval(() => {
      setSeconds(prev => countdown ? prev - 1 : prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [isRunning]);

  return { seconds, isRunning, start: () => setIsRunning(true) };
}
```

---

## 9. Security Implementation

### 9.1 Input Validation

**Frontend (Zod):**
```typescript
const questionSchema = z.object({
  question_text: z.string().min(1).max(2000),
  answer_choices: z.array(z.object({
    choice_text: z.string().min(1),
    is_correct: z.boolean()
  })).length(4)
});
```

**Backend (PostgreSQL):**
```sql
ALTER TABLE questions ADD CONSTRAINT check_text_length
  CHECK (LENGTH(question_text) > 0);
```

### 9.2 File Upload Security

```typescript
const validateImage = (file) => {
  const allowedTypes = ['image/jpeg', 'image/png'];
  const maxSize = 5 * 1024 * 1024; // 5MB
  
  if (!allowedTypes.includes(file.type)) throw new Error('Invalid type');
  if (file.size > maxSize) throw new Error('File too large');
};
```

### 9.3 XSS Prevention

React escapes by default. For rich text, use DOMPurify:
```typescript
import DOMPurify from 'dompurify';
const clean = DOMPurify.sanitize(userInput);
```

---

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

## 12. Deployment Guide

### 12.1 Supabase Setup

1. Create project at app.supabase.com
2. Get URL and anon key from Settings → API
3. Run migrations in SQL Editor
4. Create storage bucket: `question-images`
5. Set bucket policies (public read, auth write)

### 12.2 Frontend Deployment (Vercel)

1. Push code to GitHub
2. Import repository in Vercel
3. Configure:
   - Framework: Vite
   - Build: `npm run build`
   - Output: `dist`
4. Add env variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
5. Deploy

### 12.3 First Admin User

```sql
-- In Supabase SQL Editor
UPDATE users SET role = 'admin' 
WHERE email = 'your-email@example.com';
```

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

## 14. Appendices

### Appendix A: JSON Import Format

```json
{
  "topic": "Accounting",
  "questions": [{
    "question_text": "What is the accounting equation?",
    "difficulty_level": 1,
    "answer_choices": [
      {"letter": "A", "text": "Assets = Liabilities + Equity", "is_correct": true},
      {"letter": "B", "text": "Assets = Liabilities - Equity", "is_correct": false},
      {"letter": "C", "text": "Assets + Liabilities = Equity", "is_correct": false},
      {"letter": "D", "text": "Assets = Revenue - Expenses", "is_correct": false}
    ],
    "explanation_text": "The fundamental equation..."
  }]
}
```

### Appendix B: Environment Variables

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### Appendix C: Git Workflow

- `main` - Production
- `develop` - Integration
- `feature/*` - Feature branches

**Commit format:**
```
type(scope): description

Examples:
feat(auth): add password reset
fix(timer): correct countdown logic
docs(readme): update setup steps
```

---

## Document Control

**Version:** 1.0  
**Last Updated:** January 28, 2026  
**Status:** Ready for Development

**Change Log:**
- v1.0 (2026-01-28): Initial comprehensive specification

**Contact:** Development team or project repository issues

---

**END OF SPECIFICATION**
