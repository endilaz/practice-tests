import { createBrowserRouter } from 'react-router-dom'
import { ProtectedRoute } from '@/auth/ProtectedRoute'
import Login from '@/pages/Login'
import Register from '@/pages/Register'
import Dashboard from '@/pages/Dashboard'
import Admin from '@/pages/Admin'
import TestShell from '@/tests/TestShell'
import PracticeShell from '@/tests/PracticeShell'
import Results from '@/pages/Results'
import ForgotPassword from '@/pages/ForgotPassword'
import ResetPassword from '@/pages/ResetPassword'
import ChangePassword from '@/pages/ChangePassword'

export const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
  { path: '/register', element: <Register /> },
  { path: '/forgot-password', element: <ForgotPassword /> },
  // /reset-password must NOT be behind ProtectedRoute — the user arrives
  // with a recovery token, not a normal session.
  { path: '/reset-password', element: <ResetPassword /> },
  {
    path: '/change-password',
    element: (
      <ProtectedRoute>
        <ChangePassword />
      </ProtectedRoute>
    )
  },
  {
    path: '/',
    element: (
      <ProtectedRoute>
        <Dashboard />
      </ProtectedRoute>
    )
  },
  {
    path: '/test/:id',
    element: (
      <ProtectedRoute>
        <TestShell />
      </ProtectedRoute>
    )
  },
  {
    path: '/practice',
    element: (
      <ProtectedRoute>
        <PracticeShell />
      </ProtectedRoute>
    )
  },
  {
    path: '/results/:id',
    element: (
      <ProtectedRoute>
        <Results />
      </ProtectedRoute>
    )
  },
  {
    path: '/admin',
    element: (
      <ProtectedRoute requireAdmin>
        <Admin />
      </ProtectedRoute>
    )
  }
])