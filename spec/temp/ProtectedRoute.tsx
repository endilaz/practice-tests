import { Navigate } from 'react-router-dom'
import { useAuth } from './useAuth'

export function ProtectedRoute({
  children,
  requireAdmin = false
}: {
  children: JSX.Element
  requireAdmin?: boolean
}) {
  const { user, role, loading } = useAuth()

  if (loading || (requireAdmin && role === null)) {
    return null // replace with spinner later
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  if (requireAdmin && role !== 'admin') {
    return <Navigate to="/" replace />
  }

  return children
}
