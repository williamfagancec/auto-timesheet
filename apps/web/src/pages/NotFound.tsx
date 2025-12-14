import { Link } from 'react-router-dom'

export function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-100 to-gray-200">
      <div className="text-center">
        <h1 className="text-9xl font-bold text-gray-400">404</h1>
        <p className="text-2xl font-semibold text-gray-700 mt-4">Page Not Found</p>
        <p className="text-gray-600 mt-2">The page you're looking for doesn't exist.</p>
        <div className="mt-8 space-x-4">
          <Link
            to="/login"
            className="inline-block px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
          >
            Go to Login
          </Link>
          <Link
            to="/test"
            className="inline-block px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition"
          >
            Test Page
          </Link>
        </div>
        <div className="mt-6 text-sm text-gray-500">
          <p>Current URL: {window.location.pathname}</p>
        </div>
      </div>
    </div>
  )
}
