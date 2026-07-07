/*
 * GuestLanding.tsx
 * Landing page for users who choose to practice without an account.
 *
 * On mount, signs the browser into an anonymous Supabase session if one
 * doesn't already exist. Anonymous sessions are real JWTs so generate_test()
 * and all RLS policies work identically to authenticated users.
 *
 * No test history is shown or stored for the guest — data exists in the DB
 * for the duration of the anonymous session but is not surfaced in the UI.
 *
 * After the session is ready, the page renders TestConfigForm exactly as
 * Dashboard does for logged-in users.
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { TestConfigForm } from '@/tests/TestConfig'

type PageState = 'signing-in' | 'ready' | 'error'

export default function GuestLanding() {
  const [pageState, setPageState] = useState<PageState>('signing-in')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function ensureAnonymousSession() {
      // If the user already has any session (anonymous or real), reuse it.
      const { data: sessionData } = await supabase.auth.getSession()

      if (sessionData.session) {
        if (!cancelled) setPageState('ready')
        return
      }

      // No session — create an anonymous one.
      const { error } = await supabase.auth.signInAnonymously()

      if (cancelled) return

      if (error) {
        console.error('Anonymous sign-in failed:', error)
        setErrorMessage(error.message)
        setPageState('error')
      } else {
        setPageState('ready')
      }
    }

    ensureAnonymousSession()
    return () => { cancelled = true }
  }, [])

  // ── error state ──────────────────────────────────────────────────────────
  if (pageState === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white p-8 rounded-xl shadow max-w-md text-center space-y-4">
          <h2 className="text-xl font-bold text-red-600">Could not start guest session</h2>
          <p className="text-gray-600 text-sm">{errorMessage}</p>
          <Link to="/login" className="text-blue-600 underline text-sm">
            Back to Login
          </Link>
        </div>
      </div>
    )
  }

  // ── loading state (anonymous sign-in in flight) ──────────────────────────
  if (pageState === 'signing-in') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-500">Starting guest session…</p>
      </div>
    )
  }

  // ── ready: show test config ──────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow px-4 py-3 flex justify-between items-center">
        <h1 className="text-lg font-semibold">FBLA Practice Tests</h1>
        <div className="flex items-center gap-4">
          <Link to="/register" className="text-sm text-blue-600 underline">
            Create Account
          </Link>
          <Link to="/login" className="text-sm text-gray-600 underline">
            Log In
          </Link>
        </div>
      </header>

      <main className="max-w-6xl mx-auto mt-10 px-4 space-y-6">
        {/* Guest notice */}
        <div className="max-w-md bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
          You're practicing as a guest. Your results won't be saved.{' '}
          <Link to="/register" className="underline font-medium">
            Create a free account
          </Link>{' '}
          to keep your history.
        </div>

        <section>
          <h2 className="text-xl font-bold mb-6">Start a Practice Test</h2>
          <div className="max-w-md">
            <TestConfigForm />
          </div>
        </section>
      </main>
    </div>
  )
}