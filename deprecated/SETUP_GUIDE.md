# Feature 5 MVP — Complete Setup Guide

Follow these steps in order. Each step is complete and tested.

---

## Step 1: Run SQL in Supabase

Open **Supabase Dashboard → SQL Editor** and paste the contents of `submit_test.sql`.

Click **Run**. You should see "Success. No rows returned."

**What this does:** Creates the `submit_test(p_attempt_id uuid)` function that scores a test and returns the result as JSON.

**Verification:** In the SQL Editor, run this query:
```sql
SELECT routine_name FROM information_schema.routines 
WHERE routine_name = 'submit_test' AND routine_schema = 'public';
```
You should see one row with `submit_test`.

---

## Step 2: Replace Frontend Files

Replace the following files in your project with the ones provided:

| Provided File | Destination in Your Project |
|---|---|
| `Login.tsx` | `src\pages\Login.tsx` |
| `useGenerateTest.ts` | `src\tests\useGenerateTest.ts` |
| `TestShell.tsx` | `src\tests\TestShell.tsx` |
| `router.tsx` | `src\app\router.tsx` |

**Important:** Four files total. Do NOT miss any — the app won't compile if you forget `router.tsx` or `useGenerateTest.ts`.

---

## Step 3: Verify Vite is Running

If `npm run dev` is still running from earlier, the app should hot-reload automatically after you save the files. You'll see the changes immediately in the browser.

If you stopped the dev server, restart it:
```bash
npm run dev
```

Open `http://localhost:5173` in your browser.

---

## Step 4: Seed Test Questions

Before you can take a test, you need questions in the database. Go to **Supabase Dashboard → SQL Editor** and run this to insert 5 sample questions:

```sql
-- First, create a test topic if you don't have one
INSERT INTO topics (id, name) 
VALUES ('00000000-0000-0000-0000-000000000001', 'Sample Topic')
ON CONFLICT (id) DO NOTHING;

-- Insert 5 questions
DO $$
DECLARE
  v_admin_id uuid;
  v_q1 uuid := gen_random_uuid();
  v_q2 uuid := gen_random_uuid();
  v_q3 uuid := gen_random_uuid();
  v_q4 uuid := gen_random_uuid();
  v_q5 uuid := gen_random_uuid();
BEGIN
  -- Get the first admin user (or your specific user ID)
  SELECT id INTO v_admin_id FROM users WHERE role = 'admin' LIMIT 1;

  -- If no admin exists, use the first user
  IF v_admin_id IS NULL THEN
    SELECT id INTO v_admin_id FROM users LIMIT 1;
  END IF;

  -- Question 1
  INSERT INTO questions (id, topic_id, question_text, created_by_admin_id)
  VALUES (v_q1, '00000000-0000-0000-0000-000000000001', 'What is 2 + 2?', v_admin_id);
  
  INSERT INTO answer_choices (question_id, choice_letter, choice_text, is_correct) VALUES
    (v_q1, 'A', '3', false),
    (v_q1, 'B', '4', true),
    (v_q1, 'C', '5', false),
    (v_q1, 'D', '6', false);

  -- Question 2
  INSERT INTO questions (id, topic_id, question_text, created_by_admin_id)
  VALUES (v_q2, '00000000-0000-0000-0000-000000000001', 'What is the capital of France?', v_admin_id);
  
  INSERT INTO answer_choices (question_id, choice_letter, choice_text, is_correct) VALUES
    (v_q2, 'A', 'London', false),
    (v_q2, 'B', 'Berlin', false),
    (v_q2, 'C', 'Paris', true),
    (v_q2, 'D', 'Madrid', false);

  -- Question 3
  INSERT INTO questions (id, topic_id, question_text, created_by_admin_id)
  VALUES (v_q3, '00000000-0000-0000-0000-000000000001', 'What is the largest planet in our solar system?', v_admin_id);
  
  INSERT INTO answer_choices (question_id, choice_letter, choice_text, is_correct) VALUES
    (v_q3, 'A', 'Earth', false),
    (v_q3, 'B', 'Mars', false),
    (v_q3, 'C', 'Jupiter', true),
    (v_q3, 'D', 'Saturn', false);

  -- Question 4
  INSERT INTO questions (id, topic_id, question_text, created_by_admin_id)
  VALUES (v_q4, '00000000-0000-0000-0000-000000000001', 'Who wrote "Romeo and Juliet"?', v_admin_id);
  
  INSERT INTO answer_choices (question_id, choice_letter, choice_text, is_correct) VALUES
    (v_q4, 'A', 'Charles Dickens', false),
    (v_q4, 'B', 'William Shakespeare', true),
    (v_q4, 'C', 'Jane Austen', false),
    (v_q4, 'D', 'Mark Twain', false);

  -- Question 5
  INSERT INTO questions (id, topic_id, question_text, created_by_admin_id)
  VALUES (v_q5, '00000000-0000-0000-0000-000000000001', 'What is the speed of light?', v_admin_id);
  
  INSERT INTO answer_choices (question_id, choice_letter, choice_text, is_correct) VALUES
    (v_q5, 'A', '299,792,458 m/s', true),
    (v_q5, 'B', '150,000,000 m/s', false),
    (v_q5, 'C', '500,000,000 m/s', false),
    (v_q5, 'D', '100,000,000 m/s', false);
END $$;
```

