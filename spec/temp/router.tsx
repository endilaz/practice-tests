import { createBrowserRouter } from 'react-router-dom'
import { ProtectedRoute } from '@/auth/ProtectedRoute'
import Login from '@/pages/Login'
import Register from '@/pages/Register'
import Dashboard from '@/pages/Dashboard'
import Admin from '@/pages/Admin'
import TestShell from '@/tests/TestShell'
import PracticeShell from '@/tests/PracticeShell'
import Results from '@/pages/Results'

export const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
  { path: '/register', element: <Register /> },
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