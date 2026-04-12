/*
 * router.tsx
 * Central route table for the application.
 *
 * Public routes  – no auth required: /login, /register, /forgot-password,
 *                  /reset-password, /guest
 * Guest routes   – anonymous session allowed: /test/:id, /results/:id
 * Auth routes    – full (non-anonymous) session required: /, /change-password
 * Admin routes   – admin role required: /admin
 */
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
import GuestLanding from '@/pages/GuestLanding'

export const router = createBrowserRouter([
  // ── public ──────────────────────────────────────────────────────────────
  { path: '/login',           element: <Login /> },
  { path: '/register',        element: <Register /> },
  { path: '/forgot-password', element: <ForgotPassword /> },
  // /reset-password must NOT be behind ProtectedRoute — arrives with a
  // recovery token, not a normal session.
  { path: '/reset-password',  element: <ResetPassword /> },
  // Guest landing: signs in anonymously then shows TestConfigForm.
  // No ProtectedRoute — the page itself handles the anonymous sign-in.
  { path: '/guest',           element: <GuestLanding /> },

  // ── requires full (non-anonymous) session ────────────────────────────────
  {
    path: '/change-password',
    element: (
      <ProtectedRoute>
        <ChangePassword />
      </ProtectedRoute>
    ),
  },
  {
    path: '/',
    element: (
      <ProtectedRoute>
        <Dashboard />
      </ProtectedRoute>
    ),
  },
  {
    path: '/practice',
    element: (
      <ProtectedRoute>
        <PracticeShell />
      </ProtectedRoute>
    ),
  },

  // ── guest-allowed routes (anonymous OR full session) ─────────────────────
  {
    path: '/test/:id',
    element: (
      <ProtectedRoute allowGuest>
        <TestShell />
      </ProtectedRoute>
    ),
  },
  {
    path: '/results/:id',
    element: (
      <ProtectedRoute allowGuest>
        <Results />
      </ProtectedRoute>
    ),
  },

  // ── admin only ───────────────────────────────────────────────────────────
  {
    path: '/admin',
    element: (
      <ProtectedRoute requireAdmin>
        <Admin />
      </ProtectedRoute>
    ),
  },
])