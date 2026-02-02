import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'

export default function Register() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  async function handleSubmit() {
    if (loading) return
    setError(null)

    if (!email.trim() || !password.trim()) {
      setError('Email and password are required.')
      return
    }

    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }

    setLoading(true)

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.location.origin,
      },
    })

    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      setSuccess(true)
      // Don't navigate. Email confirmation is required before login.
      // The handle_new_user trigger creates the public.users row, but
      // the session won't be active until the email link is clicked.
    }
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-full max-w-sm bg-white p-8 rounded shadow text-center space-y-4">
          <h1 className="text-2xl font-bold">Check Your Email</h1>
          <p className="text-gray-600 text-sm">
            A confirmation link has been sent to <strong>{email}</strong>.
            Click it to activate your account, then log in.
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
        <h1 className="text-2xl font-bold text-center">Register</h1>

        {error && <p className="text-red-600 text-sm">{error}</p>}

        <div>
          <label className="block text-sm font-medium mb-1">Email</label>
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={e => { setEmail(e.target.value); setError(null) }}
            className="border px-2 py-1 w-full rounded"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Password</label>
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={e => { setPassword(e.target.value); setError(null) }}
            className="border px-2 py-1 w-full rounded"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Confirm Password</label>
          <input
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={e => { setConfirm(e.target.value); setError(null) }}
            className="border px-2 py-1 w-full rounded"
          />
        </div>

        <button
          onClick={handleSubmit}
          disabled={loading}
          className="bg-blue-600 text-white px-4 py-2 w-full rounded disabled:opacity-50"
        >
          {loading ? 'Registering...' : 'Register'}
        </button>

        <p className="text-sm text-center text-gray-600">
          Already have an account?{' '}
          <Link to="/login" className="text-blue-600 underline">
            Log In
          </Link>
        </p>
      </div>
    </div>
  )
}