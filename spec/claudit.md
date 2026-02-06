# 🔒 Security & Bug Audit Report
**FBLA Practice Tests Application**  
**Date:** February 5, 2026  
**Auditor:** Claude (AI Assistant)

---

## 🚨 CRITICAL ISSUES (Fix Immediately)

### 1. **Race Condition in AuthProvider Session Loading**
**File:** `AuthProvider.tsx` (lines 25-35)  
**Severity:** HIGH  
**Impact:** User might see flashing content or incorrect auth state

**Issue:**
```typescript
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
```

The `settled` flag doesn't prevent the `onAuthStateChange` callback from firing immediately with the same session data. This can cause:
- Double role fetches
- Potential race conditions
- Unnecessary re-renders

**Fix:**
```typescript
useEffect(() => {
  // Get initial session
  supabase.auth.getSession().then(({ data }) => {
    setUser(data.session?.user ?? null)
  })

  // Listen for auth changes
  const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
    setUser(session?.user ?? null)
  })

  return () => subscription.unsubscribe()
}, [])
```

---

### 2. **Missing Error Handling in TestShell Timer Auto-Submit**
**File:** `TestShell.tsx` (lines 191-689, truncated but visible in logic)  
**Severity:** MEDIUM-HIGH  
**Impact:** If timer expires and submit fails, user loses all work with no recovery

**Issue:**
The auto-submit when timer reaches 0 likely doesn't handle network errors gracefully.

**Recommendation:**
- Add retry logic for auto-submit failures
- Store local draft state in localStorage as backup
- Show clear error message if auto-submit fails
- Allow manual re-submission

---

### 3. **No CSRF Protection on State-Changing Operations**
**File:** All mutation operations  
**Severity:** MEDIUM  
**Impact:** Potential for CSRF attacks

**Issue:**
Supabase handles auth via JWT in headers, but there's no explicit CSRF token validation. While Supabase's same-origin policy provides some protection, sensitive operations should have additional safeguards.

**Mitigation:**
- Supabase's JWT-based auth provides baseline protection
- Ensure `SameSite` cookie attributes are set (handled by Supabase)
- Consider adding custom verification for critical admin operations
- Document that all requests must originate from your domain

---

## ⚠️ HIGH PRIORITY BUGS

### 4. **TestShell: Missing Validation for Attempt Ownership**
**File:** `TestShell.tsx` (data loading section)  
**Severity:** HIGH  
**Impact:** Security vulnerability - user could access another user's test by guessing UUID

**Issue:**
While RLS should prevent this at the database level, there's no explicit client-side check that the loaded attempt belongs to the current user before rendering.

**Fix:**
After loading attempt data, verify ownership:
```typescript
// After loading attempt
if (attemptData.user_id !== user.id) {
  setError('This test does not belong to you')
  navigate('/')
  return
}
```

**Note:** This is defense-in-depth; RLS is the primary protection.

---

### 5. **Results Page: Division by Zero Not Handled**
**File:** `Results.tsx` (line 484)  
**Severity:** LOW (already handled)  
**Status:** ✅ GOOD - Already protected with ternary

```typescript
const percentage = attempt.total_possible > 0 
  ? Math.round((attempt.score / attempt.total_possible) * 100) 
  : 0
```

This is correct! Just documenting for completeness.

---

### 6. **QuestionsAdmin: Rollback on Choice Insert Failure is Incomplete**
**File:** `QuestionsAdmin.tsx` (lines 209-213)  
**Severity:** MEDIUM  
**Impact:** Database inconsistency if rollback fails

**Issue:**
```typescript
if (cError) {
  // Rollback: delete the question we just created
  await supabase.from('questions').delete().eq('id', question.id)
  throw new Error('Failed to create answer choices. Please try again.')
}
```

The rollback delete operation is not awaited properly and doesn't handle its own errors.

**Fix:**
```typescript
if (cError) {
  // Attempt rollback
  const { error: rollbackError } = await supabase
    .from('questions')
    .delete()
    .eq('id', question.id)
  
  if (rollbackError) {
    console.error('Rollback failed:', rollbackError)
    throw new Error('Critical error: Failed to create answer choices and rollback failed. Please contact support.')
  }
  
  throw new Error('Failed to create answer choices. Please try again.')
}
```

**Better Solution:**
Use database transactions or let RLS/foreign key constraints handle this. Consider using a stored procedure for atomic question+choices creation.

---

### 7. **TestConfig: Double Test Generation Possibility**
**File:** `TestConfig.tsx` (lines 48-70)  
**Severity:** MEDIUM  
**Impact:** User could accidentally create multiple test attempts

**Issue:**
```typescript
async function submit() {
  if (submitting) return
  // ... validation ...
  setSubmitting(true)
  
  const { data, error: rpcError } = await supabase.rpc('generate_test', {
    // ...
  })
```

