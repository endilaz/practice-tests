/*
 * RouteError.tsx
 * Router-level error boundary (errorElement). Catches render errors anywhere
 * in the route tree so a crash shows a recoverable screen instead of a blank
 * page — which matters most if something throws mid-test.
 */
import { Link, useRouteError } from 'react-router-dom'

export default function RouteError() {
  const error = useRouteError()
  const message =
    error instanceof Error ? error.message : 'An unexpected error occurred.'

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white p-8 rounded-xl shadow max-w-md text-center space-y-4">
        <h1 className="text-xl font-bold text-red-600">Something went wrong</h1>
        <p className="text-sm text-gray-600 break-words">{message}</p>
        <p className="text-sm text-gray-500">
          Your answers are saved automatically every 30 seconds — if this
          happened during a test, reload or return to the dashboard and reopen
          the test to continue.
        </p>
        <div className="flex gap-3 justify-center">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
          >
            Reload
          </button>
          <Link
            to="/"
            className="bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-700 transition-colors"
          >
            Back to Dashboard
          </Link>
        </div>
      </div>
    </div>
  )
}
