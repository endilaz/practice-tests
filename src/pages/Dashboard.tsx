import { TestConfigForm } from '@/tests/TestConfig'
import { useAuth } from '@/auth/useAuth'
import { supabase } from '@/lib/supabase'

export default function Dashboard() {
  const { role } = useAuth()

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow px-4 py-3 flex justify-between items-center">
        <h1 className="text-lg font-semibold">FBLA Practice Tests</h1>
        <div className="flex items-center gap-4">
          {role === 'admin' && (
            <a href="/admin" className="text-sm text-blue-600 underline">
              Admin
            </a>
          )}
          <button
            onClick={() => supabase.auth.signOut()}
            className="text-sm text-gray-600 underline"
          >
            Log Out
          </button>
        </div>
      </header>

      <main className="max-w-md mx-auto mt-10 px-4">
        <h2 className="text-xl font-bold mb-6">Start a Practice Test</h2>
        <TestConfigForm />
      </main>
    </div>
  )
}
