/**
 * ChangePassword.tsx
 *
 * Protected page allowing a logged-in user to change their password.
 * Re-authenticates with the current password first (signInWithPassword)
 * before calling updateUser() — this guards against stale or hijacked
 * sessions and is required best practice.
 *
 * Security notes:
 *   - Re-auth confirms the caller knows the current password before any
 *     update is attempted, mitigating session-hijacking risk.
 *   - New password is validated client-side (length, match, differs from
 *     current) before any network call. Supabase enforces its own minimum
 *     server-side as a second layer.
 *   - The mutating flag prevents duplicate submissions.
 *   - A generic error message is shown for incorrect current password to
 *     avoid leaking information about which field is wrong.
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/auth/useAuth'
import { supabase } from '@/lib/supabase'

// Keep in sync with Supabase Auth password minimum settings.
const MIN_PASSWORD_LENGTH = 8

export default function ChangePassword() {
  const { user } = useAuth()

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [mutating, setMutating] = useState(false)

  function resetForm() {
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (mutating) return
    setError(null)
    setSuccess(false)

    // Client-side validation
    if (!currentPassword) {
      setError('Current password is required.')
      return
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(`New password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
      return
    }
    if (newPassword !== confirmPassword) {
      setError('New passwords do not match.')
      return
    }
    if (currentPassword === newPassword) {
      setError('New password must differ from your current password.')
      return
    }

    setMutating(true)

    // Step 1: Re-authenticate with current password before allowing the
    // change. This is the critical security check.
    const { error: reAuthError } = await supabase.auth.signInWithPassword({
      email: user?.email ?? '',
      password: currentPassword,
    })

    if (reAuthError) {
      setError('Current password is incorrect.')
      setMutating(false)
      return
    }

    // Step 2: Update to new password.
    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword,
    })

    if (updateError) {
      setError(updateError.message)
      setMutating(false)
      return
    }

    setSuccess(true)
    setMutating(false)
    resetForm()
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow px-4 py-3 flex justify-between items-center">
        <h1 className="text-lg font-semibold">FBLA Practice Tests</h1>
        <Link to="/" className="text-sm text-blue-600 underline">
          ← Back to Dashboard
        </Link>
      </header>

      <main className="max-w-md mx-auto mt-10 px-4">
        <div className="bg-white rounded-lg shadow p-8 space-y-6">
          <h2 className="text-2xl font-bold">Change Password</h2>

          {success && (
            <p className="text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2 text-sm">
              Password updated successfully.
            </p>
          )}

          {error && (
            <p className="text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2 text-sm">
              {error}
            </p>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">
                Current Password
              </label>
              <input
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={e => { setCurrentPassword(e.target.value); setError(null) }}
                className="border px-2 py-1 w-full rounded"
                disabled={mutating}
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">
                New Password
              </label>
              <input
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={e => { setNewPassword(e.target.value); setError(null) }}
                className="border px-2 py-1 w-full rounded"
                disabled={mutating}
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
                value={confirmPassword}
                onChange={e => { setConfirmPassword(e.target.value); setError(null) }}
                className="border px-2 py-1 w-full rounded"
                disabled={mutating}
                required
              />
            </div>

            <button
              type="submit"
              disabled={mutating}
              className="bg-blue-600 text-white px-4 py-2 w-full rounded disabled:opacity-50"
            >
              {mutating ? 'Updating…' : 'Update Password'}
            </button>
          </form>
        </div>
      </main>
    </div>
  )
}