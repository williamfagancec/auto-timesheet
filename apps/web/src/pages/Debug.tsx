import { trpc } from '../lib/trpc'

export function Debug() {
  const { data: authStatus, isLoading, error } = trpc.auth.status.useQuery()

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-4xl mx-auto bg-white rounded-lg shadow-lg p-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-6">Debug Info</h1>

        <div className="space-y-6">
          {/* Auth Status */}
          <div className="border-l-4 border-blue-500 pl-4">
            <h2 className="text-xl font-semibold text-gray-800 mb-2">Authentication Status</h2>
            <div className="space-y-2">
              <p className="text-gray-700">
                <span className="font-medium">Loading:</span>{' '}
                <span className={isLoading ? 'text-yellow-600' : 'text-green-600'}>
                  {isLoading ? 'Yes' : 'No'}
                </span>
              </p>
              <p className="text-gray-700">
                <span className="font-medium">Error:</span>{' '}
                <span className={error ? 'text-red-600' : 'text-green-600'}>
                  {error ? error.message : 'None'}
                </span>
              </p>
              <p className="text-gray-700">
                <span className="font-medium">Authenticated:</span>{' '}
                <span className={authStatus?.authenticated ? 'text-green-600' : 'text-red-600'}>
                  {authStatus?.authenticated ? 'Yes' : 'No'}
                </span>
              </p>
              {authStatus?.user && (
                <div className="mt-4 p-4 bg-green-50 rounded">
                  <p className="font-medium text-green-900">User Info:</p>
                  <pre className="text-sm text-green-800 mt-2">
                    {JSON.stringify(authStatus.user, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>

          {/* URL Info */}
          <div className="border-l-4 border-purple-500 pl-4">
            <h2 className="text-xl font-semibold text-gray-800 mb-2">URL Info</h2>
            <div className="space-y-2">
              <p className="text-gray-700">
                <span className="font-medium">Current Path:</span> {window.location.pathname}
              </p>
              <p className="text-gray-700">
                <span className="font-medium">Full URL:</span> {window.location.href}
              </p>
              <p className="text-gray-700">
                <span className="font-medium">Origin:</span> {window.location.origin}
              </p>
            </div>
          </div>

          {/* Test Links */}
          <div className="border-l-4 border-orange-500 pl-4">
            <h2 className="text-xl font-semibold text-gray-800 mb-2">Test Navigation</h2>
            <div className="flex flex-wrap gap-2 mt-3">
              <a href="/test" className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
                Test Page
              </a>
              <a href="/login" className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700">
                Login
              </a>
              <a href="/timesheet" className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700">
                Timesheet (Protected)
              </a>
              <a href="/events" className="px-4 py-2 bg-orange-600 text-white rounded hover:bg-orange-700">
                Events (Protected)
              </a>
            </div>
          </div>

          {/* Instructions */}
          <div className="border-l-4 border-gray-500 pl-4">
            <h2 className="text-xl font-semibold text-gray-800 mb-2">Instructions</h2>
            <ul className="list-disc list-inside text-gray-700 space-y-1">
              <li>If "Authenticated" shows "No", you need to log in first</li>
              <li>Protected routes will redirect to /login if not authenticated</li>
              <li>Use the test links above to navigate</li>
              <li>Check browser console (F12) for additional errors</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
