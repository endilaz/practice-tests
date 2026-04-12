import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  async function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault()
    if (loading) return
    setError(null)

    const trimmedEmail = email.trim()
    const trimmedPassword = password.trim()

    if (!trimmedEmail || !trimmedPassword) {
      setError('Email and password are required.')
      return
    }

    setLoading(true)

    const { error } = await supabase.auth.signInWithPassword({ 
      email: trimmedEmail, 
      password: trimmedPassword 
    })

    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      // Success: navigate to dashboard. AuthProvider's onAuthStateChange
      // will detect the new session and set user + role. By the time
      // ProtectedRoute renders, loading will resolve and Dashboard appears.
      navigate('/')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm bg-white p-8 rounded shadow space-y-4">
        <h1 className="text-2xl font-bold text-center">Log In</h1>

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

          <div>
            <label className="block text-sm font-medium mb-1">Password</label>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={e => { setPassword(e.target.value); setError(null) }}
              className="border px-2 py-1 w-full rounded"
              required
            />
            <div className="text-right mt-1">
              <Link to="/forgot-password" className="text-xs text-blue-600 underline">
                Forgot password?
              </Link>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="bg-blue-600 text-white px-4 py-2 w-full rounded disabled:opacity-50"
          >
            {loading ? 'Logging in...' : 'Log In'}
          </button>
        </form>

        <p className="text-sm text-center text-gray-600">
          No account?{' '}
          <Link to="/register" className="text-blue-600 underline">
            Register
          </Link>
        </p>
      </div>
    </div>
  )
}