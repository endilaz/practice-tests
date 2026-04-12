/**
 * ResetPassword.tsx
 *
 * Public page that handles the magic link redirect from Supabase's password
 * reset email. Supabase embeds a one-time token in the URL hash; the
 * Supabase JS client automatically exchanges it for a short-lived session
 * via onAuthStateChange (PASSWORD_RECOVERY event).
 *
 * Flow:
 *   1. User clicks email link → redirected here with token in URL hash.
 *   2. Supabase client fires PASSWORD_RECOVERY event → we flag the session.
 *   3. User enters + confirms new password → supabase.auth.updateUser().
 *   4. On success, session is cleared and user is sent to /login.
 *
 * Security notes:
 *   - The token is single-use and expires (Supabase default: 1 hour).
 *   - We call signOut() after the update so the recovery session doesn't
 *     persist as a normal login session — the user must log in fresh.
 *   - Password length enforced client-side (≥8 chars) as a UX guard;
 *     Supabase enforces its own minimum server-side.
 */

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'

// Minimum password length — keep in sync with Supabase Auth settings.
const MIN_PASSWORD_LENGTH = 8

type PageState = 'waiting' | 'ready' | 'success' | 'invalid'

export default function ResetPassword() {
  const [pageState, setPageState] = useState<PageState>('waiting')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    // Supabase fires PASSWORD_RECOVERY when it detects a recovery token in
    // the URL hash. We must listen before the hash is consumed.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event) => {
        if (event === 'PASSWORD_RECOVERY') {
          setPageState('ready')
        }
      }
    )

    // If no PASSWORD_RECOVERY event fires within 3 seconds, the token is
    // absent or already consumed — show the invalid/expired message.
    const timeout = setTimeout(() => {
      setPageState(prev => prev === 'waiting' ? 'invalid' : prev)
    }, 3000)

    return () => {
      subscription.unsubscribe()
      clearTimeout(timeout)
    }
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (loading) return
    setError(null)

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
      return
    }

    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)

    const { error: updateError } = await supabase.auth.updateUser({ password })

    if (updateError) {
      setError(updateError.message)
      setLoading(false)
      return
    }

    // Sign out to discard the recovery session. The user must log in fresh
    // with their new password — this prevents the recovery token from acting
    // as a persistent login.
    await supabase.auth.signOut()

    setPageState('success')
    setLoading(false)
  }

  // ── Render states ──────────────────────────────────────────────────────────

  if (pageState === 'waiting') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-full max-w-sm bg-white p-8 rounded shadow text-center">
          <p className="text-gray-600 text-sm">Verifying reset link…</p>
        </div>
      </div>
    )
  }

  if (pageState === 'invalid') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-full max-w-sm bg-white p-8 rounded shadow text-center space-y-4">
          <h1 className="text-2xl font-bold">Link Expired</h1>
          <p className="text-gray-600 text-sm">
            This password reset link is invalid or has already been used.
            Request a new one from the login page.
          </p>
          <button
            onClick={() => navigate('/forgot-password')}
            className="bg-blue-600 text-white px-4 py-2 w-full rounded"
          >
            Request New Link
          </button>
        </div>
      </div>
    )
  }

  if (pageState === 'success') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-full max-w-sm bg-white p-8 rounded shadow text-center space-y-4">
          <h1 className="text-2xl font-bold">Password Updated</h1>
          <p className="text-gray-600 text-sm">
            Your password has been changed. You can now log in with your new
            password.
          </p>
          <button
            onClick={() => navigate('/login')}
            className="bg-blue-600 text-white px-4 py-2 w-full rounded"
          >
            Go to Login
          </button>
        </div>
      </div>
    )
  }

  // pageState === 'ready'
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm bg-white p-8 rounded shadow space-y-4">
        <h1 className="text-2xl font-bold text-center">Set New Password</h1>

        {error && <p className="text-red-600 text-sm">{error}</p>}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">New Password</label>
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={e => { setPassword(e.target.value); setError(null) }}
              className="border px-2 py-1 w-full rounded"
              required
            />
            <p className="text-xs text-gray-500 mt-1">
              At least {MIN_PASSWORD_LENGTH} characters
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Confirm New Password
            </label>
            <input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={e => { setConfirm(e.target.value); setError(null) }}
              className="border px-2 py-1 w-full rounded"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="bg-blue-600 text-white px-4 py-2 w-full rounded disabled:opacity-50"
          >
            {loading ? 'Updating…' : 'Set New Password'}
          </button>
        </form>
      </div>
    </div>
  )
}