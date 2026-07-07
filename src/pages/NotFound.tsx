/*
 * NotFound.tsx
 * Catch-all page for unknown URLs (router path: '*').
 */
import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white p-8 rounded-xl shadow max-w-md text-center space-y-4">
        <h1 className="text-4xl font-bold text-gray-900">404</h1>
        <p className="text-gray-600">This page doesn't exist.</p>
        <Link
          to="/"
          className="inline-block bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
        >
          Back to Dashboard
        </Link>
      </div>
    </div>
  )
}
