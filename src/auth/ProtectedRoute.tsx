/*
 * ProtectedRoute.tsx
 * Route guard wrapping protected pages.
 *
 * Props:
 *   requireAdmin  – redirects non-admins to /
 *   allowGuest    – anonymous (is_anonymous) users are allowed through.
 *                   Without this flag, anonymous users are treated as
 *                   unauthenticated and redirected to /login.
 *
 * Auth states handled:
 *   loading                → render nothing (avoids flash of redirect)
 *   no user                → /login
 *   anonymous + !allowGuest → /login
 *   non-admin + requireAdmin → /
 *   otherwise              → render children
 */
import { Navigate } from 'react-router-dom'
import { useAuth } from './useAuth'

export function ProtectedRoute({
  children,
  requireAdmin = false,
  allowGuest = false,
}: {
  children: JSX.Element
  requireAdmin?: boolean
  allowGuest?: boolean
}) {
  const { user, role, loading } = useAuth()

  // Wait for session + role fetch to settle before making routing decisions
  if (loading || (requireAdmin && role === null && user !== null)) {
    return null
  }

  // No session at all
  if (!user) {
    return <Navigate to="/login" replace />
  }

  // Anonymous session: only allowed when the route explicitly opts in
  if ((user as any).is_anonymous && !allowGuest) {
    return <Navigate to="/login" replace />
  }

  // Authenticated but not admin
  if (requireAdmin && role !== 'admin') {
    return <Navigate to="/" replace />
  }

  return children
}