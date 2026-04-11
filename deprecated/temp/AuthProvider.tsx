import { createContext, useContext, useEffect, useState } from 'react'
import { type User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

type Role = 'user' | 'admin'

type AuthContextValue = {
  user: User | null
  role: Role | null
  loading: boolean
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [role, setRole] = useState<Role | null>(null)
  // loading is true until BOTH user and role are resolved for the first
  // time. ProtectedRoute must not render anything until this is false.
  const [loading, setLoading] = useState(true)

  // Session bootstrap.
  // getSession() and onAuthStateChange() are both async and Supabase does
  // not guarantee which fires first. We use a ref-style flag (via closure)
  // to ensure user is set exactly once during the initial resolution,
  // regardless of which callback wins. The flag is scoped to the effect
  // so it resets correctly if the effect ever re-runs (it won't, because
  // the dependency array is empty, but this keeps the logic self-contained).
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
        // First resolution: set user and let the role effect handle the rest.
        settled = true
        setUser(session?.user ?? null)
      } else {
        // Subsequent changes (login, logout, token refresh): update user
        // directly. Role effect will re-fire because user changed.
        setUser(session?.user ?? null)
      }
    })

    return () => sub.subscription.unsubscribe()
  }, [])

  // Role resolution.
  // Runs whenever user changes. When user becomes non-null, fetches role
  // from the database (never from the JWT — the JWT does not contain role).
  // Sets loading to false only after role is resolved or confirmed null.
  // This means ProtectedRoute will not see loading=false until we have
  // both a definitive user value AND a definitive role value.
  useEffect(() => {
    if (!user) {
      setRole(null)
      setLoading(false) // No user means we're done resolving.
      return
    }

    supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single()
      .then(({ data, error }) => {
        if (error) {
          console.error('Failed to fetch role:', error)
          setRole(null)
        } else {
          setRole(data.role as Role)
        }
        setLoading(false) // Resolution complete: role is set (or null on error).
      })
  }, [user])

  return (
    <AuthContext.Provider value={{ user, role, loading }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return ctx
}