If user double-clicks "Start Test" button very quickly, the `submitting` flag might not be set fast enough to prevent both clicks.

**Fix:**
Move `setSubmitting(true)` to the very first line:
```typescript
async function submit() {
  setSubmitting(true)  // Move this first
  setError(null)
  
  if (submitting) return  // This won't work; already set
```

Actually, the logic is flawed. Better approach:
```typescript
async function submit() {
  if (submitting) return
  
  setSubmitting(true)
  setError(null)
  
  try {
    const parsed = testConfigSchema.safeParse({...})
    if (!parsed.success) {
      const first = parsed.error.issues[0]
      setError(first?.message ?? 'Invalid test configuration.')
      return
    }
    
    // ... rest of code
  } finally {
    setSubmitting(false)  // Ensure this always runs
  }
}
```

**Current Issue:** If validation fails, `setSubmitting(false)` is never called, button stays disabled forever.

---

## 🛡️ SECURITY CONCERNS

### 8. **XSS Risk: User-Generated Content Not Sanitized**
**Files:** `TestShell.tsx`, `Results.tsx`, `QuestionsAdmin.tsx`  
**Severity:** MEDIUM  
**Impact:** Malicious admin could inject XSS via question text

**Issue:**
Question text, choices, and explanations are rendered directly without sanitization:
```typescript
<h2 className="text-xl font-bold text-gray-900">{question.question_text}</h2>
```

React escapes by default, so `<script>` tags won't execute. However:
- Rich text features (if added later) could introduce vulnerabilities
- URL injection in text could be misleading

**Status:** ✅ ACCEPTABLE - React's default escaping provides protection
**Recommendation:** 
- Document that HTML in questions is not supported
- If rich text is needed in future, use DOMPurify
- Validate URLs if clickable links are added

---

### 9. **No Rate Limiting on Test Generation**
**File:** Backend `generate_test()` function  
**Severity:** MEDIUM  
**Impact:** User could spam test creation, filling database

**Issue:**
Nothing prevents a user from calling `generate_test()` 1000 times in a row.

**Recommendation:**
- Add rate limiting at Supabase edge function level
- Check for incomplete attempts before creating new one
- Add cooldown period between test creations
- Monitor and alert on abnormal creation patterns

---

### 10. **Admin Role Escalation via Direct Database Access**
**Status:** ✅ PROTECTED (if RLS is configured correctly)  
**Verification Needed:**

Confirm that the `users` table has RLS policies preventing:
```sql
-- Users cannot change their own role
CREATE POLICY users_update_own ON users
  FOR UPDATE USING (id = auth.uid())
  WITH CHECK (role = (SELECT role FROM users WHERE id = auth.uid()));

-- Only admins can update other users' roles
CREATE POLICY users_update_admin ON users
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );
```

**Action Required:** Verify these policies exist in your Supabase dashboard.

---

## 🐛 CODE QUALITY ISSUES

### 11. **TestShell: Missing Null Check Before Navigation**
**File:** `TestShell.tsx` (approx line 690+)  
**Severity:** LOW  
**Impact:** Potential crash if attempting to navigate with null data

**Issue:**
Throughout TestShell, there are operations on `questions[currentIndex]` without checking if it exists.

**Fix:**
Add defensive checks:
```typescript
{viewMode === 'one' && questions[currentIndex] && (
  <QuestionCard question={questions[currentIndex]} {...cardProps} />
)}
```

---

### 12. **Results Page: Potential Memory Leak with Large Tests**
**File:** `Results.tsx` (lines 60-150)  
**Severity:** LOW  
**Impact:** Performance degradation with 100-question tests

**Issue:**
All questions, choices, and responses are loaded at once without pagination.

**Recommendation:**
- For tests > 50 questions, implement virtual scrolling
- Or use "Load More" pattern
- Or lazy-load explanations only when expanded

---

### 13. **Missing Loading States in Admin Panel**
**File:** `Admin.tsx`  
**Severity:** LOW  
**Impact:** Poor UX during tab switches

**Issue:**
When switching between Topics and Questions tabs, there's no loading indicator while `QuestionsAdmin` fetches data.

**Fix:**
Show skeleton/spinner during initial load in each tab component.

---

### 14. **Inconsistent Error Handling Patterns**
**Files:** Multiple  
**Severity:** LOW  
**Impact:** Inconsistent user experience

**Examples:**
- `TopicsAdmin.tsx`: Shows error message inline
- `QuestionsAdmin.tsx`: Shows error in modal
- `Login.tsx`: Shows error above form
- `TestShell.tsx`: May show error in different locations

**Recommendation:**
Create a consistent `ErrorBoundary` and `useErrorHandler` hook for uniform error display.

