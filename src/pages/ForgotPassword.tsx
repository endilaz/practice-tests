/**
 * ForgotPassword.tsx
 *
 * Public page. Accepts a user's email and sends a Supabase password-reset
 * email containing a magic link. The link redirects to /reset-password where
 * the user can set a new password.
 *
 * No auth required. Accessible from the Login page.
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'

// The URL Supabase will redirect to after the user clicks the email link.
// Must be added to your Supabase project's "Redirect URLs" allowlist:
// Dashboard → Authentication → URL Configuration → Redirect URLs
const RESET_REDIRECT_URL = `${window.location.origin}/reset-password`

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (loading) return
    setError(null)

    const trimmed = email.trim()
    if (!trimmed) {
      setError('Email is required.')
      return
    }

    setLoading(true)

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      trimmed,
      { redirectTo: RESET_REDIRECT_URL }
    )

    // Always show the success message even if the email doesn't exist.
    // This prevents user enumeration: an attacker shouldn't be able to
    // discover which emails are registered by probing this endpoint.
    if (resetError) {
      console.error('Password reset error:', resetError)
    }

    setLoading(false)
    setSent(true)
  }

  if (sent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-full max-w-sm bg-white p-8 rounded shadow text-center space-y-4">
          <h1 className="text-2xl font-bold">Check Your Email</h1>
          <p className="text-gray-600 text-sm">
            If an account exists for <strong>{email}</strong>, a password reset
            link has been sent. Check your spam folder if you don't see it.
          </p>
          <Link to="/login" className="text-blue-600 underline text-sm">
            Back to Login
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm bg-white p-8 rounded shadow space-y-4">
        <h1 className="text-2xl font-bold text-center">Reset Password</h1>
        <p className="text-sm text-gray-600 text-center">
          Enter your email and we'll send you a reset link.
        </p>

        {error && <p className="text-red-600 text-sm">{error}</p>}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Email</label>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={e => { setEmail(e.target.value); setError(null) }}
              className="border px-2 py-1 w-full rounded"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="bg-blue-600 text-white px-4 py-2 w-full rounded disabled:opacity-50"
          >
            {loading ? 'Sending...' : 'Send Reset Link'}
          </button>
        </form>

        <p className="text-sm text-center text-gray-600">
          <Link to="/login" className="text-blue-600 underline">
            Back to Login
          </Link>
        </p>
      </div>
    </div>
  )
}