**Verification:** Run this query to confirm:
```sql
SELECT COUNT(*) FROM questions WHERE topic_id = '00000000-0000-0000-0000-000000000001';
```
You should see `5`.

---

## Step 5: Test the Full Flow

1. **Log in** at `http://localhost:5173/login` (if not already logged in)
2. **Dashboard** should appear with the "Start a Practice Test" form
3. **Configure test:**
   - Topic: Select "Sample Topic"
   - Number of Questions: 5
   - Enable timer: Check the box
   - Time: 2 minutes
4. **Click "Start Test"**
5. **You should see:**
   - A white question card on a blue background
   - "Question 1 of 5" at the top
   - The question text
   - Four answer choices (A, B, C, D)
   - Timer counting down in the header (2:00, 1:59, 1:58...)
   - Previous/Next buttons at the bottom
   - Submit Test button in the header
6. **Click an answer** → it should turn blue immediately
7. **Click Next** → you should see Question 2
8. **Answer a few questions**
9. **Click "Submit Test"** → confirmation dialog appears
10. **Confirm** → score screen appears showing X/5 and percentage
11. **Click "Back to Dashboard"** → returns to the home page

---

## Step 6: Verify Database State

After submitting a test, check that the data was saved correctly:

```sql
-- See your most recent test attempt
SELECT 
  id, 
  started_at, 
  completed_at, 
  score, 
  total_possible,
  total_time_seconds
FROM test_attempts 
ORDER BY created_at DESC 
LIMIT 1;
```

You should see:
- `started_at` and `completed_at` both filled in
- `score` = number you answered correctly
- `total_possible` = 5
- `total_time_seconds` = how long the test took in seconds

---

## Troubleshooting

### "Invalid test configuration" error
**Cause:** URL params are missing or malformed.  
**Fix:** Make sure you clicked "Start Test" from the Dashboard form, not by manually typing the URL.

### "Failed to load questions" error
**Cause:** Supabase can't find the foreign key relationship between `attempt_questions` and `questions`.  
**Fix:** In **Supabase Dashboard → Database → Tables**, click on `attempt_questions`, scroll to the bottom, and verify that there's a foreign key from `question_id` to `questions(id)`. If not, re-run the table creation SQL from the code review document.

### Timer doesn't appear
**Cause:** You didn't check "Enable countdown timer" when configuring the test.  
**Fix:** Start a new test and check the timer box.

### Answer choices are in alphabetical order (A, B, C, D)
**Cause:** The `displayed_choices_order` column in `question_responses` is empty or not being read correctly.  
**Fix:** Verify that `generate_test()` ran successfully and populated `displayed_choices_order` with a randomized JSON array like `["C","A","D","B"]`. Run this query:
```sql
SELECT displayed_choices_order FROM question_responses LIMIT 1;
```
It should return something like `["B","D","A","C"]`, not an empty array.

### Score is always 0/5 even when I answered correctly
**Cause:** The `is_correct` calculation in `submit_test()` is failing.  
**Fix:** Verify that `answer_choices` has exactly one row per question with `is_correct = true`. Run:
```sql
SELECT question_id, COUNT(*) 
FROM answer_choices 
WHERE is_correct = true 
GROUP BY question_id;
```
Each question should appear exactly once with a count of 1.

### "Test already submitted" error appears immediately
**Cause:** You're trying to submit the same test twice, or the test was auto-submitted by the timer and you also clicked Submit manually.  
**Fix:** This is expected behavior. The backend prevents double-submission. Start a new test.

---

## What You Can Do Now

✅ Users can take practice tests  
✅ Questions are randomized (different order each time)  
✅ Answer choices are shuffled per question  
✅ Timer counts down and auto-submits at 0:00  
✅ Score is calculated server-side  
✅ Tests are saved in the database with timestamps  

---

## What's Next (Phase 2 - Not Yet Built)

These features are defined in the spec but not in the MVP:
- View modes (All Questions / Review Only)
- Question palette (grid of numbered buttons at bottom)
- Elimination (click to cross out wrong answers)
- Mark for review (checkbox to flag questions)
- Autosave (save answers every 30 seconds)
- Tab tracking (count how many times user switches tabs)
- Report issue modal (submit feedback on questions)
- Image support (display question/choice images)
- Results review page (see which questions you got wrong, with explanations)

Let me know when you're ready to add any of these.

---

## Files Summary

**SQL (run in Supabase):**
- `submit_test.sql` — scoring function

**TypeScript (replace in your project):**
- `Login.tsx` → `src\pages\Login.tsx`
- `useGenerateTest.ts` → `src\tests\useGenerateTest.ts`
- `TestShell.tsx` → `src\tests\TestShell.tsx`
- `router.tsx` → `src\app\router.tsx`

**Total: 5 files.**