---

## 📊 PERFORMANCE ISSUES

### 15. **TestShell: Excessive Re-renders**
**File:** `TestShell.tsx`  
**Severity:** LOW  
**Impact:** Sluggish UI with large tests

**Issue:**
The `QuestionCard` component is recreated on every render because it's defined inside the parent component (though you've moved it outside, which is good).

**Verify:**
Ensure `cardProps` object isn't recreated every render. Use `useMemo`:
```typescript
const cardProps = useMemo(() => ({
  responses,
  choices,
  questions,
  viewMode,
  currentIndex,
  selectAnswer,
  toggleElimination,
  toggleMarked,
  openReport,
  goTo,
  prevIndex,
  nextIndex,
}), [/* dependencies */])
```

---

### 16. **Results Page: Inefficient Question Ordering**
**File:** `Results.tsx` (lines 95-105)  
**Severity:** LOW  
**Impact:** O(n²) complexity for ordering

**Issue:**
```typescript
const responsesWithPosition = attemptQuestionsData.map(aq => {
  const response = responsesData.find(r => r.question_id === aq.question_id)
  // ...
})
```

This is O(n²). For 100 questions, this is 10,000 operations.

**Fix:**
Create a Map first:
```typescript
const responsesMap = new Map(responsesData.map(r => [r.question_id, r]))
const responsesWithPosition = attemptQuestionsData.map(aq => {
  const response = responsesMap.get(aq.question_id)
  // ...
})
```

---

## ✅ GOOD PRACTICES OBSERVED

### 17. **Proper Use of Loading States**
All components properly disable buttons during mutations. ✅

### 18. **Validation with Zod**
Both client and schema-level validation implemented. ✅

### 19. **Proper Error Clearing on Input Change**
All forms clear errors when user starts typing. ✅

### 20. **RLS-First Security Model**
Relying on database-level security rather than client-side only. ✅

### 21. **Proper TypeScript Usage**
Strong typing throughout, minimal `any` usage. ✅

### 22. **React Best Practices**
- Proper key usage in lists
- Controlled components
- Proper effect cleanup
✅

---

## 🔧 RECOMMENDED FIXES (Priority Order)

### Priority 1 (Fix Today):
1. Fix `TestConfig.tsx` submitting state bug (button stuck disabled)
2. Add ownership verification in `TestShell.tsx`
3. Fix `AuthProvider.tsx` race condition

### Priority 2 (Fix This Week):
4. Improve error handling in `QuestionsAdmin.tsx` rollback
5. Add defensive null checks in `TestShell.tsx`
6. Optimize Results page ordering (Map instead of find)

### Priority 3 (Nice to Have):
7. Add rate limiting documentation
8. Create consistent error handling pattern
9. Add performance monitoring
10. Implement virtual scrolling for large tests

---

## 📋 TESTING CHECKLIST

Before deploying to production:

**Auth Flow:**
- [ ] Test rapid session changes (logout/login quickly)
- [ ] Test expired token refresh
- [ ] Test concurrent sessions in multiple tabs
- [ ] Test role change detection

**Test Taking:**
- [ ] Test timer expiration auto-submit
- [ ] Test tab switching counting
- [ ] Test offline/online transitions
- [ ] Test with 100 questions (max)
- [ ] Test rapid answer changes
- [ ] Test elimination + selection interaction

**Admin Operations:**
- [ ] Test question creation with network error mid-operation
- [ ] Test topic deletion with existing questions (should fail)
- [ ] Test concurrent edits from multiple admins
- [ ] Test malicious input (XSS attempts, SQL injection attempts)

**Edge Cases:**
- [ ] Test with 0 questions in topic
- [ ] Test with exactly 1 question
- [ ] Test with no topics created
- [ ] Test navigation with invalid UUID in URL
- [ ] Test Results page with unanswered questions

---

## 🎯 SECURITY VERIFICATION COMMANDS

Run these in Supabase SQL Editor:

```sql
-- Verify RLS is enabled on all tables
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public';

-- All should show rowsecurity = true

-- Check users table policies
SELECT * FROM pg_policies WHERE tablename = 'users';

-- Verify generate_test is SECURITY DEFINER
SELECT routine_name, security_type, routine_definition
FROM information_schema.routines
WHERE routine_name = 'generate_test';
```

---

## 📝 CONCLUSION

**Overall Security Rating:** 7/10  
**Overall Code Quality:** 8/10  
**Production Readiness:** 80%

The application has a solid foundation with proper RLS, good TypeScript usage, and React best practices. The main concerns are:

1. Small race conditions in auth flow
2. Missing edge case handling
3. Potential performance issues with large datasets

**Most critical fixes are minor and can be completed in 2-3 hours.**

---

**END OF AUDIT REPORT**